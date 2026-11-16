// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Utils} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Utils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Lingxi fashion market, paid in BEM
/// @notice Outfits drawn by players (pixels on chain) and item kinds made by the game, as ERC-1155 types.
/// Prices are in BEM. Every sale sends the market fee to the dead address in the same transaction, so the
/// fee is burned and nobody can redirect it; on resales the creator's royalty is paid next, then the seller.
/// Royalties and proceeds are credited and withdrawn by their owners (pull payments).
/// Copies of an item kind, and gift copies of an outfit, come only from a minter its creator granted.
/// Cosmetic only: an outfit or item changes how a pet looks, never how it thinks, fights or earns.
contract OutfitMarketV2 is ERC1155, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// BEM has no burn function and refuses transfers to the zero address, so burning sends here.
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    /// Pixel data: slot (1 byte), width, height, colour count, colours (3 bytes each), then 2-bit cells.
    uint256 public constant MAX_PIXELS = 96;
    uint256 public constant MAX_NAME = 32;
    uint16 public constant MAX_FEE_BPS = 500;
    uint16 public constant MAX_ROYALTY_BPS = 1000;
    uint32 public constant MAX_SUPPLY = 100_000;
    uint256 public constant MAX_LISTING = 180 days;
    /// The smallest price a copy can have (0.0001 BEM), so a fee rounded up never exceeds its rate by more than 0.01%.
    uint96 public constant MIN_PRICE = 10_000;

    struct Design {
        address creator;
        uint96 price; // primary price per copy in BEM base units; 0 = not for primary sale
        uint32 maxSupply;
        uint32 minted;
        uint16 royaltyBps;
        bool closed; // the creator stopped primary sales
        bool item; // an item kind made by the game: no pixels, copies only from granted minters
        string name;
        bytes pixels;
    }

    struct Listing {
        address seller;
        uint256 id;
        uint32 quantity;
        uint96 priceEach;
        uint32 nonce; // the seller's listing nonce for this type when listed
        uint64 expiresAt;
        address buyer; // zero = anyone
        uint16 feeBps; // the fee when listed: a later raise never applies to this listing
    }

    IERC20 public immutable bem;
    uint256 public nextDesign = 1;
    uint256 public nextListing = 1;
    uint16 public feeBps = 300;
    uint256 public totalBurned;

    mapping(uint256 => Design) private _designs;
    mapping(uint256 => Listing) public listings;
    mapping(address => uint256) public owed;
    /// The sum of `owed`; the market's BEM balance never falls below it.
    uint256 public totalOwed;
    /// Moving copies out (other than through a sale here) bumps this, retiring the holder's open listings.
    mapping(address => mapping(uint256 => uint32)) public listNonce;
    /// Free copies a minter may still make, per type, as granted by the type's creator.
    mapping(uint256 => mapping(address => uint32)) public minterCap;
    bool private _selling;

    event Created(uint256 indexed id, address indexed creator, uint8 slot, uint96 price, uint32 maxSupply, uint16 royaltyBps, string name);
    event ItemCreated(uint256 indexed id, uint32 maxSupply, string name);
    event PriceChanged(uint256 indexed id, uint96 price, bool closed);
    event MinterSet(uint256 indexed id, address indexed minter, uint32 cap);
    event Minted(uint256 indexed id, address indexed buyer, uint32 quantity, uint256 paid);
    event MintedBy(uint256 indexed id, address indexed minter, address indexed to, uint32 quantity);
    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed id, uint32 quantity, uint96 priceEach, uint64 expiresAt, address buyer);
    event Cancelled(uint256 indexed listingId);
    /// A holder's open listings of a type were retired (copies moved, or one of them sold).
    event ListingsRetired(address indexed holder, uint256 indexed id, uint32 nonce);
    event Sold(uint256 indexed listingId, address indexed buyer, uint32 quantity, uint256 paid);
    event Burned(address indexed payer, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event FeeChanged(uint16 feeBps);

    error BadPixels();
    error BadName();
    error BadTerms();
    error NoDesign();
    error NotCreator();
    error NotForSale();
    error SoldOut();
    error WrongPayment();
    error NotSeller();
    error NotTheBuyer();
    error NoListing();
    error Expired();
    error NotEnoughHeld();
    error PriceMoved();
    error NothingOwed();
    error NotMinter();
    error OverCap();

    constructor(address owner_, IERC20 bem_) ERC1155("") Ownable(owner_) {
        if (address(bem_) == address(0)) revert BadTerms();
        bem = bem_;
    }

    /* ── designs and item kinds ──────────────────────────────────────────── */

    /// @notice Publish an outfit. The creator receives one copy.
    function create(bytes calldata pixels, string calldata name_, uint96 price, uint32 maxSupply, uint16 royaltyBps) external returns (uint256 id) {
        _checkPixels(pixels);
        _checkName(name_);
        if (maxSupply == 0 || maxSupply > MAX_SUPPLY || royaltyBps > MAX_ROYALTY_BPS || (price != 0 && price < MIN_PRICE)) revert BadTerms();
        id = nextDesign++;
        _designs[id] = Design({creator: msg.sender, price: price, maxSupply: maxSupply, minted: 1, royaltyBps: royaltyBps, closed: false, item: false, name: name_, pixels: pixels});
        emit Created(id, msg.sender, uint8(pixels[0]), price, maxSupply, royaltyBps, name_);
        _mint(msg.sender, id, 1, "");
    }

    /// @notice The game makes an item kind. It has no primary sale; copies come only from granted minters.
    function createItem(string calldata name_, uint32 maxSupply) external onlyOwner returns (uint256 id) {
        _checkName(name_);
        if (maxSupply == 0 || maxSupply > MAX_SUPPLY) revert BadTerms();
        id = nextDesign++;
        _designs[id] = Design({creator: msg.sender, price: 0, maxSupply: maxSupply, minted: 0, royaltyBps: 0, closed: true, item: true, name: name_, pixels: ""});
        emit ItemCreated(id, maxSupply, name_);
    }

    /// @notice The creator changes an outfit's primary price, or stops primary sales.
    function setPrice(uint256 id, uint96 price, bool closed) external {
        Design storage d = _creatorsDesign(id);
        if (d.item || (price != 0 && price < MIN_PRICE)) revert BadTerms();
        d.price = price;
        d.closed = closed;
        emit PriceChanged(id, price, closed);
    }

    /// @notice The creator lets `minter` make up to `cap` free copies (0 revokes).
    function setMinter(uint256 id, address minter, uint32 cap) external {
        _creatorsDesign(id);
        if (minter == address(0)) revert BadTerms();
        minterCap[id][minter] = cap;
        emit MinterSet(id, minter, cap);
    }

    function design(uint256 id) external view returns (Design memory) {
        Design memory d = _designs[id];
        if (d.creator == address(0)) revert NoDesign();
        return d;
    }

    /* ── copies ──────────────────────────────────────────────────────────── */

    /// @notice Buy copies from the creator in BEM. `expectedPrice` guards against a price change in flight.
    function mint(uint256 id, uint32 quantity, uint96 expectedPrice) external nonReentrant {
        Design storage d = _designs[id];
        if (d.creator == address(0)) revert NoDesign();
        if (d.closed || d.price == 0) revert NotForSale();
        if (d.price != expectedPrice) revert PriceMoved();
        if (quantity == 0 || uint256(d.minted) + quantity > d.maxSupply) revert SoldOut();
        uint256 total = uint256(d.price) * quantity;
        d.minted += quantity;
        _collect(total);
        uint256 fee = _burnFee(total, feeBps);
        _credit(d.creator, total - fee);
        emit Minted(id, msg.sender, quantity, total);
        _mint(msg.sender, id, quantity, "");
    }

    /// @notice A granted minter makes free copies, within its cap and the type's supply.
    function mintTo(uint256 id, address to, uint32 quantity) external nonReentrant {
        Design storage d = _designs[id];
        if (d.creator == address(0)) revert NoDesign();
        uint32 cap = minterCap[id][msg.sender];
        if (cap == 0) revert NotMinter();
        if (quantity == 0 || uint256(d.minted) + quantity > d.maxSupply) revert SoldOut();
        if (quantity > cap) revert OverCap();
        minterCap[id][msg.sender] = cap - quantity;
        d.minted += quantity;
        emit MintedBy(id, msg.sender, to, quantity);
        _mint(to, id, quantity, "");
    }

    /* ── resale (after Aavegotchi's ERC1155 listings) ────────────────────── */

    /// @notice List copies for resale until `expiresAt`, to anyone or to one named buyer. Nothing is escrowed.
    function list(uint256 id, uint32 quantity, uint96 priceEach, uint64 expiresAt, address buyer) external returns (uint256 listingId) {
        if (_designs[id].creator == address(0)) revert NoDesign();
        if (quantity == 0 || priceEach < MIN_PRICE) revert BadTerms();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_LISTING) revert BadTerms();
        if (buyer == msg.sender) revert BadTerms();
        if (balanceOf(msg.sender, id) < quantity) revert NotEnoughHeld();
        listingId = nextListing++;
        listings[listingId] = Listing({seller: msg.sender, id: id, quantity: quantity, priceEach: priceEach, nonce: listNonce[msg.sender][id], expiresAt: expiresAt, buyer: buyer, feeBps: feeBps});
        emit Listed(listingId, msg.sender, id, quantity, priceEach, expiresAt, buyer);
    }

    function cancel(uint256 listingId) external {
        Listing storage l = listings[listingId];
        if (l.seller == address(0)) revert NoListing();
        if (l.seller != msg.sender) revert NotSeller();
        delete listings[listingId];
        emit Cancelled(listingId);
    }

    /// @notice Buy from a listing in BEM. `expectedPriceEach` guards against a relisting in flight.
    function buy(uint256 listingId, uint32 quantity, uint96 expectedPriceEach) external nonReentrant {
        Listing memory l = listings[listingId];
        if (l.seller == address(0)) revert NoListing();
        if (l.nonce != listNonce[l.seller][l.id]) revert NoListing();
        if (block.timestamp >= l.expiresAt) revert Expired();
        if (msg.sender == l.seller || (l.buyer != address(0) && l.buyer != msg.sender)) revert NotTheBuyer();
        if (l.priceEach != expectedPriceEach) revert PriceMoved();
        if (quantity == 0 || quantity > l.quantity) revert BadTerms();
        if (balanceOf(l.seller, l.id) < quantity) revert NotEnoughHeld();
        // a sale retires the seller's other listings of this type, so none can come back if copies return;
        // what is left of this listing is re-stamped and stays open
        uint32 n = ++listNonce[l.seller][l.id];
        emit ListingsRetired(l.seller, l.id, n);
        if (quantity == l.quantity) {
            delete listings[listingId];
        } else {
            listings[listingId].quantity = l.quantity - quantity;
            listings[listingId].nonce = n;
        }
        uint256 total = uint256(l.priceEach) * quantity;
        _collect(total);
        Design storage d = _designs[l.id];
        uint256 fee = _burnFee(total, l.feeBps < feeBps ? l.feeBps : feeBps);
        uint256 royalty = l.seller == d.creator ? 0 : (total * d.royaltyBps) / 10_000;
        _credit(d.creator, royalty);
        _credit(l.seller, total - fee - royalty);
        emit Sold(listingId, msg.sender, quantity, total);
        // the sale moves the copies with the flag up, then lowers it before the buyer's contract (if any) is
        // called, so nothing the buyer does in that callback can move copies without retiring listings
        uint256[] memory ids = new uint256[](1);
        uint256[] memory values = new uint256[](1);
        ids[0] = l.id;
        values[0] = quantity;
        _selling = true;
        _update(l.seller, msg.sender, ids, values);
        _selling = false;
        ERC1155Utils.checkOnERC1155Received(msg.sender, l.seller, msg.sender, l.id, quantity, "");
    }

    /* ── proceeds ────────────────────────────────────────────────────────── */

    function withdraw() external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        totalOwed -= amount;
        emit Withdrawn(msg.sender, amount);
        bem.safeTransfer(msg.sender, amount);
    }

    /// @notice Can this listing be bought right now (by someone other than its seller and, if named, its buyer)?
    function isLive(uint256 listingId) external view returns (bool) {
        Listing memory l = listings[listingId];
        return l.seller != address(0) && l.nonce == listNonce[l.seller][l.id] && block.timestamp < l.expiresAt && balanceOf(l.seller, l.id) >= l.quantity;
    }

    /// @notice BEM sent to the market by mistake is not owed to anyone; anyone may burn it. Nobody can take it.
    function burnStray() external nonReentrant {
        uint256 stray = bem.balanceOf(address(this)) - totalOwed;
        if (stray == 0) revert NothingOwed();
        totalBurned += stray;
        emit Burned(msg.sender, stray);
        bem.safeTransfer(BURN, stray);
    }

    /* ── owner ───────────────────────────────────────────────────────────── */

    /// @notice The fee rate can change within its ceiling; where the fee goes cannot.
    function setFee(uint16 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert BadTerms();
        feeBps = feeBps_;
        emit FeeChanged(feeBps_);
    }

    /* ── internals ───────────────────────────────────────────────────────── */

    /// Pull `total` BEM from the caller and refuse a token that delivers less than asked.
    function _collect(uint256 total) private {
        uint256 before = bem.balanceOf(address(this));
        bem.safeTransferFrom(msg.sender, address(this), total);
        if (bem.balanceOf(address(this)) - before != total) revert WrongPayment();
    }

    function _credit(address who, uint256 amount) private {
        owed[who] += amount;
        totalOwed += amount;
    }

    /// The fee rounds up, so a positive rate never burns nothing on a small sale.
    function _burnFee(uint256 total, uint16 bps) private returns (uint256 fee) {
        fee = (total * bps + 9_999) / 10_000;
        if (fee > 0) {
            totalBurned += fee;
            emit Burned(msg.sender, fee);
            bem.safeTransfer(BURN, fee);
        }
    }

    /// Item kinds belong to the game, so they follow the current owner; outfits belong to their creator.
    function _creatorsDesign(uint256 id) private view returns (Design storage d) {
        d = _designs[id];
        if (d.creator == address(0)) revert NoDesign();
        if (d.item ? msg.sender != owner() : d.creator != msg.sender) revert NotCreator();
    }

    /// Any transfer out of a holder, except a sale through `buy`, retires that holder's listings of those types.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0) && !_selling) {
            for (uint256 i = 0; i < ids.length; i++) emit ListingsRetired(from, ids[i], ++listNonce[from][ids[i]]);
        }
        super._update(from, to, ids, values);
    }

    function _checkName(string calldata name_) private pure {
        uint256 n = bytes(name_).length;
        if (n == 0 || n > MAX_NAME) revert BadName();
    }

    /// A design must be one of the three slots, at most 13 wide and 10 tall,
    /// with 1 to 3 colours, and exactly as many cell bytes as its size needs.
    function _checkPixels(bytes calldata p) private pure {
        if (p.length < 7 || p.length > MAX_PIXELS) revert BadPixels();
        uint8 slot = uint8(p[0]);
        uint8 w = uint8(p[1]);
        uint8 h = uint8(p[2]);
        uint8 colours = uint8(p[3]);
        if (slot > 2 || w == 0 || h == 0 || w > 13 || h > 10 || colours == 0 || colours > 3) revert BadPixels();
        uint256 n = uint256(w) * h;
        uint256 base = 4 + uint256(colours) * 3;
        if (p.length != base + (n * 2 + 7) / 8) revert BadPixels();
        for (uint256 k = 0; k < (p.length - base) * 4; k++) {
            uint8 v = (uint8(p[base + k / 4]) >> uint8((k % 4) * 2)) & 3;
            if (k < n ? v > colours : v != 0) revert BadPixels();
        }
    }
}
