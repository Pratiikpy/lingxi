// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {OutfitMarket} from "../src/OutfitMarket.sol";

/// A buyer contract that tries to re-enter the market when it receives a copy.
contract Reenterer is IERC1155Receiver {
    OutfitMarket immutable m;
    uint256 public listingId;
    bool public reentered;
    bool public attemptWithdraw;

    constructor(OutfitMarket m_) {
        m = m_;
    }

    function arm(uint256 id, bool withdraw_) external {
        listingId = id;
        attemptWithdraw = withdraw_;
    }

    function buy(uint256 id, uint32 q, uint96 p) external payable {
        m.buy{value: msg.value}(id, q, p);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        if (listingId != 0) {
            uint256 id = listingId;
            listingId = 0;
            try m.buy{value: 0}(id, 1, 0) {
                reentered = true;
            } catch {}
            if (attemptWithdraw) {
                try m.withdraw() {
                    reentered = true;
                } catch {}
            }
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 i) external pure returns (bool) {
        return i == type(IERC1155Receiver).interfaceId;
    }

    receive() external payable {}
}

/// A buyer contract that, on receiving a sale, moves its own copies away to keep an old listing alive.
contract Sneaky is IERC1155Receiver {
    OutfitMarket immutable m;
    bool public moving;

    constructor(OutfitMarket m_) {
        m = m_;
    }

    function buy(uint256 id, uint32 q, uint96 p) external payable {
        m.buy{value: msg.value}(id, q, p);
    }

    function listAll(uint256 id, uint32 q, uint96 p) external returns (uint256) {
        return m.list(id, q, p);
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

/// A seller whose withdrawal always fails: its proceeds must not block anyone else.
contract Refuser {
    function withdrawFrom(OutfitMarket m) external {
        m.withdraw();
    }
}

contract OutfitMarketTest is Test {
    OutfitMarket m;
    address owner = address(0xA11);
    address treasury = address(0x7EA);
    address creator = address(0xC0);
    address alice = address(0xA1);
    address bob = address(0xB0);

    // head slot, 3 wide, 2 tall, 2 colours, 6 cells = 12 bits = 2 bytes
    bytes hat = hex"00030202ff0000ffff00a50a";

    function setUp() public {
        m = new OutfitMarket(owner, treasury);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(creator, 1 ether);
    }

    function _create(uint96 price, uint32 supply, uint16 royalty) internal returns (uint256 id) {
        vm.prank(creator);
        id = m.create(hat, "Red cap", price, supply, royalty);
    }

    function test_createGivesTheCreatorOneCopyAndKeepsThePixels() public {
        uint256 id = _create(1 ether, 10, 500);
        assertEq(m.balanceOf(creator, id), 1);
        OutfitMarket.Design memory d = m.design(id);
        assertEq(d.creator, creator);
        assertEq(d.pixels, hat);
        assertEq(d.minted, 1);
        assertEq(d.name, "Red cap");
    }

    function test_badDesignsAreRefused() public {
        vm.startPrank(creator);
        vm.expectRevert(OutfitMarket.BadPixels.selector);
        m.create(hex"03030202ff0000ffff00a50a", "x", 1, 1, 0); // slot 3
        vm.expectRevert(OutfitMarket.BadPixels.selector);
        m.create(hex"000e0202ff0000ffff00a50a", "x", 1, 1, 0); // 14 wide
        vm.expectRevert(OutfitMarket.BadPixels.selector);
        m.create(hex"00030204ff0000ffff00a50a", "x", 1, 1, 0); // 4 colours
        vm.expectRevert(OutfitMarket.BadPixels.selector);
        m.create(hex"00030202ff0000ffff00a5", "x", 1, 1, 0); // a cell byte short
        vm.expectRevert(OutfitMarket.BadPixels.selector);
        m.create(hex"00030202ff0000ffff00a50f", "x", 1, 1, 0); // cells use colour 3 of 2
        vm.expectRevert(OutfitMarket.BadPixels.selector);
        m.create(hex"00030202ff0000ffff00a54a", "x", 1, 1, 0); // stray bits after the last cell
        vm.expectRevert(OutfitMarket.BadName.selector);
        m.create(hat, "", 1, 1, 0);
        vm.expectRevert(OutfitMarket.BadName.selector);
        m.create(hat, "a name far too long for any outfit at all", 1, 1, 0);
        vm.expectRevert(OutfitMarket.BadTerms.selector);
        m.create(hat, "x", 1, 0, 0);
        vm.expectRevert(OutfitMarket.BadTerms.selector);
        m.create(hat, "x", 1, 10, 1001);
        vm.stopPrank();
    }

    function test_primarySalePaysTheFeeAndTheCreator() public {
        uint256 id = _create(1 ether, 10, 500);
        vm.prank(alice);
        m.mint{value: 3 ether}(id, 3, 1 ether);
        assertEq(m.balanceOf(alice, id), 3);
        assertEq(m.owed(treasury), 0.09 ether);
        assertEq(m.owed(creator), 2.91 ether);
        assertEq(address(m).balance, 3 ether);
    }

    function test_primarySaleRefusesWrongPaymentMovedPriceSoldOutAndClosed() public {
        uint256 id = _create(1 ether, 3, 0);
        vm.startPrank(alice);
        vm.expectRevert(OutfitMarket.WrongPayment.selector);
        m.mint{value: 0.5 ether}(id, 1, 1 ether);
        vm.expectRevert(OutfitMarket.PriceMoved.selector);
        m.mint{value: 0.5 ether}(id, 1, 0.5 ether);
        vm.expectRevert(OutfitMarket.SoldOut.selector);
        m.mint{value: 3 ether}(id, 3, 1 ether); // 1 already minted to the creator
        m.mint{value: 2 ether}(id, 2, 1 ether);
        vm.stopPrank();
        uint256 id2 = _create(1 ether, 10, 0);
        vm.prank(creator);
        m.setPrice(id2, 1 ether, true);
        vm.prank(alice);
        vm.expectRevert(OutfitMarket.NotForSale.selector);
        m.mint{value: 1 ether}(id2, 1, 1 ether);
        vm.prank(alice);
        vm.expectRevert(OutfitMarket.NotCreator.selector);
        m.setPrice(id2, 0, false);
        vm.expectRevert(OutfitMarket.NoDesign.selector);
        m.mint{value: 1 ether}(99, 1, 1 ether);
    }

    function test_resalePaysFeeRoyaltyAndSeller() public {
        uint256 id = _create(1 ether, 10, 500);
        vm.prank(alice);
        m.mint{value: 2 ether}(id, 2, 1 ether);
        vm.prank(alice);
        uint256 lid = m.list(id, 2, 2 ether);
        uint256 creatorBefore = m.owed(creator);
        uint256 treasuryBefore = m.owed(treasury);
        vm.prank(bob);
        m.buy{value: 2 ether}(lid, 1, 2 ether);
        assertEq(m.balanceOf(bob, id), 1);
        assertEq(m.balanceOf(alice, id), 1);
        assertEq(m.owed(treasury) - treasuryBefore, 0.06 ether);
        assertEq(m.owed(creator) - creatorBefore, 0.1 ether);
        assertEq(m.owed(alice), 1.84 ether);
        (, , uint32 left, , ) = m.listings(lid);
        assertEq(left, 1);
    }

    function test_theCreatorReselingPaysNoRoyaltyToItself() public {
        uint256 id = _create(1 ether, 10, 1000);
        vm.prank(creator);
        uint256 lid = m.list(id, 1, 1 ether);
        vm.prank(bob);
        m.buy{value: 1 ether}(lid, 1, 1 ether);
        assertEq(m.owed(creator), 0.97 ether);
        (address seller, , , , ) = m.listings(lid);
        assertEq(seller, address(0)); // a fully bought listing is gone
    }

    function test_aListingWhoseCopiesMovedCannotBeBought() public {
        uint256 id = _create(1 ether, 10, 0);
        vm.prank(alice);
        m.mint{value: 1 ether}(id, 1, 1 ether);
        vm.prank(alice);
        uint256 lid = m.list(id, 1, 1 ether);
        vm.prank(alice);
        m.safeTransferFrom(alice, address(0xD00D), id, 1, "");
        vm.prank(bob);
        vm.expectRevert(OutfitMarket.NoListing.selector);
        m.buy{value: 1 ether}(lid, 1, 1 ether);
        // getting a copy back does not bring the old listing back
        vm.prank(address(0xD00D));
        m.safeTransferFrom(address(0xD00D), alice, id, 1, "");
        vm.prank(bob);
        vm.expectRevert(OutfitMarket.NoListing.selector);
        m.buy{value: 1 ether}(lid, 1, 1 ether);
        assertEq(bob.balance, 100 ether);
    }

    function test_aPartlyBoughtListingStaysOpen() public {
        uint256 id = _create(1 ether, 10, 0);
        vm.prank(alice);
        m.mint{value: 3 ether}(id, 3, 1 ether);
        vm.prank(alice);
        uint256 lid = m.list(id, 3, 1 ether);
        vm.prank(bob);
        m.buy{value: 1 ether}(lid, 1, 1 ether);
        vm.prank(bob);
        m.buy{value: 2 ether}(lid, 2, 1 ether);
        assertEq(m.balanceOf(bob, id), 3);
    }

    function test_listingRulesAndCancel() public {
        uint256 id = _create(1 ether, 10, 0);
        vm.prank(alice);
        vm.expectRevert(OutfitMarket.NotEnoughHeld.selector);
        m.list(id, 1, 1 ether);
        vm.prank(creator);
        vm.expectRevert(OutfitMarket.BadTerms.selector);
        m.list(id, 1, 0);
        vm.prank(creator);
        uint256 lid = m.list(id, 1, 1 ether);
        vm.prank(alice);
        vm.expectRevert(OutfitMarket.NotSeller.selector);
        m.cancel(lid);
        vm.prank(bob);
        vm.expectRevert(OutfitMarket.PriceMoved.selector);
        m.buy{value: 0.5 ether}(lid, 1, 0.5 ether);
        vm.prank(bob);
        vm.expectRevert(OutfitMarket.BadTerms.selector);
        m.buy{value: 2 ether}(lid, 2, 1 ether);
        vm.prank(creator);
        m.cancel(lid);
        vm.prank(bob);
        vm.expectRevert(OutfitMarket.NoListing.selector);
        m.buy{value: 1 ether}(lid, 1, 1 ether);
    }

    function test_withdrawPaysOnceAndOnlyTheOwner() public {
        uint256 id = _create(1 ether, 10, 0);
        vm.prank(alice);
        m.mint{value: 1 ether}(id, 1, 1 ether);
        uint256 before = creator.balance;
        vm.prank(creator);
        m.withdraw();
        assertEq(creator.balance - before, 0.97 ether);
        vm.prank(creator);
        vm.expectRevert(OutfitMarket.NothingOwed.selector);
        m.withdraw();
        vm.prank(treasury);
        m.withdraw();
        assertEq(address(m).balance, 0);
    }

    function test_reentryOnReceiptIsRefused() public {
        uint256 id = _create(1 ether, 10, 0);
        vm.prank(creator);
        uint256 lid = m.list(id, 1, 1 ether);
        vm.prank(alice);
        m.mint{value: 2 ether}(id, 2, 1 ether);
        vm.prank(alice);
        uint256 lid2 = m.list(id, 2, 1 ether);
        Reenterer r = new Reenterer(m);
        vm.deal(address(r), 5 ether);
        r.arm(lid2, true);
        r.buy{value: 1 ether}(lid, 1, 1 ether);
        assertFalse(r.reentered());
        assertEq(m.balanceOf(address(r), id), 1);
        (, , uint32 left, , ) = m.listings(lid2);
        assertEq(left, 2);
    }

    function test_movingCopiesInsideASaleCallbackStillRetiresListings() public {
        uint256 id = _create(1 ether, 10, 0);
        Sneaky s = new Sneaky(m);
        vm.deal(address(s), 5 ether);
        vm.prank(alice);
        m.mint{value: 1 ether}(id, 1, 1 ether);
        // the sneaky contract holds one copy and lists it
        vm.prank(alice);
        m.safeTransferFrom(alice, address(s), id, 1, "");
        uint256 its = s.listAll(id, 1, 1 ether);
        // it buys another copy and, inside the callback, moves one away
        vm.prank(creator);
        uint256 lid = m.list(id, 1, 1 ether);
        s.arm();
        s.buy{value: 1 ether}(lid, 1, 1 ether);
        // its old listing is retired
        vm.prank(bob);
        vm.expectRevert(OutfitMarket.NoListing.selector);
        m.buy{value: 1 ether}(its, 1, 1 ether);
    }

    /// Every design the game's encoder writes (packages/art designs.ts) is accepted, so a player can publish anything they can draw.
    function test_acceptsEveryDesignTheGameEncodes() public {
        bytes[] memory designs = vm.parseJsonBytesArray(vm.readFile("test/fixtures/designs.json"), ".designs");
        assertEq(designs.length, 40);
        vm.startPrank(creator);
        for (uint256 i = 0; i < designs.length; i++) m.create(designs[i], "piece", 1, 5, 0);
        vm.stopPrank();
        assertEq(m.nextDesign(), 41);
    }

    function test_onlyTheOwnerSetsTheFeeWithinItsCeiling() public {
        vm.expectRevert();
        m.setFee(100, treasury);
        vm.startPrank(owner);
        vm.expectRevert(OutfitMarket.BadTerms.selector);
        m.setFee(501, treasury);
        vm.expectRevert(OutfitMarket.BadTerms.selector);
        m.setFee(100, address(0));
        m.setFee(0, address(0xBEEF));
        vm.stopPrank();
        uint256 id = _create(1 ether, 10, 0);
        vm.prank(alice);
        m.mint{value: 1 ether}(id, 1, 1 ether);
        assertEq(m.owed(creator), 1 ether);
    }

    /// Every wei paid is credited to someone, and the contract holds exactly what is owed.
    function testFuzz_splitsAddUp(uint96 price, uint32 q, uint16 royalty, uint16 fee) public {
        price = uint96(bound(price, 1, 1e24));
        q = uint32(bound(q, 1, 50));
        royalty = uint16(bound(royalty, 0, 1000));
        fee = uint16(bound(fee, 0, 500));
        vm.prank(owner);
        m.setFee(fee, treasury);
        uint256 id = _create(price, 1000, royalty);
        uint256 total = uint256(price) * q;
        vm.deal(alice, total * 3);
        vm.prank(alice);
        m.mint{value: total}(id, q, price);
        vm.prank(alice);
        uint256 lid = m.list(id, q, price);
        vm.deal(bob, total);
        vm.prank(bob);
        m.buy{value: total}(lid, q, price);
        assertEq(m.owed(treasury) + m.owed(creator) + m.owed(alice), address(m).balance);
        assertEq(address(m).balance, total * 2);
    }

    /* ── refusals at the edges ───────────────────────────────────────────── */

    function test_theMarketNeedsATreasury() public {
        vm.expectRevert(OutfitMarket.BadTerms.selector);
        new OutfitMarket(owner, address(0));
    }

    function test_aDesignOrListingThatDoesNotExistCannotBeUsed() public {
        vm.expectRevert(OutfitMarket.NoDesign.selector);
        m.design(7);
        vm.startPrank(creator);
        vm.expectRevert(OutfitMarket.NoDesign.selector);
        m.setPrice(7, 1 ether, false);
        vm.expectRevert(OutfitMarket.NoDesign.selector);
        m.list(7, 1, 1 ether);
        vm.expectRevert(OutfitMarket.NoListing.selector);
        m.cancel(7);
        vm.stopPrank();
    }

    function test_pixelDataShorterThanAHeaderOrLongerThanTheCapIsRefused() public {
        vm.startPrank(creator);
        vm.expectRevert(OutfitMarket.BadPixels.selector);
        m.create(hex"000101010000", "x", 1, 1, 0); // six bytes: no room for a colour and a cell byte
        vm.expectRevert(OutfitMarket.BadPixels.selector);
        m.create(new bytes(97), "x", 1, 1, 0);
        vm.stopPrank();
        assertEq(m.nextDesign(), 1);
    }

    function test_aResaleMustBePaidExactly() public {
        uint256 id = _create(1 ether, 10, 0);
        vm.prank(creator);
        uint256 lid = m.list(id, 1, 1 ether);
        vm.startPrank(bob);
        vm.expectRevert(OutfitMarket.WrongPayment.selector);
        m.buy{value: 0.5 ether}(lid, 1, 1 ether);
        vm.expectRevert(OutfitMarket.WrongPayment.selector);
        m.buy{value: 2 ether}(lid, 1, 1 ether);
        vm.stopPrank();
        assertEq(bob.balance, 100 ether);
        assertEq(m.balanceOf(bob, id), 0);
    }

    /// A payee that cannot take ether keeps its credit: the failed withdrawal moves nothing and blocks nobody else.
    function test_aWithdrawalTheRecipientRefusesFailsAndKeepsTheCredit() public {
        Refuser r = new Refuser();
        vm.prank(owner);
        m.setFee(300, address(r));
        uint256 id = _create(1 ether, 10, 0);
        vm.prank(alice);
        m.mint{value: 1 ether}(id, 1, 1 ether);
        vm.expectRevert(OutfitMarket.TransferFailed.selector);
        r.withdrawFrom(m);
        assertEq(m.owed(address(r)), 0.03 ether);
        vm.prank(creator);
        m.withdraw();
        assertEq(address(m).balance, 0.03 ether);
    }

    /// Alice holds one copy and lists it twice, cheap and dear; bob buys the dear listing.
    function _oneCopyListedTwiceAndSold() internal returns (uint256 id, uint256 cheap) {
        id = _create(1 ether, 10, 0);
        vm.startPrank(alice);
        m.mint{value: 1 ether}(id, 1, 1 ether);
        cheap = m.list(id, 1, 0.1 ether);
        uint256 dear = m.list(id, 1, 1 ether);
        vm.stopPrank();
        vm.prank(bob);
        m.buy{value: 1 ether}(dear, 1, 1 ether);
    }

    function test_aListingWhoseCopiesSoldThroughAnotherListingCannotBeBought() public {
        (uint256 id, uint256 cheap) = _oneCopyListedTwiceAndSold();
        vm.prank(bob);
        vm.expectRevert(OutfitMarket.NotEnoughHeld.selector);
        m.buy{value: 0.1 ether}(cheap, 1, 0.1 ether);
        assertEq(m.balanceOf(bob, id), 1);
    }

    /// The comment on `listNonce` promises "a listing can never come back to life when copies are later
    /// re-acquired", but a sale here does not bump the nonce, so a listing beside the one that sold comes back, at
    /// its old price, the moment the seller holds a copy again. OutfitMarketV2 bumps it on every sale (review M-1).
    function test_defect_aSaleLeavesTheSellersOtherListingsToComeBackWithTheNextCopy() public {
        (uint256 id, uint256 cheap) = _oneCopyListedTwiceAndSold();
        // later alice buys another copy for herself; the forgotten cheap listing is live again
        vm.prank(alice);
        m.mint{value: 1 ether}(id, 1, 1 ether);
        address carol = address(0xCA);
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        m.buy{value: 0.1 ether}(cheap, 1, 0.1 ether);
        assertEq(m.balanceOf(carol, id), 1);
        assertEq(m.balanceOf(alice, id), 0);
    }
}
