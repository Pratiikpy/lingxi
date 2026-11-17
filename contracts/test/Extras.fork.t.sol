// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {Extras} from "../src/Extras.sol";

/// The paid extras against the live pet registry and real BEM on a fork of X Layer: the pets are pets that exist on
/// mainnet, and every burn lands on the real dead address.
/// Run with `forge test --fork-url <X Layer RPC> --match-contract ExtrasForkTest`.
contract ExtrasForkTest is Test {
    IERC20 constant BEM = IERC20(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952);
    PetRegistry constant REG = PetRegistry(0x103d7252eB6b2fec22B3F65A6BB605945F280E99);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint96 constant P = 0.05e8;
    Extras extras;
    address keeper; // owns pet 1 on mainnet
    address bob = makeAddr("bob");
    address owner = makeAddr("owner");

    function setUp() public {
        if (block.chainid != 196) vm.skip(true);
        keeper = REG.ownerOf(1);
        extras = new Extras(owner, BEM, IERC721(address(REG)), 8, P, P, P);
        deal(address(BEM), keeper, BEM.balanceOf(keeper) + 2e8);
        deal(address(BEM), bob, 2e8);
        vm.prank(keeper);
        BEM.approve(address(extras), type(uint256).max);
        vm.prank(bob);
        BEM.approve(address(extras), type(uint256).max);
    }

    function test_realBemIsBurnedForRoomAndLooks() public {
        uint256 dead = BEM.balanceOf(DEAD);
        uint256 had = BEM.balanceOf(bob);
        vm.startPrank(bob);
        extras.buyRoom(P);
        extras.buyLooks(P);
        vm.stopPrank();
        assertEq(had - BEM.balanceOf(bob), 2 * uint256(P));
        assertEq(BEM.balanceOf(DEAD) - dead, 2 * uint256(P));
        assertEq(BEM.balanceOf(address(extras)), 0);
        assertEq(extras.totalBurned(), 2 * uint256(P));
        (uint8 room, uint8 looks, , , , ) = extras.extrasOf(bob);
        assertEq(room, 1);
        assertEq(looks, 1);
    }

    function test_onlyTheRealOwnerOfAMainnetPetColoursItsName() public {
        vm.prank(bob);
        vm.expectRevert(Extras.NotPetOwner.selector);
        extras.setNameColour(1, 4, P);
        uint256 dead = BEM.balanceOf(DEAD);
        vm.prank(keeper);
        extras.setNameColour(1, 4, P);
        assertEq(extras.nameColour(1), 4);
        assertEq(BEM.balanceOf(DEAD) - dead, P);
        vm.prank(keeper);
        extras.setNameColour(1, 0, 0);
        assertEq(BEM.balanceOf(DEAD) - dead, P);
    }

    function test_theColourFollowsAMainnetPetToItsNextOwner() public {
        vm.prank(keeper);
        extras.setNameColour(1, 2, P);
        vm.prank(keeper);
        REG.transferFrom(keeper, bob, 1);
        assertEq(extras.nameColour(1), 2);
        vm.prank(keeper);
        vm.expectRevert(Extras.NotPetOwner.selector);
        extras.setNameColour(1, 3, P);
        vm.prank(bob);
        extras.setNameColour(1, 3, P);
        assertEq(extras.nameColour(1), 3);
    }

    function test_aPetThatDoesNotExistIsRefused() public {
        vm.prank(bob);
        vm.expectRevert();
        extras.setNameColour(1_000_000, 1, P);
    }

    function test_noAllowanceMovesNothing() public {
        address carol = makeAddr("carol");
        deal(address(BEM), carol, 1e8);
        vm.prank(carol);
        vm.expectRevert();
        extras.buyRoom(P);
        assertEq(extras.roomPacks(carol), 0);
        assertEq(BEM.balanceOf(carol), 1e8);
    }
}
