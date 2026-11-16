// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OutfitMarketV2} from "../src/OutfitMarketV2.sol";
import {ItemShop, IItemMarket} from "../src/ItemShop.sol";

/// The item shop against the live BEM market and the real BEM token on a fork of X Layer: the market's owner
/// makes item kinds and grants the shop, purchases burn real BEM, vouchers mint once. Run with
/// `forge test --fork-url <X Layer RPC> --match-contract ItemShopForkTest`.
contract ItemShopForkTest is Test {
    IERC20 constant BEM = IERC20(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952);
    OutfitMarketV2 constant MARKET = OutfitMarketV2(0xa292C12B0414bBFC14994F93BCfF8bd58c921e55);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    ItemShop shop;
    address owner;
    address alice = makeAddr("alice");
    uint256 signerKey = 0x5157E2;
    uint256 lamp;
    uint256 keepsake;

    function setUp() public {
        if (block.chainid != 196) vm.skip(true);
        owner = MARKET.owner();
        shop = new ItemShop(owner, IItemMarket(address(MARKET)), BEM, vm.addr(signerKey));
        vm.startPrank(owner);
        lamp = MARKET.createItem("Star lamp", 500);
        keepsake = MARKET.createItem("Together banner", 100_000);
        MARKET.setMinter(lamp, address(shop), 500);
        MARKET.setMinter(keepsake, address(shop), 100_000);
        shop.setPrice(lamp, 0.05e8);
        vm.stopPrank();
        deal(address(BEM), alice, 1e8);
        vm.prank(alice);
        BEM.approve(address(shop), type(uint256).max);
    }

    function test_realBemIsBurnedWholeAndTheEventsAddUp() public {
        uint256 deadBefore = BEM.balanceOf(DEAD);
        vm.recordLogs();
        vm.prank(alice);
        shop.buy(lamp, 2, 0.05e8);
        vm.prank(alice);
        shop.buy(lamp, 1, 0.05e8);
        uint256 sum;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) if (logs[i].emitter == address(shop) && logs[i].topics[0] == ItemShop.Burned.selector) sum += abi.decode(logs[i].data, (uint256));
        assertEq(sum, 0.15e8);
        assertEq(BEM.balanceOf(DEAD) - deadBefore, sum);
        assertEq(shop.totalBurned(), sum);
        assertEq(BEM.balanceOf(alice), 1e8 - 0.15e8);
        assertEq(MARKET.balanceOf(alice, lamp), 3);
        assertEq(shop.available(lamp), 497);
    }

    function test_wrongPriceMovesNothing() public {
        vm.prank(alice);
        vm.expectRevert(ItemShop.PriceMoved.selector);
        shop.buy(lamp, 1, 0.01e8);
        assertEq(BEM.balanceOf(alice), 1e8);
    }

    function test_voucherOnceThenReplayAndExpiryRefused() public {
        ItemShop.Voucher memory v = ItemShop.Voucher({to: alice, id: keepsake, quantity: 1, nonce: uint256(keccak256("g1:alice")), expiresAt: uint64(block.timestamp + 7 days)});
        (uint8 r8, bytes32 r, bytes32 s) = vm.sign(signerKey, shop.voucherDigest(v));
        bytes memory sig = abi.encodePacked(r, s, r8);
        shop.claim(v, sig);
        assertEq(MARKET.balanceOf(alice, keepsake), 1);
        vm.expectRevert(ItemShop.Used.selector);
        shop.claim(v, sig);
        ItemShop.Voucher memory late = ItemShop.Voucher({to: alice, id: keepsake, quantity: 1, nonce: 2, expiresAt: uint64(block.timestamp + 1 hours)});
        (r8, r, s) = vm.sign(signerKey, shop.voucherDigest(late));
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(ItemShop.Expired.selector);
        shop.claim(late, abi.encodePacked(r, s, r8));
    }

    function test_withoutAGrantTheShopMintsNothing() public {
        vm.prank(owner);
        uint256 other = MARKET.createItem("Ungranted", 10);
        vm.prank(owner);
        shop.setPrice(other, 0.05e8);
        vm.prank(alice);
        vm.expectRevert(OutfitMarketV2.NotMinter.selector);
        shop.buy(other, 1, 0.05e8);
        assertEq(BEM.balanceOf(alice), 1e8);
    }
}
