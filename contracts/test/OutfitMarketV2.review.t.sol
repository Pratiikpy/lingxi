// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OutfitMarketV2} from "../src/OutfitMarketV2.sol";
import {MockBEM} from "./OutfitMarketV2.t.sol";

/// Regression tests for the independent review (research/run/reviews/outfitmarketv2-holdergift-review.md):
/// each scenario that proved a finding now proves its fix.
contract OutfitMarketV2ReviewTest is Test {
    OutfitMarketV2 m;
    MockBEM bem;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11);
    address creator = address(0xC0);
    address alice = address(0xA1);
    address bob = address(0xB0);
    address carol = address(0xCA);
    uint96 constant ONE = 1e8;
    bytes hat = hex"00030202ff0000ffff00a50a";

    function setUp() public {
        bem = new MockBEM();
        m = new OutfitMarketV2(owner, IERC20(address(bem)));
        address[4] memory people = [alice, bob, creator, carol];
        for (uint256 i = 0; i < 4; i++) {
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

    /// M-1: a sale retires the seller's other listings of the type, so a forgotten cheap one cannot come back.
    function test_M1_aSaleRetiresTheSellersOtherListings() public {
        uint256 id = _create(ONE, 100, 0);
        vm.startPrank(alice);
        m.mint(id, 1, ONE);
        uint256 cheap = m.list(id, 1, 1e6, _until(), address(0));
        uint256 dear = m.list(id, 1, 5 * ONE, _until(), address(0));
        vm.stopPrank();
        vm.prank(bob);
        m.buy(dear, 1, 5 * ONE);
        assertFalse(m.isLive(cheap));
        vm.prank(alice);
        m.mint(id, 1, ONE); // a copy comes back
        assertFalse(m.isLive(cheap));
        vm.prank(carol);
        vm.expectRevert(OutfitMarketV2.NoListing.selector);
        m.buy(cheap, 1, 1e6);
        assertEq(m.balanceOf(alice, id), 1);
    }

    /// M-1: the bought listing's remainder stays open, and isLive reports it.
    function test_M1_theRestOfABoughtListingStaysLive() public {
        uint256 id = _create(ONE, 100, 0);
        vm.prank(alice);
        m.mint(id, 3, ONE);
        vm.prank(alice);
        uint256 lid = m.list(id, 3, ONE, _until(), address(0));
        vm.prank(bob);
        m.buy(lid, 1, ONE);
        assertTrue(m.isLive(lid));
        vm.prank(carol);
        m.buy(lid, 2, ONE);
        assertFalse(m.isLive(lid));
        assertEq(m.balanceOf(carol, id), 2);
    }

    /// L-1: a fee raise after listing does not apply to that listing.
    function test_L1_aFeeRaiseInFlightDoesNotCutTheSeller() public {
        uint256 id = _create(ONE, 100, 0);
        vm.prank(alice);
        m.mint(id, 1, ONE);
        vm.prank(alice);
        uint256 lid = m.list(id, 1, 100 * ONE, _until(), address(0));
        uint256 before = m.owed(alice);
        vm.prank(owner);
        m.setFee(500);
        vm.prank(bob);
        m.buy(lid, 1, 100 * ONE);
        assertEq(m.owed(alice) - before, 97 * uint256(ONE));
    }

    /// L-1: a fee cut after listing does apply (the lower of the two).
    function test_L1_aFeeCutAfterListingHelpsTheSeller() public {
        uint256 id = _create(ONE, 100, 0);
        vm.prank(alice);
        m.mint(id, 1, ONE);
        vm.prank(alice);
        uint256 lid = m.list(id, 1, 100 * ONE, _until(), address(0));
        vm.prank(owner);
        m.setFee(100);
        uint256 before = m.owed(alice);
        vm.prank(bob);
        m.buy(lid, 1, 100 * ONE);
        assertEq(m.owed(alice) - before, 99 * uint256(ONE));
    }

    /// L-2: item kinds follow the current owner after a handover; the old key loses them.
    function test_L2_itemKindsFollowTheCurrentOwner() public {
        vm.prank(owner);
        uint256 item = m.createItem("Lantern", 1000);
        address next = address(0x2222);
        vm.prank(owner);
        m.transferOwnership(next);
        vm.prank(next);
        m.acceptOwnership();
        vm.prank(owner);
        vm.expectRevert(OutfitMarketV2.NotCreator.selector);
        m.setMinter(item, owner, 1000);
        vm.prank(next);
        m.setMinter(item, next, 10);
        vm.prank(next);
        m.mintTo(item, next, 10);
        assertEq(m.balanceOf(next, item), 10);
    }

    /// I-1: BEM sent to the market by mistake can be burned by anyone, never taken; owed BEM is untouched.
    function test_I1_strayBemIsBurnedNotTaken() public {
        uint256 id = _create(ONE, 100, 0);
        vm.prank(alice);
        m.mint(id, 1, ONE);
        vm.prank(bob);
        bem.transfer(address(m), ONE);
        uint256 burnedBefore = m.totalBurned();
        vm.prank(carol);
        m.burnStray();
        assertEq(m.totalBurned() - burnedBefore, ONE);
        assertEq(bem.balanceOf(address(m)), m.totalOwed());
        vm.prank(creator);
        m.withdraw(); // the creator's share is still all there
        assertEq(bem.balanceOf(address(m)), 0);
        vm.expectRevert(OutfitMarketV2.NothingOwed.selector);
        m.burnStray();
    }

    /// I-2: the fee rounds up, so a positive rate always burns something; prices below 0.0001 BEM are refused,
    /// so rounding up never takes more than 0.01% beyond the rate.
    function test_I2_feesRoundUpAndTinyPricesAreRefused() public {
        vm.prank(creator);
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.create(hat, "Dust", 9_999, 100, 0);
        uint256 id = _create(10_001, 100, 0);
        vm.prank(alice);
        m.mint(id, 1, 10_001);
        assertEq(m.totalBurned(), 301); // 3% of 10,001 is 300.03
        assertEq(m.owed(creator), 9_700);
        vm.prank(alice);
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.list(id, 1, 9_999, _until(), address(0));
        vm.prank(creator);
        vm.expectRevert(OutfitMarketV2.BadTerms.selector);
        m.setPrice(id, 5, false);
    }

    /// Batch transfers (duplicate ids, zero values) and zero-value singles all retire listings.
    function test_batchAndZeroValueTransfersRetireListings() public {
        uint256 id = _create(ONE, 100, 0);
        vm.startPrank(alice);
        m.mint(id, 3, ONE);
        uint256 a = m.list(id, 1, ONE, _until(), address(0));
        uint256[] memory ids = new uint256[](2);
        uint256[] memory vals = new uint256[](2);
        ids[0] = id;
        ids[1] = id;
        m.safeBatchTransferFrom(alice, alice, ids, vals, "");
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.NoListing.selector);
        m.buy(a, 1, ONE);
        vm.prank(alice);
        uint256 b = m.list(id, 1, ONE, _until(), address(0));
        vm.prank(alice);
        m.safeTransferFrom(alice, alice, id, 0, "");
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.NoListing.selector);
        m.buy(b, 1, ONE);
    }

    /// An approved operator still lists only what it holds itself.
    function test_cannotListSomeoneElsesCopies() public {
        uint256 id = _create(ONE, 100, 0);
        vm.prank(alice);
        m.mint(id, 2, ONE);
        vm.prank(alice);
        m.setApprovalForAll(bob, true);
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.NotEnoughHeld.selector);
        m.list(id, 1, ONE, _until(), address(0));
    }

    /// Through every path the market's BEM balance equals what it owes, and the burn total equals the burns.
    function testFuzz_balanceAlwaysEqualsOwed(uint8 sales, uint96 price) public {
        sales = uint8(bound(sales, 1, 20));
        price = uint96(bound(price, 10_000, 2e9)); // 20 sales of at most 20 BEM fit the test wallets
        uint256 id = _create(price, 10_000, 700);
        for (uint256 i = 0; i < sales; i++) {
            vm.prank(alice);
            m.mint(id, 1, price);
            vm.prank(alice);
            uint256 lid = m.list(id, 1, price, _until(), address(0));
            vm.prank(bob);
            m.buy(lid, 1, price);
            if (i % 3 == 0 && m.owed(alice) > 0) {
                vm.prank(alice);
                m.withdraw();
            }
        }
        assertEq(bem.balanceOf(address(m)), m.totalOwed());
        assertEq(m.owed(alice) + m.owed(creator), m.totalOwed());
        assertEq(bem.balanceOf(DEAD), m.totalBurned());
    }
}
