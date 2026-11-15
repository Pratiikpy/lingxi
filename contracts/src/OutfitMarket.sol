// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Utils} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Utils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Lingxi fashion market (PRD S3, M4)
/// @notice Outfits drawn by players. Each design is an ERC-1155 type whose pixels
/// live on chain. Its creator sells copies at a fixed price (primary sale) and
/// anyone holding copies can list them for resale (secondary sale, after
/// Aavegotchi's ERC1155MarketplaceFacet). Every sale pays the market fee first,
/// then on resales the creator's royalty, then the seller. Proceeds are credited
/// and withdrawn by their owners (pull payments), so a sale never sends value to
/// an address it does not control. Cosmetic only: an outfit changes how a pet
/// looks, never how it thinks, fights or earns.
contract OutfitMarket is ERC1155, Ownable, ReentrancyGuard {
    /// Pixel data: slot (1 byte), width, height, colour count, colours (3 bytes each), then 2-bit cells.
    uint256 public constant MAX_PIXELS = 96;
    uint256 public constant MAX_NAME = 32;
    /// Market fee ceiling and royalty ceiling, in basis points.
    uint16 public constant MAX_FEE_BPS = 500;
    uint16 public constant MAX_ROYALTY_BPS = 1000;
    uint32 public constant MAX_SUPPLY = 100_000;

    struct Design {
        address creator;
        uint96 price; // primary price per copy, in wei; 0 = not for primary sale
        uint32 maxSupply;
        uint32 minted;
        uint16 royaltyBps;
        bool closed; // the creator stopped primary sales
        string name;
        bytes pixels;
    }

    struct Listing {
        address seller;
        uint256 id;
        uint32 quantity;
        uint96 priceEach;
        uint32 nonce; // the seller's listing nonce for this design when listed
    }

    uint256 public nextDesign = 1;
    uint256 public nextListing = 1;
    uint16 public feeBps = 300;
    address public treasury;

    mapping(uint256 => Design) private _designs;
    mapping(uint256 => Listing) public listings;
    /// Proceeds waiting to be withdrawn.
    mapping(address => uint256) public owed;
    /// Moving copies out (other than through a sale here) bumps this, retiring the holder's open listings of
    /// that design, so a listing can never come back to life when copies are later re-acquired.
    mapping(address => mapping(uint256 => uint32)) public listNonce;
    bool private _selling;

    event Created(uint256 indexed id, address indexed creator, uint8 slot, uint96 price, uint32 maxSupply, uint16 royaltyBps, string name);
    event PriceChanged(uint256 indexed id, uint96 price, bool closed);
    event Minted(uint256 indexed id, address indexed buyer, uint32 quantity, uint256 paid);
    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed id, uint32 quantity, uint96 priceEach);
    event Cancelled(uint256 indexed listingId);
    event Sold(uint256 indexed listingId, address indexed buyer, uint32 quantity, uint256 paid);
    event Withdrawn(address indexed to, uint256 amount);
    event FeeChanged(uint16 feeBps, address indexed treasury);

    error BadPixels();
    error BadName();
    error BadTerms();
    error NoDesign();
    error NotCreator();
    error NotForSale();
    error SoldOut();
    error WrongPayment();
    error NotSeller();
    error NoListing();
    error NotEnoughHeld();
    error PriceMoved();
    error NothingOwed();
    error TransferFailed();

    constructor(address owner_, address treasury_) ERC1155("") Ownable(owner_) {
        if (treasury_ == address(0)) revert BadTerms();
        treasury = treasury_;
    }

    /* ── designs ─────────────────────────────────────────────────────────── */

    /// @notice Publish a design. The creator receives one copy.
    function create(bytes calldata pixels, string calldata name_, uint96 price, uint32 maxSupply, uint16 royaltyBps) external returns (uint256 id) {
        _checkPixels(pixels);
        uint256 nameLen = bytes(name_).length;
        if (nameLen == 0 || nameLen > MAX_NAME) revert BadName();
        if (maxSupply == 0 || maxSupply > MAX_SUPPLY || royaltyBps > MAX_ROYALTY_BPS) revert BadTerms();
        id = nextDesign++;
        _designs[id] = Design({creator: msg.sender, price: price, maxSupply: maxSupply, minted: 1, royaltyBps: royaltyBps, closed: false, name: name_, pixels: pixels});
        emit Created(id, msg.sender, uint8(pixels[0]), price, maxSupply, royaltyBps, name_);
        _mint(msg.sender, id, 1, "");
    }

    /// @notice The creator changes the primary price, or stops primary sales.
    function setPrice(uint256 id, uint96 price, bool closed) external {
        Design storage d = _designs[id];
        if (d.creator == address(0)) revert NoDesign();
        if (d.creator != msg.sender) revert NotCreator();
        d.price = price;
        d.closed = closed;
        emit PriceChanged(id, price, closed);
    }

    function design(uint256 id) external view returns (Design memory) {
        Design memory d = _designs[id];
        if (d.creator == address(0)) revert NoDesign();
        return d;
    }

    /* ── primary sale ────────────────────────────────────────────────────── */

    /// @notice Buy copies from the creator. `expectedPrice` guards against a price change in flight.
    function mint(uint256 id, uint32 quantity, uint96 expectedPrice) external payable nonReentrant {
        Design storage d = _designs[id];
        if (d.creator == address(0)) revert NoDesign();
        if (d.closed || d.price == 0) revert NotForSale();
        if (d.price != expectedPrice) revert PriceMoved();
        if (quantity == 0 || uint256(d.minted) + quantity > d.maxSupply) revert SoldOut();
        uint256 total = uint256(d.price) * quantity;
        if (msg.value != total) revert WrongPayment();
        d.minted += quantity;
        uint256 fee = (total * feeBps) / 10_000;
        owed[treasury] += fee;
        owed[d.creator] += total - fee;
        emit Minted(id, msg.sender, quantity, total);
        _mint(msg.sender, id, quantity, "");
    }

    /* ── resale (after Aavegotchi's ERC1155 listings) ────────────────────── */

    /// @notice List copies for resale. Nothing is escrowed: the copies must still be held when bought.
    function list(uint256 id, uint32 quantity, uint96 priceEach) external returns (uint256 listingId) {
        if (_designs[id].creator == address(0)) revert NoDesign();
        if (quantity == 0 || priceEach == 0) revert BadTerms();
        if (balanceOf(msg.sender, id) < quantity) revert NotEnoughHeld();
        listingId = nextListing++;
        listings[listingId] = Listing({seller: msg.sender, id: id, quantity: quantity, priceEach: priceEach, nonce: listNonce[msg.sender][id]});
        emit Listed(listingId, msg.sender, id, quantity, priceEach);
    }

    function cancel(uint256 listingId) external {
        Listing storage l = listings[listingId];
        if (l.seller == address(0)) revert NoListing();
        if (l.seller != msg.sender) revert NotSeller();
        delete listings[listingId];
        emit Cancelled(listingId);
    }

    /// @notice Buy from a listing. `expectedPriceEach` guards against a relisting in flight.
    function buy(uint256 listingId, uint32 quantity, uint96 expectedPriceEach) external payable nonReentrant {
        Listing memory l = listings[listingId];
        if (l.seller == address(0)) revert NoListing();
        if (l.nonce != listNonce[l.seller][l.id]) revert NoListing();
        if (l.priceEach != expectedPriceEach) revert PriceMoved();
        if (quantity == 0 || quantity > l.quantity) revert BadTerms();
        if (balanceOf(l.seller, l.id) < quantity) revert NotEnoughHeld();
        uint256 total = uint256(l.priceEach) * quantity;
        if (msg.value != total) revert WrongPayment();
        if (quantity == l.quantity) delete listings[listingId];
        else listings[listingId].quantity = l.quantity - quantity;
        Design storage d = _designs[l.id];
        uint256 fee = (total * feeBps) / 10_000;
        uint256 royalty = l.seller == d.creator ? 0 : (total * d.royaltyBps) / 10_000;
        owed[treasury] += fee;
        owed[d.creator] += royalty;
        owed[l.seller] += total - fee - royalty;
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
        emit Withdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /* ── owner ───────────────────────────────────────────────────────────── */

    function setFee(uint16 feeBps_, address treasury_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS || treasury_ == address(0)) revert BadTerms();
        feeBps = feeBps_;
        treasury = treasury_;
        emit FeeChanged(feeBps_, treasury_);
    }

    /// Any transfer out of a holder, except a sale through `buy`, retires that holder's listings of those designs.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0) && !_selling) {
            for (uint256 i = 0; i < ids.length; i++) listNonce[from][ids[i]]++;
        }
        super._update(from, to, ids, values);
    }

    /* ── checks ──────────────────────────────────────────────────────────── */

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
        // every cell names an existing colour (or is empty), and the bits after the last cell are zero
        for (uint256 k = 0; k < (p.length - base) * 4; k++) {
            uint8 v = (uint8(p[base + k / 4]) >> uint8((k % 4) * 2)) & 3;
            if (k < n ? v > colours : v != 0) revert BadPixels();
        }
    }
}
