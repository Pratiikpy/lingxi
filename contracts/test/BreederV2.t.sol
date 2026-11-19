// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {BreederV2} from "../src/BreederV2.sol";
import {BreederUnitBase} from "./Breeder.t.sol";
import {MockBEM, ShortToken} from "./OutfitMarketV2.t.sol";

/// The BEM-fee breeder on a local registry: every shared check from Breeder.t.sol, plus the fee and the cap.
contract BreederV2Test is BreederUnitBase {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 constant FEE = 0.1e8;

    BreederV2 breeder;
    MockBEM bem;

    function setUp() public override {
        bem = new MockBEM();
        super.setUp();
        address[2] memory payers = [alice, bob];
        for (uint256 i = 0; i < payers.length; i++) {
            bem.mint(payers[i], 10e8);
            vm.prank(payers[i]);
            bem.approve(address(breeder), type(uint256).max);
        }
    }

    function _deployBreeder() internal override returns (address) {
        breeder = new BreederV2(reg, IERC20(address(bem)), owner);
        return address(breeder);
    }

    /// Any fee is accepted here; the fee guard has its own tests.
    function _breed(address who, uint256 a, uint256 b, uint64 childBrain) internal override returns (uint256) {
        vm.prank(who);
        return breeder.breed(a, b, address(cpu), childBrain, 0, type(uint256).max);
    }

    function _allowPartner(address who, uint256 petId, address partner, bool allowed) internal override {
        vm.prank(who);
        breeder.allowPartner(petId, partner, allowed);
    }

    function _consent(uint256 petId, address partner) internal view override returns (bool) {
        return breeder.consent(petId, partner);
    }

    function _isChildCircuit(uint64 childBrain, PetRegistry.Pet memory pa, PetRegistry.Pet memory pb) internal view override returns (bool) {
        return breeder.isChildCircuit(address(cpu), childBrain, pa, pb);
    }

    /// The cap binds on the second parent too, even when the first parent has never bred.
    function test_theSecondParentAlsoStopsAtFourChildren() public {
        uint256[5] memory mates;
        for (uint256 i = 0; i < mates.length; i++) mates[i] = reg.hatch(alice, 0, address(cpu), brainA, 0);
        vm.warp(block.timestamp + 7 days);
        for (uint256 i = 0; i < 4; i++) {
            _breed(alice, mates[i], petB, child);
            vm.warp(block.timestamp + 3 days + 1);
        }
        assertEq(breeder.children(petB), 4);
        assertEq(breeder.children(mates[4]), 0);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.TooManyChildren.selector, petB));
        _breed(alice, mates[4], petB, child);
        assertEq(breeder.totalBurned(), 4 * FEE);
    }

    /// The fee must reach the dead address in full: a token that delivers less there is refused, and nothing hatches.
    function test_aTokenThatBurnsLessThanTheFeeHatchesNothing() public {
        ShortToken short = new ShortToken();
        BreederV2 b2 = new BreederV2(reg, IERC20(address(short)), owner);
        vm.prank(owner);
        reg.setBreeder(address(b2), true);
        short.mint(alice, 1e8);
        vm.prank(alice);
        short.approve(address(b2), type(uint256).max);
        uint256 next = reg.nextPetId();
        vm.prank(alice);
        vm.expectRevert(BreederV2.PaymentShort.selector);
        b2.breed(petA, petB, address(cpu), child, 0, FEE);
        assertEq(reg.nextPetId(), next);
        assertEq(b2.totalBurned(), 0);
        assertEq(b2.children(petA), 0);
        assertEq(b2.lastBred(petA), 0);
        assertEq(short.balanceOf(alice), 1e8);
    }

    /// `maxFee` is a ceiling, not a price: after a fee cut, a caller who allowed more pays only the new fee.
    function test_aFeeCutInFlightChargesOnlyTheNewFee() public {
        vm.prank(owner);
        breeder.setFee(0.05e8);
        vm.prank(alice);
        breeder.breed(petA, petB, address(cpu), child, 0, FEE);
        assertEq(bem.balanceOf(alice), 10e8 - 0.05e8);
        assertEq(bem.balanceOf(DEAD), 0.05e8);
        assertEq(breeder.totalBurned(), 0.05e8);
    }
}
