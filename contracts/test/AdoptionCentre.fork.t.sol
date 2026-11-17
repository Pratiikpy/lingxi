// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {AdoptionCentre} from "../src/AdoptionCentre.sol";

/// A buyer contract that tries to adopt again from inside the transfer callback.
contract Grabby is IERC721Receiver {
    AdoptionCentre immutable centre;
    uint256 public other;
    bool public tried;
    bool public succeeded;

    constructor(AdoptionCentre c, IERC20 bem) {
        centre = c;
        bem.approve(address(c), type(uint256).max);
    }

    function go(uint256 petId, uint96 price, uint256 other_) external {
        other = other_;
        centre.adopt(petId, price);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!tried && other != 0) {
            tried = true;
            (, uint96 p, , ) = centre.listings(other);
            try centre.adopt(other, p) {
                succeeded = true;
            } catch {}
        }
        return this.onERC721Received.selector;
    }
}

/// The adoption centre against the live pet registry and real BEM on a fork of X Layer. The registry's owner
/// lets this test act as a breeder, so the children are real bred pets of pets that exist on mainnet.
/// Run with `forge test --fork-url <X Layer RPC> --match-contract AdoptionCentreForkTest`.
contract AdoptionCentreForkTest is Test {
    IERC20 constant BEM = IERC20(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952);
    PetRegistry constant REG = PetRegistry(0x103d7252eB6b2fec22B3F65A6BB605945F280E99);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 constant PRICE = 1e8; // 1 BEM
    AdoptionCentre centre;
    address alice = makeAddr("alice"); // the breeder: owns parent 1
    address carol = makeAddr("carol"); // owns parent 2
    address bob = makeAddr("bob"); // adopts
    uint256 child;

    function setUp() public {
        if (block.chainid != 196) vm.skip(true);
        address regOwner = REG.owner();
        address holder = REG.ownerOf(1);
        vm.prank(regOwner);
        REG.setBreeder(address(this), true);
        vm.startPrank(holder);
        REG.transferFrom(holder, alice, 1);
        REG.transferFrom(holder, carol, 2);
        vm.stopPrank();
        child = _bred(1, 2);
        centre = new AdoptionCentre(REG, BEM, makeAddr("owner"));
        vm.prank(alice);
        REG.setApprovalForAll(address(centre), true);
        deal(address(BEM), bob, 10e8);
        vm.prank(bob);
        BEM.approve(address(centre), type(uint256).max);
    }

    function _bred(uint128 a, uint128 b) internal returns (uint256) {
        PetRegistry.Pet memory p = REG.pet(1);
        return REG.hatchChild(alice, 0, p.processor, p.brainId, 0, a, b);
    }

    function _list(uint256 petId, uint96 price) internal {
        vm.prank(alice);
        centre.list(petId, price, uint64(block.timestamp + 1 days));
    }

    function test_adoptionPaysBurnsAndShares() public {
        _list(child, uint96(PRICE));
        assertTrue(centre.isLive(child));
        assertEq(centre.open().length, 1);
        uint256 dead0 = BEM.balanceOf(DEAD);
        vm.recordLogs();
        vm.prank(bob);
        centre.adopt(child, uint96(PRICE));
        assertEq(REG.ownerOf(child), bob);
        assertEq(BEM.balanceOf(DEAD) - dead0, 0.03e8); // 3% burned
        assertEq(BEM.balanceOf(carol), 0.1e8); // 10% to the other parent's owner
        assertEq(BEM.balanceOf(alice), 0.87e8); // the rest to the breeder
        assertEq(BEM.balanceOf(bob), 9e8);
        assertEq(BEM.balanceOf(address(centre)), 0);
        assertEq(centre.totalBurned(), 0.03e8);
        uint256 sum;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) if (logs[i].emitter == address(centre) && logs[i].topics[0] == AdoptionCentre.Burned.selector) sum += abi.decode(logs[i].data, (uint256));
        assertEq(sum, centre.totalBurned());
        assertEq(centre.open().length, 0);
        // adopted once, never offered again, even by its new owner
        vm.prank(bob);
        REG.setApprovalForAll(address(centre), true);
        vm.prank(bob);
        vm.expectRevert(AdoptionCentre.AlreadyMoved.selector);
        centre.list(child, uint96(PRICE), uint64(block.timestamp + 1 days));
    }

    function test_noShareWhenTheBreederOwnsBothParents() public {
        vm.prank(carol);
        REG.transferFrom(carol, alice, 2);
        uint256 c2 = _bred(1, 2);
        _list(c2, uint96(PRICE));
        assertEq(centre.coParentOf(c2, alice), address(0));
        vm.prank(bob);
        centre.adopt(c2, uint96(PRICE));
        assertEq(BEM.balanceOf(alice), 0.97e8);
    }

    function test_onlyABredYoungNeverMovedPetCanBeOffered() public {
        // a hatched pet (no parents)
        vm.prank(alice);
        vm.expectRevert(AdoptionCentre.NotBred.selector);
        centre.list(1, uint96(PRICE), uint64(block.timestamp + 1 days));
        // not yours
        vm.prank(bob);
        vm.expectRevert(AdoptionCentre.NotYours.selector);
        centre.list(child, uint96(PRICE), uint64(block.timestamp + 1 days));
        // a child that already changed hands
        uint256 moved = _bred(1, 2);
        vm.prank(alice);
        REG.transferFrom(alice, carol, moved);
        vm.prank(carol);
        REG.transferFrom(carol, alice, moved);
        vm.prank(alice);
        vm.expectRevert(AdoptionCentre.AlreadyMoved.selector);
        centre.list(moved, uint96(PRICE), uint64(block.timestamp + 1 days));
        // an offer may not outlast its youth, and an older child cannot be offered
        vm.prank(alice);
        vm.expectRevert(AdoptionCentre.BadTerms.selector);
        centre.list(child, uint96(PRICE), uint64(block.timestamp + 3 days + 1));
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        vm.expectRevert(AdoptionCentre.NotYoung.selector);
        centre.list(child, uint96(PRICE), uint64(block.timestamp + 1 hours));
    }

    function test_priceBoundsAndApproval() public {
        vm.startPrank(alice);
        vm.expectRevert(AdoptionCentre.BadTerms.selector);
        centre.list(child, 1_000_000 - 1, uint64(block.timestamp + 1 days));
        vm.expectRevert(AdoptionCentre.BadTerms.selector);
        centre.list(child, 100e8 + 1, uint64(block.timestamp + 1 days));
        REG.setApprovalForAll(address(centre), false);
        vm.expectRevert(AdoptionCentre.NotApproved.selector);
        centre.list(child, uint96(PRICE), uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_wrongPriceExpiredAndOwnSaleMoveNothing() public {
        _list(child, uint96(PRICE));
        vm.prank(bob);
        vm.expectRevert(AdoptionCentre.PriceMoved.selector);
        centre.adopt(child, uint96(PRICE - 1));
        vm.prank(alice);
        vm.expectRevert(AdoptionCentre.OwnSale.selector);
        centre.adopt(child, uint96(PRICE));
        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        vm.expectRevert(AdoptionCentre.Expired.selector);
        centre.adopt(child, uint96(PRICE));
        assertEq(BEM.balanceOf(bob), 10e8);
        assertEq(REG.ownerOf(child), alice);
        // an expired offer can be cleared by anyone
        vm.prank(bob);
        centre.withdraw(child);
        assertEq(centre.open().length, 0);
    }

    function test_aSaveAfterListingStopsTheSale() public {
        vm.prank(alice);
        centre.list(child, uint96(PRICE), uint64(block.timestamp + 2 days));
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        REG.checkpoint(child, 2, 123, keccak256("other"));
        assertFalse(centre.isLive(child));
        vm.prank(bob);
        vm.expectRevert(AdoptionCentre.Changed.selector);
        centre.adopt(child, uint96(PRICE));
    }

    function test_aPetThatLeftTheBreederCannotBeAdopted() public {
        _list(child, uint96(PRICE));
        vm.prank(alice);
        REG.transferFrom(alice, carol, child);
        assertFalse(centre.isLive(child));
        vm.prank(bob);
        vm.expectRevert(AdoptionCentre.AlreadyMoved.selector);
        centre.adopt(child, uint96(PRICE));
    }

    function test_onlyTheBreederWithdrawsALiveOffer() public {
        _list(child, uint96(PRICE));
        vm.prank(bob);
        vm.expectRevert(AdoptionCentre.NotYours.selector);
        centre.withdraw(child);
        vm.prank(alice);
        centre.withdraw(child);
        vm.prank(bob);
        vm.expectRevert(AdoptionCentre.NotListed.selector);
        centre.adopt(child, uint96(PRICE));
    }

    function test_aBuyerCannotAdoptAgainFromTheCallback() public {
        uint256 second = _bred(1, 2);
        _list(child, uint96(PRICE));
        _list(second, uint96(PRICE));
        Grabby g = new Grabby(centre, BEM);
        deal(address(BEM), address(g), 10e8);
        g.go(child, uint96(PRICE), second);
        assertTrue(g.tried());
        assertFalse(g.succeeded());
        assertEq(REG.ownerOf(child), address(g));
        assertEq(REG.ownerOf(second), alice);
    }

    function test_withoutBemApprovalNothingMoves() public {
        _list(child, uint96(PRICE));
        address dan = makeAddr("dan");
        deal(address(BEM), dan, 10e8);
        vm.prank(dan);
        vm.expectRevert();
        centre.adopt(child, uint96(PRICE));
        assertEq(REG.ownerOf(child), alice);
        assertEq(BEM.balanceOf(dan), 10e8);
    }

    function test_feeBoundsAndOwner() public {
        vm.prank(makeAddr("owner"));
        vm.expectRevert(AdoptionCentre.BadTerms.selector);
        centre.setFee(501);
        vm.prank(alice);
        vm.expectRevert();
        centre.setFee(100);
    }
}
