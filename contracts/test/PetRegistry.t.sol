// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {ITapeOutFactory} from "../src/interfaces/ITapeOut.sol";
import {MockTapeOutFactory} from "./PetLook.t.sol";

/// A processor whose circuits have 16 inputs, 8 outputs and as many latches as a test asks for. Its `step` hands
/// back the state bytes it was given, so a test sees exactly what the registry packed, and answers `outLen` output
/// bytes, the first being the high input byte, so a test sees both input bytes arrive.
contract EchoCpu {
    struct Circuit {
        uint256 nState;
        uint256 outLen;
    }

    mapping(uint256 => Circuit) private _circuits;

    function set(uint256 id, uint256 nState, uint256 outLen) external {
        _circuits[id] = Circuit(nState, outLen);
    }

    function circuitInfo(uint256 id) external view returns (uint256, uint256, uint256, uint256) {
        return (16, 8, _circuits[id].nState, 1);
    }

    function step(uint256 id, bytes calldata state, bytes calldata inputs) external view returns (bytes memory, bytes memory out) {
        out = new bytes(_circuits[id].outLen);
        if (out.length != 0) out[0] = inputs[1];
        return (state, out);
    }
}

/// The registry's edges that the fork suite's real brains never reach: pets that do not exist, brains of unusual
/// widths, and processors that answer a beat in the wrong shape.
contract PetRegistryTest is Test {
    PetRegistry reg;
    EchoCpu cpu;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");

    function setUp() public {
        reg = new PetRegistry(ITapeOutFactory(address(new MockTapeOutFactory())), owner);
        cpu = new EchoCpu();
    }

    /// Approves circuit `id` (with `nState` latches and `outLen` output bytes a beat) as a starter, and hatches alice a pet on it.
    function _petOn(uint64 id, uint256 nState, uint256 outLen) internal returns (uint256) {
        cpu.set(id, nState, outLen);
        vm.prank(owner);
        reg.setStarterBrain(address(cpu), id, true);
        return reg.hatch(alice, 0, address(cpu), id, 0);
    }

    /// Without the existence check the zero address would pass for the owner of a pet that was never hatched.
    function test_nobodyKeepsAPetThatDoesNotExist() public {
        assertFalse(reg.isKeeper(42, address(0)));
        assertFalse(reg.isKeeper(42, alice));
        vm.prank(alice);
        vm.expectRevert(PetRegistry.NotKeeper.selector);
        reg.checkpoint(42, 1, 0, bytes32(0));
    }

    function test_replayingAPetThatDoesNotExistReverts() public {
        vm.expectRevert(PetRegistry.UnknownPet.selector);
        reg.replayStep(42, 0, 0);
        vm.expectRevert(PetRegistry.UnknownPet.selector);
        reg.verifyBeat(42, 0, 0, 0, 0);
    }

    /// Eight output pins are one byte; a processor that answers a beat with any other length is not believed.
    function test_aBeatAnsweredWithOtherThanOneOutputByteIsRefused() public {
        uint256 silent = _petOn(1, 8, 0);
        uint256 chatty = _petOn(2, 8, 2);
        vm.expectRevert(abi.encodeWithSelector(PetRegistry.BadOutput.selector, 0));
        reg.replayStep(silent, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(PetRegistry.BadOutput.selector, 2));
        reg.verifyBeat(chatty, 0, 0, 0, 0);
    }

    /// The brain's latches live in the low 64 bits of the pet's state word, so 64 is the most a brain may have.
    function test_aBrainOfMoreThan64LatchesIsRefusedAsAStarterAndAsANewBrain() public {
        uint256 pet = _petOn(1, 64, 1);
        assertEq(reg.pet(pet).brainBits, 64);
        cpu.set(2, 65, 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PetRegistry.BrainTooBig.selector, 65));
        reg.setStarterBrain(address(cpu), 2, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PetRegistry.BrainTooBig.selector, 65));
        reg.setBrain(pet, address(cpu), 2);
        assertEq(reg.pet(pet).brainId, 1);
        // withdrawing an approval never inspects the brain
        vm.prank(owner);
        reg.setStarterBrain(address(cpu), 2, false);
        assertFalse(reg.starterBrain(address(cpu), 2));
    }

    /// A replay hands the processor only the brain's own latch bits, least significant first, and all sixteen inputs.
    function test_aReplayPassesOnlyTheBrainsOwnBitsAndBothInputBytes() public {
        uint8[4] memory widths = [0, 5, 12, 64];
        uint64[4] memory echoed = [uint64(0), 0x1F, 0xFFF, type(uint64).max];
        for (uint256 i = 0; i < widths.length; i++) {
            uint256 pet = _petOn(uint64(i + 1), widths[i], 1);
            (uint64 next, uint8 outputs) = reg.replayStep(pet, type(uint64).max, 0xAB12);
            assertEq(next, echoed[i]);
            assertEq(outputs, 0xAB);
            assertTrue(reg.verifyBeat(pet, type(uint64).max, 0xAB12, echoed[i], 0xAB));
        }
    }
}
