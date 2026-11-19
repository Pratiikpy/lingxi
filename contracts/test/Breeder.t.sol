// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, stdJson} from "forge-std/Test.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {Breeder} from "../src/Breeder.sol";
import {ITapeOutFactory} from "../src/interfaces/ITapeOut.sol";
import {MockTapeOutFactory} from "./PetLook.t.sol";

/// A TapeOut processor reduced to what breeding reads: each circuit's pins and latches, and its netlist bytes.
contract NetlistCpu {
    uint64 public next = 1;
    mapping(uint256 => bytes) private _netlists;
    mapping(uint256 => uint256) private _latches;

    function add(bytes memory nl, uint256 latches) external returns (uint64 id) {
        id = next++;
        _netlists[id] = nl;
        _latches[id] = latches;
    }

    function circuitInfo(uint256 id) external view returns (uint256, uint256, uint256, uint256) {
        return (16, 8, _latches[id], _netlists[id].length / 7);
    }

    function netlist(uint256 id) external view returns (bytes memory) {
        return _netlists[id];
    }
}

/// A breeder on a real PetRegistry over a mock processor, so every check on a parent's brain and on the child
/// circuit can be reached with hand-made netlists. Both breeders run these tests; they declare the same errors and
/// events, so Breeder's selectors serve for both.
abstract contract BreederUnitBase is Test {
    using stdJson for string;

    uint256 constant REF_LEN = 79;

    PetRegistry reg;
    NetlistCpu cpu;
    address breederAddr;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    bytes glue;
    uint64 brainA;
    uint64 brainB;
    uint64 child;
    uint256 petA;
    uint256 petB;

    function setUp() public virtual {
        reg = new PetRegistry(ITapeOutFactory(address(new MockTapeOutFactory())), owner);
        cpu = new NetlistCpu();
        glue = vm.readFile("test/fixtures/starters.json").readBytes(".glue");
        brainA = cpu.add(_plain(), 8);
        brainB = cpu.add(_plain(), 8);
        child = cpu.add(_childOf(brainA, brainB), 16);
        breederAddr = _deployBreeder();
        vm.startPrank(owner);
        reg.setStarterBrain(address(cpu), brainA, true);
        reg.setStarterBrain(address(cpu), brainB, true);
        reg.setBreeder(breederAddr, true);
        vm.stopPrank();
        petA = reg.hatch(alice, 0, address(cpu), brainA, 0xA5);
        petB = reg.hatch(alice, 1, address(cpu), brainB, 0x3C);
        // grown up by on-chain age
        vm.warp(block.timestamp + 7 days);
    }

    /* ── the breeder under test ────────────────────────────────────────── */

    function _deployBreeder() internal virtual returns (address);

    /// Each hook makes exactly one call to the breeder, so it may follow vm.expectRevert directly.
    function _breed(address who, uint256 a, uint256 b, uint64 childBrain) internal virtual returns (uint256);

    function _allowPartner(address who, uint256 petId, address partner, bool allowed) internal virtual;

    function _consent(uint256 petId, address partner) internal view virtual returns (bool);

    function _isChildCircuit(uint64 childBrain, PetRegistry.Pet memory pa, PetRegistry.Pet memory pb) internal view virtual returns (bool);

    /* ── netlists ──────────────────────────────────────────────────────── */

    /// Eight LATCH records and two NAND records: a plain brain as far as a breeder can tell.
    function _plain() internal pure returns (bytes memory nl) {
        for (uint256 i = 0; i < 8; i++) nl = abi.encodePacked(nl, uint8(1), uint24(i));
        nl = abi.encodePacked(nl, uint8(0), uint48(0x000102000304), uint8(0), uint48(0x000506000708));
    }

    function _ref(uint64 id) internal view returns (bytes memory r) {
        r = abi.encodePacked(uint8(2), address(cpu), id, uint8(16), uint8(8));
        for (uint256 k = 0; k < 16; k++) r = abi.encodePacked(r, uint24(2 + k));
    }

    function _childOf(uint64 a, uint64 b) internal view returns (bytes memory) {
        return abi.encodePacked(_ref(a), _ref(b), glue);
    }

    function _flip(bytes memory b, uint256 at, uint8 mask) internal pure returns (bytes memory c) {
        c = bytes.concat(b);
        c[at] = bytes1(uint8(c[at]) ^ mask);
    }

    function _cut(bytes memory b) internal pure returns (bytes memory c) {
        c = new bytes(b.length - 1);
        for (uint256 i = 0; i < c.length; i++) c[i] = b[i];
    }

    /// The true child netlist with one thing wrong, once for every check the breeder makes on it.
    function _nearMisses() internal view returns (bytes[] memory nl, string[] memory why) {
        bytes memory good = _childOf(brainA, brainB);
        nl = new bytes[](11);
        why = new string[](11);
        (nl[0], why[0]) = (abi.encodePacked(good, uint8(0)), "one byte too long");
        (nl[1], why[1]) = (_cut(good), "one byte too short");
        (nl[2], why[2]) = (_flip(good, 0, 0x02), "the first record is a NAND, not a REF");
        (nl[3], why[3]) = (_flip(good, 1, 0x01), "the first REF names another processor");
        (nl[4], why[4]) = (_flip(good, 28, 0x01), "the first REF names another circuit");
        (nl[5], why[5]) = (_flip(good, 29, 0x1F), "the first REF takes 15 inputs");
        (nl[6], why[6]) = (_flip(good, 30, 0x0F), "the first REF gives 7 outputs");
        (nl[7], why[7]) = (_flip(good, 31 + 3 * 5 + 2, 0x01), "the first REF wires input 5 to the wrong pin");
        (nl[8], why[8]) = (_flip(good, REF_LEN, 0x03), "the second record is a LATCH, not a REF");
        (nl[9], why[9]) = (_flip(good, REF_LEN + 28, 0x01), "the second REF names another circuit");
        (nl[10], why[10]) = (_flip(good, 2 * REF_LEN + 5, 0x01), "the glue differs by one bit");
    }

    /* ── the child circuit ─────────────────────────────────────────────── */

    function test_theExactCompositionBreedsAndCarriesBothMemories() public {
        uint256 next = reg.nextPetId();
        vm.expectEmit(true, true, true, true, breederAddr);
        emit Breeder.Born(next, petA, petB, address(cpu), child);
        uint256 kid = _breed(alice, petA, petB, child);
        PetRegistry.Pet memory k = reg.pet(kid);
        assertEq(reg.ownerOf(kid), alice);
        assertEq(k.parentA, petA);
        assertEq(k.parentB, petB);
        assertEq(k.brainBits, 16);
        assertEq(k.state, uint256(0xA5) | (uint256(0x3C) << 8), "A's memory first, then B's");
    }

    function test_isChildCircuitAcceptsOnlyTheExactComposition() public {
        PetRegistry.Pet memory pa = reg.pet(petA);
        PetRegistry.Pet memory pb = reg.pet(petB);
        assertTrue(_isChildCircuit(child, pa, pb));
        assertFalse(_isChildCircuit(child, pb, pa), "the parents in the other order");
        (bytes[] memory nl, string[] memory why) = _nearMisses();
        for (uint256 i = 0; i < nl.length; i++) assertFalse(_isChildCircuit(cpu.add(nl[i], 16), pa, pb), why[i]);
    }

    function test_breedRefusesEveryNearMissAndLeavesNoTrace() public {
        (bytes[] memory nl,) = _nearMisses();
        uint256 next = reg.nextPetId();
        for (uint256 i = 0; i < nl.length; i++) {
            uint64 id = cpu.add(nl[i], 16);
            vm.expectRevert(abi.encodeWithSelector(Breeder.NotAChildOf.selector, petA, petB));
            _breed(alice, petA, petB, id);
        }
        assertEq(reg.nextPetId(), next);
        // a refusal starts no cooldown: the true child still breeds at once
        _breed(alice, petA, petB, child);
    }

    /// A breeder walks a parent's netlist record by record: anything but NAND and LATCH, or a record cut short,
    /// means the brain is not plain.
    function test_aParentBrainWithAnUnknownOrTruncatedRecordCountsAsComposed() public {
        bytes[2] memory odd = [abi.encodePacked(_plain(), uint8(3), uint48(0)), abi.encodePacked(_plain(), uint8(0), uint16(0))];
        for (uint256 i = 0; i < odd.length; i++) {
            uint64 brain = cpu.add(odd[i], 8);
            vm.prank(alice);
            reg.setBrain(petA, address(cpu), brain);
            vm.expectRevert(abi.encodeWithSelector(Breeder.ComposedBrain.selector, petA));
            _breed(alice, petA, petB, child);
        }
    }

    /* ── who may breed ─────────────────────────────────────────────────── */

    function test_aStrangerMayNotGrantOrWithdrawConsentForAPet() public {
        _allowPartner(alice, petB, carol, true);
        vm.expectRevert(Breeder.NotYours.selector);
        _allowPartner(bob, petB, bob, true);
        vm.expectRevert(Breeder.NotYours.selector);
        _allowPartner(bob, petB, carol, false);
        assertFalse(_consent(petB, bob));
        assertTrue(_consent(petB, carol));
    }

    /// Consent lets a partner bring the pet as the second parent, never as the first: the caller must own parent A.
    function test_consentDoesNotLetThePartnerBreedThePetAsTheFirstParent() public {
        uint256 bobsPet = reg.hatch(bob, 1, address(cpu), brainB, 0);
        vm.warp(block.timestamp + 7 days);
        _allowPartner(alice, petA, bob, true);
        vm.expectRevert(Breeder.NotYours.selector);
        _breed(bob, petA, bobsPet, child);
        assertTrue(_consent(petA, bob), "a refused breed does not use the consent");
        // the same pair the right way round: bob's pet first, alice's second
        uint256 kid = _breed(bob, bobsPet, petA, cpu.add(_childOf(brainB, brainA), 16));
        assertEq(reg.ownerOf(kid), bob);
        assertFalse(_consent(petA, bob), "one consent, one child");
    }

    /* ── defects pinned, not fixed ─────────────────────────────────────── */

    /// The breeders promise "a child can never claim a lineage its brain does not have", and they do check the
    /// child circuit before it hatches. But PetRegistry.setBrain lets the owner give the child any other brain
    /// afterwards, and the child keeps its parents, so the promise holds at birth only.
    function test_defect_aChildKeepsItsParentsAfterItsBrainIsSwapped() public {
        uint256 kid = _breed(alice, petA, petB, child);
        uint64 other = cpu.add(_plain(), 8);
        vm.prank(alice);
        reg.setBrain(kid, address(cpu), other);
        PetRegistry.Pet memory k = reg.pet(kid);
        assertEq(k.parentA, petA);
        assertEq(k.parentB, petB);
        assertEq(k.brainId, other);
        assertFalse(_isChildCircuit(k.brainId, reg.pet(petA), reg.pet(petB)), "its brain is no longer their child");
    }
}

contract BreederTest is BreederUnitBase {
    Breeder breeder;

    function _deployBreeder() internal override returns (address) {
        breeder = new Breeder(reg);
        return address(breeder);
    }

    function _breed(address who, uint256 a, uint256 b, uint64 childBrain) internal override returns (uint256) {
        vm.prank(who);
        return breeder.breed(a, b, address(cpu), childBrain, 0);
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
}
