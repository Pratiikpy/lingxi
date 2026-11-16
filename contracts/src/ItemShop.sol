// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// The parts of OutfitMarketV2 the shop uses: item kinds there take copies only from minters the owner grants.
interface IItemMarket {
    struct Design {
        address creator;
        uint96 price;
        uint32 maxSupply;
        uint32 minted;
        uint16 royaltyBps;
        bool closed;
        bool item;
        string name;
        bytes pixels;
    }

    function mintTo(uint256 id, address to, uint32 quantity) external;
    function minterCap(uint256 id, address minter) external view returns (uint32);
    function design(uint256 id) external view returns (Design memory);
}

/// @title Lingxi item shop
/// @notice Makes copies of the game's on-chain items (item kinds on the BEM market) in two ways only:
///  - bought at a fixed BEM price, where the whole price is burned in the same transaction (nobody is paid);
///  - claimed with a single-use voucher signed by the game's voucher key, for something earned in play that the
///    server can witness. The voucher path trusts that key; the game says so wherever a voucher is offered.
/// Copies are ordinary ERC-1155 tokens on the market, so they can be resold there (with its fee burned).
contract ItemShop is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// BEM has no burn function and refuses transfers to the zero address, so burning sends here.
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    /// Prices the owner may set: 0.001 to 10 BEM (8 decimals). 0 takes an item off sale.
    uint96 public constant MIN_PRICE = 1e5;
    uint96 public constant MAX_PRICE = 10e8;
    uint32 public constant MAX_PER_CALL = 10;
    bytes32 public constant VOUCHER_TYPEHASH = keccak256("Voucher(address to,uint256 id,uint32 quantity,uint256 nonce,uint64 expiresAt)");

    struct Voucher {
        address to;
        uint256 id;
        uint32 quantity;
        uint256 nonce;
        uint64 expiresAt;
    }

    IItemMarket public immutable market;
    IERC20 public immutable bem;
    address public signer;
    uint256 public totalBurned;
    /// Price per copy in BEM base units; 0 = not for sale.
    mapping(uint256 => uint96) public price;
    mapping(uint256 => bool) public usedNonce;

    event PriceSet(uint256 indexed id, uint96 price);
    event SignerSet(address indexed signer);
    event Bought(address indexed buyer, uint256 indexed id, uint32 quantity, uint256 paid);
    event Claimed(address indexed to, uint256 indexed id, uint32 quantity, uint256 indexed nonce);
    event Burned(address indexed payer, uint256 amount);

    error BadTerms();
    error NotForSale();
    error PriceMoved();
    error WrongPayment();
    error Expired();
    error Used();
    error BadSignature();

    constructor(address owner_, IItemMarket market_, IERC20 bem_, address signer_) Ownable(owner_) EIP712("Lingxi ItemShop", "1") {
        if (address(market_) == address(0) || address(bem_) == address(0) || signer_ == address(0)) revert BadTerms();
        market = market_;
        bem = bem_;
        signer = signer_;
        emit SignerSet(signer_);
    }

    /* ── buying ──────────────────────────────────────────────────────────── */

    /// @notice Buy copies; the whole price is burned. `expectedPrice` guards against a price change in flight.
    function buy(uint256 id, uint32 quantity, uint96 expectedPrice) external nonReentrant {
        uint96 p = price[id];
        if (p == 0) revert NotForSale();
        if (p != expectedPrice) revert PriceMoved();
        if (quantity == 0 || quantity > MAX_PER_CALL) revert BadTerms();
        uint256 total = uint256(p) * quantity;
        // pulled here first so a token that delivers less than asked is refused, then burned whole
        uint256 before = bem.balanceOf(address(this));
        bem.safeTransferFrom(msg.sender, address(this), total);
        if (bem.balanceOf(address(this)) - before != total) revert WrongPayment();
        totalBurned += total;
        emit Burned(msg.sender, total);
        emit Bought(msg.sender, id, quantity, total);
        bem.safeTransfer(BURN, total);
        market.mintTo(id, msg.sender, quantity);
    }

    /* ── vouchers ────────────────────────────────────────────────────────── */

    /// @notice Redeem a voucher. Anyone may submit it; the copies always go to the voucher's `to`.
    function claim(Voucher calldata v, bytes calldata signature) external nonReentrant {
        if (block.timestamp > v.expiresAt) revert Expired();
        if (usedNonce[v.nonce]) revert Used();
        if (v.to == address(0) || v.quantity == 0 || v.quantity > MAX_PER_CALL) revert BadTerms();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, v.to, v.id, v.quantity, v.nonce, v.expiresAt)));
        (address got, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || got != signer) revert BadSignature();
        usedNonce[v.nonce] = true;
        emit Claimed(v.to, v.id, v.quantity, v.nonce);
        market.mintTo(v.id, v.to, v.quantity);
    }

    /// @notice The digest a voucher's signature covers, for off-chain signers and checks.
    function voucherDigest(Voucher calldata v) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, v.to, v.id, v.quantity, v.nonce, v.expiresAt)));
    }

    /// @notice Copies this shop can still make of an item: the smaller of its grant and the item's supply left.
    function available(uint256 id) external view returns (uint256) {
        IItemMarket.Design memory d = market.design(id);
        uint256 left = d.maxSupply - d.minted;
        uint256 cap = market.minterCap(id, address(this));
        return cap < left ? cap : left;
    }

    /// @notice BEM sent here by mistake belongs to nobody (a purchase never leaves any behind); anyone may burn it.
    function burnStray() external nonReentrant {
        uint256 stray = bem.balanceOf(address(this));
        if (stray == 0) revert BadTerms();
        totalBurned += stray;
        emit Burned(msg.sender, stray);
        bem.safeTransfer(BURN, stray);
    }

    /* ── owner ───────────────────────────────────────────────────────────── */

    /// @notice Set an item's price within the fixed bounds, or 0 to stop sales. Where the BEM goes cannot change.
    function setPrice(uint256 id, uint96 price_) external onlyOwner {
        if (price_ != 0 && (price_ < MIN_PRICE || price_ > MAX_PRICE)) revert BadTerms();
        price[id] = price_;
        emit PriceSet(id, price_);
    }

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert BadTerms();
        signer = signer_;
        emit SignerSet(signer_);
    }
}
