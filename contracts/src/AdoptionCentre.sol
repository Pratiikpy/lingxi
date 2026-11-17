// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PetRegistry} from "./PetRegistry.sol";

/// @title Lingxi adoption centre
/// @notice A breeder can offer a little one they hatched for adoption, for BEM. Only a pet that was bred (it has
/// parents), has never changed hands, and is still young can be offered: a pet someone raised is never for sale
/// here. The listing fixes a fingerprint of the pet's on-chain record, so nothing about it can change while it
/// waits. On adoption the buyer pays in BEM, straight from their wallet: the fee is burned, a share goes to the
/// owner of the other parent, the rest to the breeder; this contract never holds BEM. The pet then belongs to the
/// buyer, and having changed hands once it can never be offered here again.
contract AdoptionCentre is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// BEM has no burn function and refuses transfers to the zero address, so burning sends here.
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    /// Young: before the game's teen stage, which begins on a pet's fourth day.
    uint256 public constant YOUNG_AGE = 3 days;
    /// Price bounds (BEM has 8 decimals): 0.01 to 100 BEM.
    uint96 public constant MIN_PRICE = 1_000_000;
    uint96 public constant MAX_PRICE = 100e8;
    uint16 public constant MAX_FEE_BPS = 500;
    /// The other parent's owner always gets this share of the price.
    uint16 public constant COPARENT_BPS = 1000;

    struct Listing {
        address seller;
        uint96 price;
        uint64 expiresAt;
        bytes32 fingerprint;
    }

    PetRegistry public immutable registry;
    IERC20 public immutable bem;
    uint16 public feeBps = 300;
    uint256 public totalBurned;
    mapping(uint256 => Listing) public listings;
    /// Pets currently offered, for reading without logs; a pet leaves it when adopted or withdrawn.
    uint256[] private _open;
    mapping(uint256 => uint256) private _openAt; // index + 1

    event Listed(uint256 indexed petId, address indexed seller, uint96 price, uint64 expiresAt);
    event Withdrawn(uint256 indexed petId);
    event Adopted(uint256 indexed petId, address indexed seller, address indexed buyer, uint96 price, uint256 burned, address coParent, uint256 coParentShare);
    event Burned(address indexed payer, uint256 amount);
    event FeeChanged(uint16 feeBps);

    error NotYours();
    error NotBred();
    error AlreadyMoved();
    error NotYoung();
    error BadTerms();
    error NotApproved();
    error NotListed();
    error Expired();
    error PriceMoved();
    error OwnSale();
    error Changed();

    constructor(PetRegistry registry_, IERC20 bem_, address owner_) Ownable(owner_) {
        if (address(registry_) == address(0) || address(bem_) == address(0)) revert BadTerms();
        registry = registry_;
        bem = bem_;
    }

    /* ── offering ────────────────────────────────────────────────────────── */

    /// @notice Offer a little one you hatched. It must still be young when the offer ends.
    function list(uint256 petId, uint96 price, uint64 expiresAt) external {
        if (registry.ownerOf(petId) != msg.sender) revert NotYours();
        PetRegistry.Pet memory p = registry.pet(petId);
        if (p.parentA == 0) revert NotBred();
        if (registry.transferCount(petId) != 0) revert AlreadyMoved();
        if (block.timestamp >= uint256(p.born) + YOUNG_AGE) revert NotYoung();
        if (price < MIN_PRICE || price > MAX_PRICE) revert BadTerms();
        if (expiresAt <= block.timestamp || expiresAt > uint256(p.born) + YOUNG_AGE) revert BadTerms();
        if (!_approved(msg.sender, petId)) revert NotApproved();
        listings[petId] = Listing({seller: msg.sender, price: price, expiresAt: expiresAt, fingerprint: fingerprint(petId)});
        if (_openAt[petId] == 0) {
            _open.push(petId);
            _openAt[petId] = _open.length;
        }
        emit Listed(petId, msg.sender, price, expiresAt);
    }

    /// @notice Take an offer back. Its breeder may always; anyone may clear one that can no longer be adopted.
    function withdraw(uint256 petId) external {
        Listing memory l = listings[petId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.sender != l.seller && _live(petId, l)) revert NotYours();
        _close(petId);
        emit Withdrawn(petId);
    }

    /* ── adopting ────────────────────────────────────────────────────────── */

    /// @notice Adopt an offered little one. `expectedPrice` guards against a relisting in flight.
    function adopt(uint256 petId, uint96 expectedPrice) external nonReentrant {
        Listing memory l = listings[petId];
        if (l.seller == address(0)) revert NotListed();
        if (block.timestamp >= l.expiresAt) revert Expired();
        if (l.price != expectedPrice) revert PriceMoved();
        if (msg.sender == l.seller) revert OwnSale();
        if (registry.ownerOf(petId) != l.seller || registry.transferCount(petId) != 0) revert AlreadyMoved();
        if (fingerprint(petId) != l.fingerprint) revert Changed();
        _close(petId);

        uint256 fee = (uint256(l.price) * feeBps + 9_999) / 10_000;
        address coParent = coParentOf(petId, l.seller);
        uint256 share = coParent == address(0) ? 0 : (uint256(l.price) * COPARENT_BPS) / 10_000;
        totalBurned += fee;
        emit Burned(msg.sender, fee);
        emit Adopted(petId, l.seller, msg.sender, l.price, fee, coParent, share);
        // BEM moves straight from the buyer: burned, the other parent's share, the rest to the breeder
        if (fee > 0) bem.safeTransferFrom(msg.sender, BURN, fee);
        if (share > 0) bem.safeTransferFrom(msg.sender, coParent, share);
        bem.safeTransferFrom(msg.sender, l.seller, uint256(l.price) - fee - share);
        registry.safeTransferFrom(l.seller, msg.sender, petId);
    }

    /* ── reading ─────────────────────────────────────────────────────────── */

    /// @notice What the listing fixes: the pet's saved state, its log, its day and its brain.
    function fingerprint(uint256 petId) public view returns (bytes32) {
        PetRegistry.Pet memory p = registry.pet(petId);
        return keccak256(abi.encode(p.state, p.logHash, p.day, p.processor, p.brainId, p.brainBits));
    }

    /// @notice Who gets the co-parent share: the owner of whichever parent the breeder does not own, if any.
    function coParentOf(uint256 petId, address seller) public view returns (address) {
        PetRegistry.Pet memory p = registry.pet(petId);
        address a = registry.ownerOf(p.parentA);
        address b = registry.ownerOf(p.parentB);
        if (a == seller && b != seller) return b;
        if (b == seller && a != seller) return a;
        return address(0);
    }

    /// @notice Can this pet be adopted right now.
    function isLive(uint256 petId) external view returns (bool) {
        return _live(petId, listings[petId]);
    }

    /// @notice Every pet on offer (live or not yet cleared).
    function open() external view returns (uint256[] memory) {
        return _open;
    }

    /* ── owner ───────────────────────────────────────────────────────────── */

    /// @notice The fee rate can change within its ceiling; where the fee goes cannot.
    function setFee(uint16 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert BadTerms();
        feeBps = feeBps_;
        emit FeeChanged(feeBps_);
    }

    /* ── internals ───────────────────────────────────────────────────────── */

    function _live(uint256 petId, Listing memory l) private view returns (bool) {
        return
            l.seller != address(0) &&
            block.timestamp < l.expiresAt &&
            registry.ownerOf(petId) == l.seller &&
            registry.transferCount(petId) == 0 &&
            fingerprint(petId) == l.fingerprint &&
            _approved(l.seller, petId);
    }

    function _approved(address owner_, uint256 petId) private view returns (bool) {
        return registry.getApproved(petId) == address(this) || registry.isApprovedForAll(owner_, address(this));
    }

    function _close(uint256 petId) private {
        delete listings[petId];
        uint256 at = _openAt[petId];
        if (at == 0) return;
        uint256 last = _open[_open.length - 1];
        _open[at - 1] = last;
        _openAt[last] = at;
        _open.pop();
        delete _openAt[petId];
    }
}
