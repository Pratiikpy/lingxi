// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {OutfitMarketV2} from "../src/OutfitMarketV2.sol";

/// BEM's shape: a plain ERC-20 with 8 decimals.
contract MockBEM is ERC20 {
    constructor() ERC20("BEM", "BEM") {}

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// A token that delivers less than it was asked to move: the market must refuse it.
contract ShortToken is MockBEM {
    function transferFrom(address from, address to, uint256 a) public override returns (bool) {
        _transfer(from, to, a - a / 100);
        return true;
    }
}

/// A buyer contract that tries to re-enter the market when it receives a copy.
contract Reenterer is IERC1155Receiver {
    OutfitMarketV2 immutable m;
    uint256 public listingId;
    bool public reentered;

    constructor(OutfitMarketV2 m_, IERC20 bem) {
        m = m_;
        bem.approve(address(m_), type(uint256).max);
    }

    function arm(uint256 id) external {
        listingId = id;
    }

    function buy(uint256 id, uint32 q, uint96 p) external {
        m.buy(id, q, p);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        if (listingId != 0) {
            uint256 id = listingId;
            listingId = 0;
            try m.buy(id, 1, 1e8) {
                reentered = true;
            } catch {}
            try m.withdraw() {
                reentered = true;
            } catch {}
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 i) external pure returns (bool) {
        return i == type(IERC1155Receiver).interfaceId;
    }
}

/// A buyer contract that, on receiving a sale, moves its own copies away to keep an old listing alive.
contract Sneaky is IERC1155Receiver {
    OutfitMarketV2 immutable m;
    bool public moving;

    constructor(OutfitMarketV2 m_, IERC20 bem) {
        m = m_;
        bem.approve(address(m_), type(uint256).max);
    }

    function buy(uint256 id, uint32 q, uint96 p) external {
        m.buy(id, q, p);
    }

    function listAll(uint256 id, uint32 q, uint96 p, uint64 until) external returns (uint256) {
        return m.list(id, q, p, until, address(0));
    }

    function arm() external {
        moving = true;
    }

    function onERC1155Received(address, address from, uint256 id, uint256, bytes calldata) external returns (bytes4) {
        if (moving && from != address(this)) {
            moving = false;
            m.safeTransferFrom(address(this), address(0xF00D), id, 1, "");
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 i) external pure returns (bool) {
        return i == type(IERC1155Receiver).interfaceId;
    }
}

contract OutfitMarketV2Test is Test {
    OutfitMarketV2 m;
    MockBEM bem;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11);
    address creator = address(0xC0);
    address alice = address(0xA1);
    address bob = address(0xB0);
    uint96 constant ONE = 1e8; // 1 BEM

    // head slot, 3 wide, 2 tall, 2 colours, 6 cells = 12 bits = 2 bytes
    bytes hat = hex"00030202ff0000ffff00a50a";

    function setUp() public {
        bem = new MockBEM();
        m = new OutfitMarketV2(owner, IERC20(address(bem)));
        address[3] memory people = [alice, bob, creator];
        for (uint256 i = 0; i < 3; i++) {
            bem.mint(people[i], 1_000 * uint256(ONE));
            vm.prank(people[i]);
            bem.approve(address(m), type(uint256).max);
        }
    }

    function _create(uint96 price, uint32 supply, uint16 royalty) internal returns (uint256 id) {
        vm.prank(creator);
        id = m.create(hat, "Red cap", price, supply, royalty);
    }

    function _until() internal view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    function _list(address who, uint256 id, uint32 q, uint96 p) internal returns (uint256 lid) {
        vm.prank(who);
        lid = m.list(id, q, p, _until(), address(0));
    }

    /* ── ported from V1 ──────────────────────────────────────────────────── */

    function test_createGivesTheCreatorOneCopyAndKeepsThePixels() public {
        uint256 id = _create(ONE, 10, 500);
        assertEq(m.balanceOf(creator, id), 1);
        OutfitMarketV2.Design memory d = m.design(id);
        assertEq(d.creator, creator);
        assertEq(d.pixels, hat);
        assertEq(d.minted, 1);
        assertEq(d.name, "Red cap");
        assertFalse(d.item);
    }

    function test_badDesignsAreRefused() public {
        vm.startPrank(creator);
        vm.expectRevert(OutfitMarketV2.BadPixels.selector);
        m.create(hex"03030202ff0000ffff00a50a", "x", 1, 1, 0); // slot 3
        vm.expectRevert(OutfitMarketV2.BadPixels.selector);
        m.create(hex"000e0202ff0000ffff00a50a", "x", 1, 1, 0); // 14 wide
        vm.expectRevert(OutfitMarketV2.BadPixels.selector);
        m.create(hex"00030204ff0000ffff00a50a", "x", 1, 1, 0); // 4 colours
        vm.expectRevert(OutfitMarketV2.BadPixels.selector);
        m.create(hex"00030202ff0000ffff00a5", "x", 1, 1, 0); // a cell byte short
        vm.expectRevert(OutfitMarketV2.BadPixels.selector);
        m.create(hex"00030202ff0000ffff00a50f", "x", 1, 1, 0); // cells use colour 3 of 2
        vm.expectRevert(OutfitMarketV2.BadPixels.selector);
        m.create(hex"00030202ff0000ffff00a54a", "x", 1, 1, 0); // stray bits after the last cell
        vm.expectRevert(OutfitMarketV2.BadName.selector);
        m.create(hat, "", 1, 1, 0);
        vm.expectRevert(OutfitMarketV2.BadName.selector);
        m.create(hat, "a name far too long for any outfit at all", 1, 1, 0);
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.create(hat, "x", 1, 0, 0);
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.create(hat, "x", 1, 10, 1001);
        vm.stopPrank();
    }

    function test_primarySaleBurnsTheFeeAndPaysTheCreator() public {
        uint256 id = _create(ONE, 10, 500);
        vm.prank(alice);
        m.mint(id, 3, ONE);
        assertEq(m.balanceOf(alice, id), 3);
        assertEq(bem.balanceOf(DEAD), 0.09e8);
        assertEq(m.totalBurned(), 0.09e8);
        assertEq(m.owed(creator), 2.91e8);
        assertEq(bem.balanceOf(address(m)), 2.91e8);
        assertEq(bem.balanceOf(alice), 997e8);
    }

    function test_primarySaleRefusesMovedPriceSoldOutAndClosed() public {
        uint256 id = _create(ONE, 3, 0);
        vm.startPrank(alice);
        vm.expectRevert(OutfitMarketV2.PriceMoved.selector);
        m.mint(id, 1, ONE / 2);
        vm.expectRevert(OutfitMarketV2.SoldOut.selector);
        m.mint(id, 3, ONE); // 1 already minted to the creator
        m.mint(id, 2, ONE);
        vm.stopPrank();
        uint256 id2 = _create(ONE, 10, 0);
        vm.prank(creator);
        m.setPrice(id2, ONE, true);
        vm.prank(alice);
        vm.expectRevert(OutfitMarketV2.NotForSale.selector);
        m.mint(id2, 1, ONE);
        vm.prank(alice);
        vm.expectRevert(OutfitMarketV2.NotCreator.selector);
        m.setPrice(id2, 0, false);
        vm.expectRevert(OutfitMarketV2.NoDesign.selector);
        m.mint(99, 1, ONE);
    }

    function test_aBuyerWithoutAllowanceOrBalanceIsRefusedAndNothingMoves() public {
        uint256 id = _create(ONE, 10, 0);
        address poor = address(0xBAD);
        vm.prank(poor);
        vm.expectRevert();
        m.mint(id, 1, ONE);
        assertEq(m.balanceOf(poor, id), 0);
        assertEq(m.totalBurned(), 0);
    }

    function test_resaleBurnsTheFeePaysRoyaltyAndSeller() public {
        uint256 id = _create(ONE, 10, 500);
        vm.prank(alice);
        m.mint(id, 2, ONE);
        uint256 lid = _list(alice, id, 2, 2 * ONE);
        uint256 creatorBefore = m.owed(creator);
        uint256 burnedBefore = m.totalBurned();
        vm.prank(bob);
        m.buy(lid, 1, 2 * ONE);
        assertEq(m.balanceOf(bob, id), 1);
        assertEq(m.balanceOf(alice, id), 1);
        assertEq(m.totalBurned() - burnedBefore, 0.06e8);
        assertEq(m.owed(creator) - creatorBefore, 0.1e8);
        assertEq(m.owed(alice), 1.84e8);
        (,, uint32 left,,,,,) = m.listings(lid);
        assertEq(left, 1);
    }

    function test_theCreatorReselingPaysNoRoyaltyToItself() public {
        uint256 id = _create(ONE, 10, 1000);
        uint256 lid = _list(creator, id, 1, ONE);
        vm.prank(bob);
        m.buy(lid, 1, ONE);
        assertEq(m.owed(creator), 0.97e8);
        (address seller,,,,,,,) = m.listings(lid);
        assertEq(seller, address(0)); // a fully bought listing is gone
    }

    function test_aListingWhoseCopiesMovedCannotBeBought() public {
        uint256 id = _create(ONE, 10, 0);
        vm.prank(alice);
        m.mint(id, 1, ONE);
        uint256 lid = _list(alice, id, 1, ONE);
        vm.prank(alice);
        m.safeTransferFrom(alice, address(0xD00D), id, 1, "");
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.NoListing.selector);
        m.buy(lid, 1, ONE);
        // getting a copy back does not bring the old listing back
        vm.prank(address(0xD00D));
        m.safeTransferFrom(address(0xD00D), alice, id, 1, "");
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.NoListing.selector);
        m.buy(lid, 1, ONE);
        assertEq(bem.balanceOf(bob), 1_000e8);
    }

    function test_aPartlyBoughtListingStaysOpen() public {
        uint256 id = _create(ONE, 10, 0);
        vm.prank(alice);
        m.mint(id, 3, ONE);
        uint256 lid = _list(alice, id, 3, ONE);
        vm.prank(bob);
        m.buy(lid, 1, ONE);
        vm.prank(bob);
        m.buy(lid, 2, ONE);
        assertEq(m.balanceOf(bob, id), 3);
    }

    function test_listingRulesAndCancel() public {
        uint256 id = _create(ONE, 10, 0);
        uint64 until = _until();
        vm.prank(alice);
        vm.expectRevert(OutfitMarketV2.NotEnoughHeld.selector);
        m.list(id, 1, ONE, until, address(0));
        vm.prank(creator);
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.list(id, 1, 0, until, address(0));
        uint256 lid = _list(creator, id, 1, ONE);
        vm.prank(alice);
        vm.expectRevert(OutfitMarketV2.NotSeller.selector);
        m.cancel(lid);
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.PriceMoved.selector);
        m.buy(lid, 1, ONE / 2);
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.buy(lid, 2, ONE);
        vm.prank(creator);
        m.cancel(lid);
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.NoListing.selector);
        m.buy(lid, 1, ONE);
    }

    function test_withdrawPaysOnceInBem() public {
        uint256 id = _create(ONE, 10, 0);
        vm.prank(alice);
        m.mint(id, 1, ONE);
        uint256 before = bem.balanceOf(creator);
        vm.prank(creator);
        m.withdraw();
        assertEq(bem.balanceOf(creator) - before, 0.97e8);
        vm.prank(creator);
        vm.expectRevert(OutfitMarketV2.NothingOwed.selector);
        m.withdraw();
        assertEq(bem.balanceOf(address(m)), 0);
    }

    function test_reentryOnReceiptIsRefused() public {
        uint256 id = _create(ONE, 10, 0);
        uint256 lid = _list(creator, id, 1, ONE);
        vm.prank(alice);
        m.mint(id, 2, ONE);
        uint256 lid2 = _list(alice, id, 2, ONE);
        Reenterer r = new Reenterer(m, IERC20(address(bem)));
        bem.mint(address(r), 5e8);
        r.arm(lid2);
        r.buy(lid, 1, ONE);
        assertFalse(r.reentered());
        assertEq(m.balanceOf(address(r), id), 1);
        (,, uint32 left,,,,,) = m.listings(lid2);
        assertEq(left, 2);
    }

    function test_movingCopiesInsideASaleCallbackStillRetiresListings() public {
        uint256 id = _create(ONE, 10, 0);
        Sneaky s = new Sneaky(m, IERC20(address(bem)));
        bem.mint(address(s), 5e8);
        vm.prank(alice);
        m.mint(id, 1, ONE);
        vm.prank(alice);
        m.safeTransferFrom(alice, address(s), id, 1, "");
        uint256 its = s.listAll(id, 1, ONE, _until());
        uint256 lid = _list(creator, id, 1, ONE);
        s.arm();
        s.buy(lid, 1, ONE);
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.NoListing.selector);
        m.buy(its, 1, ONE);
    }

    /// Every design the game's encoder writes (packages/art designs.ts) is accepted.
    function test_acceptsEveryDesignTheGameEncodes() public {
        bytes[] memory designs = vm.parseJsonBytesArray(vm.readFile("test/fixtures/designs.json"), ".designs");
        assertEq(designs.length, 40);
        vm.startPrank(creator);
        for (uint256 i = 0; i < designs.length; i++) m.create(designs[i], "piece", 10_000, 5, 0);
        vm.stopPrank();
        assertEq(m.nextDesign(), 41);
    }

    function test_onlyTheOwnerSetsTheFeeWithinItsCeilingAndCannotRedirectIt() public {
        vm.expectRevert();
        m.setFee(100);
        vm.prank(owner);
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.setFee(501);
        vm.prank(owner);
        m.setFee(0);
        uint256 id = _create(ONE, 10, 0);
        vm.prank(alice);
        m.mint(id, 1, ONE);
        assertEq(m.owed(creator), ONE);
        assertEq(m.totalBurned(), 0);
        assertEq(m.BURN(), DEAD);
    }

    /// Every BEM base unit paid is burned or owed, and the contract holds exactly what is owed.
    function testFuzz_splitsAddUp(uint96 price, uint32 q, uint16 royalty, uint16 fee) public {
        price = uint96(bound(price, 10_000, 1e14));
        q = uint32(bound(q, 1, 50));
        royalty = uint16(bound(royalty, 0, 1000));
        fee = uint16(bound(fee, 0, 500));
        vm.prank(owner);
        m.setFee(fee);
        uint256 id = _create(price, 1000, royalty);
        uint256 total = uint256(price) * q;
        bem.mint(alice, total);
        bem.mint(bob, total);
        vm.prank(alice);
        m.mint(id, q, price);
        uint256 lid = _list(alice, id, q, price);
        vm.prank(bob);
        m.buy(lid, q, price);
        assertEq(m.owed(creator) + m.owed(alice), bem.balanceOf(address(m)));
        assertEq(bem.balanceOf(address(m)) + m.totalBurned(), total * 2);
        assertEq(bem.balanceOf(DEAD), m.totalBurned());
    }

    /* ── new in V2 ───────────────────────────────────────────────────────── */

    function test_aShortPayingTokenIsRefused() public {
        ShortToken t = new ShortToken();
        OutfitMarketV2 m2 = new OutfitMarketV2(owner, IERC20(address(t)));
        vm.prank(creator);
        uint256 id = m2.create(hat, "Red cap", ONE, 10, 0);
        t.mint(alice, 10e8);
        vm.startPrank(alice);
        t.approve(address(m2), type(uint256).max);
        vm.expectRevert(OutfitMarketV2.WrongPayment.selector);
        m2.mint(id, 1, ONE);
        vm.stopPrank();
    }

    function test_listingsExpireAndRefuseLongOrPastExpiries() public {
        uint256 id = _create(ONE, 10, 0);
        vm.startPrank(creator);
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.list(id, 1, ONE, uint64(block.timestamp), address(0));
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.list(id, 1, ONE, uint64(block.timestamp + 181 days), address(0));
        uint256 lid = m.list(id, 1, ONE, uint64(block.timestamp + 1 days), address(0));
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.Expired.selector);
        m.buy(lid, 1, ONE);
    }

    function test_aNamedBuyerListingSellsOnlyToThem() public {
        uint256 id = _create(ONE, 10, 0);
        vm.prank(creator);
        uint256 lid = m.list(id, 1, ONE, _until(), bob);
        vm.prank(alice);
        vm.expectRevert(OutfitMarketV2.NotTheBuyer.selector);
        m.buy(lid, 1, ONE);
        vm.prank(bob);
        m.buy(lid, 1, ONE);
        assertEq(m.balanceOf(bob, id), 1);
    }

    function test_aSellerCannotBuyTheirOwnListing() public {
        uint256 id = _create(ONE, 10, 0);
        uint256 lid = _list(creator, id, 1, ONE);
        vm.prank(creator);
        vm.expectRevert(OutfitMarketV2.NotTheBuyer.selector);
        m.buy(lid, 1, ONE);
    }

    function test_onlyTheOwnerMakesItemKindsWhichHaveNoPrimarySale() public {
        vm.prank(alice);
        vm.expectRevert();
        m.createItem("Lantern", 100);
        vm.prank(owner);
        uint256 id = m.createItem("Lantern", 100);
        OutfitMarketV2.Design memory d = m.design(id);
        assertTrue(d.item);
        assertEq(d.creator, owner);
        assertEq(d.minted, 0);
        assertEq(d.pixels.length, 0);
        vm.prank(alice);
        vm.expectRevert(OutfitMarketV2.NotForSale.selector);
        m.mint(id, 1, 0);
        vm.prank(owner);
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.setPrice(id, ONE, false);
        vm.prank(owner);
        vm.expectRevert(OutfitMarketV2.BadName.selector);
        m.createItem("", 1);
    }

    function test_grantedMintersMintFreeCopiesUpToTheirCapAndTheSupply() public {
        vm.prank(owner);
        uint256 item = m.createItem("Lantern", 3);
        address shop = address(0x5409);
        vm.prank(alice);
        vm.expectRevert(OutfitMarketV2.NotCreator.selector);
        m.setMinter(item, shop, 5);
        vm.prank(owner);
        m.setMinter(item, shop, 5);
        vm.prank(alice);
        vm.expectRevert(OutfitMarketV2.NotMinter.selector);
        m.mintTo(item, alice, 1);
        vm.prank(shop);
        m.mintTo(item, alice, 2);
        assertEq(m.balanceOf(alice, item), 2);
        vm.prank(shop);
        vm.expectRevert(OutfitMarketV2.SoldOut.selector);
        m.mintTo(item, alice, 2); // the kind's supply of 3 binds before the cap of 5
        assertEq(m.minterCap(item, shop), 3); // a grant counts down like an allowance
        vm.prank(owner);
        uint256 big = m.createItem("Pebble", 100);
        vm.prank(owner);
        m.setMinter(big, shop, 2);
        vm.prank(shop);
        vm.expectRevert(OutfitMarketV2.OverCap.selector);
        m.mintTo(big, bob, 3);
        vm.prank(shop);
        m.mintTo(big, bob, 2);
        vm.prank(shop);
        vm.expectRevert(OutfitMarketV2.NotMinter.selector); // the grant is used up
        m.mintTo(big, bob, 1);
        vm.prank(owner);
        m.setMinter(big, shop, 5);
        vm.prank(owner);
        m.setMinter(big, shop, 0); // revoked
        vm.prank(shop);
        vm.expectRevert(OutfitMarketV2.NotMinter.selector);
        m.mintTo(big, bob, 1);
        assertEq(m.balanceOf(bob, big), 2);
    }

    function test_aCreatorCanGrantAMinterForAnOutfitAndCopiesAreSellableAfter() public {
        uint256 id = _create(ONE, 100, 500);
        address gift = address(0x9F7);
        vm.prank(creator);
        m.setMinter(id, gift, 10);
        vm.prank(gift);
        m.mintTo(id, alice, 1);
        assertEq(m.design(id).minted, 2);
        uint256 lid = _list(alice, id, 1, ONE);
        vm.prank(bob);
        m.buy(lid, 1, ONE);
        assertEq(m.balanceOf(bob, id), 1);
        assertEq(m.owed(creator), 0.05e8); // royalty still reaches the creator
    }

    function test_itemCopiesCanBeListedAndSold() public {
        vm.prank(owner);
        uint256 item = m.createItem("Lantern", 10);
        vm.prank(owner);
        m.setMinter(item, owner, 10);
        vm.prank(owner);
        m.mintTo(item, alice, 1);
        uint256 lid = _list(alice, item, 1, ONE);
        vm.prank(bob);
        m.buy(lid, 1, ONE);
        assertEq(m.balanceOf(bob, item), 1);
        assertEq(m.owed(alice), 0.97e8);
    }

    function test_ownershipMovesInTwoSteps() public {
        vm.prank(owner);
        m.transferOwnership(alice);
        assertEq(m.owner(), owner);
        vm.prank(alice);
        m.acceptOwnership();
        assertEq(m.owner(), alice);
    }
}
