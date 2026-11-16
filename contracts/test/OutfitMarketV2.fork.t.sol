// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OutfitMarketV2} from "../src/OutfitMarketV2.sol";

/// The BEM market against the real BEM token on a fork of X Layer: payments pull real BEM, the fee lands on
/// the dead address, proceeds withdraw in BEM. Run with `forge test --fork-url <X Layer RPC>`.
contract OutfitMarketV2ForkTest is Test {
    IERC20 constant BEM = IERC20(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    OutfitMarketV2 m;
    address owner = makeAddr("owner");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes hat = hex"00030202ff0000ffff00a50a";

    function setUp() public {
        if (block.chainid != 196) vm.skip(true);
        m = new OutfitMarketV2(owner, BEM);
        deal(address(BEM), alice, 10e8);
        deal(address(BEM), bob, 10e8);
        vm.prank(alice);
        BEM.approve(address(m), type(uint256).max);
        vm.prank(bob);
        BEM.approve(address(m), type(uint256).max);
    }

    function test_realBemPaysBurnsAndWithdraws() public {
        vm.prank(creator);
        uint256 id = m.create(hat, "Red cap", 0.1e8, 100, 500);
        uint256 deadBefore = BEM.balanceOf(DEAD);

        vm.prank(alice);
        m.mint(id, 2, 0.1e8);
        assertEq(BEM.balanceOf(alice), 9.8e8);
        assertEq(BEM.balanceOf(DEAD) - deadBefore, 0.006e8); // 3% of 0.2 BEM

        vm.prank(alice);
        uint256 lid = m.list(id, 1, 0.5e8, uint64(block.timestamp + 1 days), address(0));
        vm.prank(bob);
        m.buy(lid, 1, 0.5e8);
        assertEq(m.balanceOf(bob, id), 1);
        assertEq(BEM.balanceOf(DEAD) - deadBefore, 0.006e8 + 0.015e8);
        assertEq(m.totalBurned(), BEM.balanceOf(DEAD) - deadBefore);

        vm.prank(alice);
        m.withdraw();
        assertEq(BEM.balanceOf(alice), 9.8e8 + 0.46e8); // 0.5 less 3% fee less 5% royalty
        vm.prank(creator);
        m.withdraw();
        assertEq(BEM.balanceOf(creator), 0.194e8 + 0.025e8);
        assertEq(BEM.balanceOf(address(m)), 0);
    }

    function test_withoutApprovalNothingMoves() public {
        vm.prank(creator);
        uint256 id = m.create(hat, "Red cap", 0.1e8, 100, 0);
        address carol = makeAddr("carol");
        deal(address(BEM), carol, 1e8);
        vm.prank(carol);
        vm.expectRevert();
        m.mint(id, 1, 0.1e8);
        assertEq(BEM.balanceOf(carol), 1e8);
        assertEq(m.balanceOf(carol, id), 0);
    }
}
