// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Lingxi paid extras
/// @notice Small conveniences and looks, each at a fixed BEM price that is burned whole in the same transaction:
///  - room space: four more pieces in a player's home, at most three times per wallet;
///  - saved looks: three more whole outfits kept for one tap, at most three times per wallet;
///  - a name colour for one pet, which stays with the pet when it changes hands; going back to plain is free.
/// The core game never needs any of them. Nobody is paid: the contract keeps no BEM, so it holds nothing to take.
/// Three public counters make the sink readable: what each wallet spent, what each extra took in, and the total.
/// @dev Invariant: `totalBurned == spentOn[ROOM] + spentOn[LOOKS] + spentOn[NAME_COLOUR] + strayBurned`, and every
/// unit counted there arrived at `BURN`.
contract Extras is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// BEM has no burn function and refuses transfers to the zero address, so burning sends here.
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    uint8 public constant ROOM = 0;
    uint8 public constant LOOKS = 1;
    uint8 public constant NAME_COLOUR = 2;
    uint8 public constant FEATURES = 3;

    /// Room space and saved looks can each be bought this many times per wallet.
    uint8 public constant MAX_PACKS = 3;
    /// Name colours on offer can grow up to this many; a colour once offered is never taken away.
    uint8 public constant MAX_COLOURS = 32;
    /// Prices the owner may set: 0.001 to 10 BEM (8 decimals). 0 takes an extra off sale.
    uint96 public constant MIN_PRICE = 1e5;
    uint96 public constant MAX_PRICE = 10e8;

    IERC20 public immutable bem;
    IERC721 public immutable pets;

    /// Price of each extra in BEM base units, by feature; 0 = not on sale.
    mapping(uint8 => uint96) public price;
    /// Name colours on offer: 1..colours. 0 is plain.
    uint8 public colours;

    mapping(address => uint8) public roomPacks;
    mapping(address => uint8) public lookPacks;
    mapping(uint256 => uint8) public nameColour;

    /// BEM each wallet has burned here by buying extras.
    mapping(address => uint256) public spentBy;
    /// BEM each extra has burned.
    mapping(uint8 => uint256) public spentOn;
    /// Purchases of each extra.
    mapping(uint8 => uint256) public sold;
    /// BEM sent here by mistake and burned by `burnStray`; not spent on any extra.
    uint256 public strayBurned;
    /// Everything this contract has burned: every extra's takings plus stray BEM.
    uint256 public totalBurned;

    event PriceSet(uint8 indexed feature, uint96 price);
    event ColoursAdded(uint8 colours);
    event Bought(address indexed buyer, uint8 indexed feature, uint256 indexed detail, uint256 paid);
    event NameColoured(uint256 indexed petId, uint8 colour, address indexed by);
    event Burned(address indexed payer, uint256 amount);

    error BadTerms();
    error NotForSale();
    error PriceMoved();
    error WrongPayment();
    error BurnShort();
    error Full();
    error NotPetOwner();
    error BadColour();
    error SameColour();

    constructor(address owner_, IERC20 bem_, IERC721 pets_, uint8 colours_, uint96 roomPrice, uint96 lookPrice, uint96 colourPrice) Ownable(owner_) {
        if (address(bem_) == address(0) || address(pets_) == address(0) || colours_ == 0 || colours_ > MAX_COLOURS) revert BadTerms();
        bem = bem_;
        pets = pets_;
        colours = colours_;
        emit ColoursAdded(colours_);
        _setPrice(ROOM, roomPrice);
        _setPrice(LOOKS, lookPrice);
        _setPrice(NAME_COLOUR, colourPrice);
    }

    /* ── buying ──────────────────────────────────────────────────────────── */

    /// @notice Four more pieces in your home. `expectedPrice` guards against a price change in flight.
    function buyRoom(uint96 expectedPrice) external nonReentrant {
        uint8 packs = roomPacks[msg.sender];
        if (packs >= MAX_PACKS) revert Full();
        roomPacks[msg.sender] = packs + 1;
        _charge(ROOM, expectedPrice, packs + 1);
    }

    /// @notice Three more saved looks.
    function buyLooks(uint96 expectedPrice) external nonReentrant {
        uint8 packs = lookPacks[msg.sender];
        if (packs >= MAX_PACKS) revert Full();
        lookPacks[msg.sender] = packs + 1;
        _charge(LOOKS, expectedPrice, packs + 1);
    }

    /// @notice Give a pet's name a colour (1..colours), or take it back to plain (0, free). Only the pet's owner may
    /// do it: an operator approved for the owner's pets could otherwise wipe a colour the owner paid for, at no cost.
    /// `expectedPrice` is ignored for plain. A pet need not be settled: colours are not scarce, so there is nothing
    /// to sweep up with throwaway pets (the reason PetLook waits before a name).
    function setNameColour(uint256 petId, uint8 colour, uint96 expectedPrice) external nonReentrant {
        if (msg.sender != pets.ownerOf(petId)) revert NotPetOwner();
        if (colour > colours) revert BadColour();
        if (colour == nameColour[petId]) revert SameColour();
        nameColour[petId] = colour;
        emit NameColoured(petId, colour, msg.sender);
        if (colour != 0) _charge(NAME_COLOUR, expectedPrice, petId);
    }

    /// @dev Pulls the price first so a token that delivers less than asked is refused, then burns it whole and checks
    /// the burn arrived. Every state change of the purchase is made before this is called; a revert undoes all of it.
    function _charge(uint8 feature, uint96 expectedPrice, uint256 detail) private {
        uint96 p = price[feature];
        if (p == 0) revert NotForSale();
        if (p != expectedPrice) revert PriceMoved();
        uint256 before = bem.balanceOf(address(this));
        bem.safeTransferFrom(msg.sender, address(this), p);
        if (bem.balanceOf(address(this)) - before != p) revert WrongPayment();
        spentBy[msg.sender] += p;
        spentOn[feature] += p;
        sold[feature] += 1;
        emit Bought(msg.sender, feature, detail, p);
        _burn(msg.sender, p);
    }

    /// @notice BEM sent here by mistake belongs to nobody (a purchase never leaves any behind); anyone may burn it.
    function burnStray() external nonReentrant {
        uint256 stray = bem.balanceOf(address(this));
        if (stray == 0) revert BadTerms();
        strayBurned += stray;
        _burn(msg.sender, stray);
    }

    /// @dev Sends `amount` to the dead address and refuses a token that delivers less there than it was asked to.
    function _burn(address payer, uint256 amount) private {
        totalBurned += amount;
        emit Burned(payer, amount);
        uint256 deadBefore = bem.balanceOf(BURN);
        bem.safeTransfer(BURN, amount);
        if (bem.balanceOf(BURN) - deadBefore != amount) revert BurnShort();
    }

    /* ── reading ─────────────────────────────────────────────────────────── */

    /// @notice One wallet's extras and each extra's current price, in one call for the game.
    function extrasOf(address who) external view returns (uint8 room, uint8 looks, uint96 roomPrice, uint96 lookPrice, uint96 colourPrice, uint8 colourCount) {
        return (roomPacks[who], lookPacks[who], price[ROOM], price[LOOKS], price[NAME_COLOUR], colours);
    }

    /// @notice The name colours of many pets in one call (0 = plain).
    function coloursOf(uint256[] calldata petIds) external view returns (uint8[] memory out) {
        out = new uint8[](petIds.length);
        for (uint256 i; i < petIds.length; ++i) out[i] = nameColour[petIds[i]];
    }

    /* ── the owner ───────────────────────────────────────────────────────── */

    /// @notice Set an extra's price within 0.001–10 BEM, or 0 to take it off sale. The burn cannot change.
    function setPrice(uint8 feature, uint96 p) external onlyOwner {
        _setPrice(feature, p);
    }

    /// @notice Offer more name colours. Colours already offered stay; a pet's colour is never taken away.
    function addColours(uint8 more) external onlyOwner {
        if (more == 0 || uint256(colours) + more > MAX_COLOURS) revert BadTerms();
        colours += more;
        emit ColoursAdded(colours);
    }

    function _setPrice(uint8 feature, uint96 p) private {
        if (feature >= FEATURES) revert BadTerms();
        if (p != 0 && (p < MIN_PRICE || p > MAX_PRICE)) revert BadTerms();
        price[feature] = p;
        emit PriceSet(feature, p);
    }
}
