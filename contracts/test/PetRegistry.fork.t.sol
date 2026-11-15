// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, stdJson} from "forge-std/Test.sol";
import {PetRegistry, IPetRenderer} from "../src/PetRegistry.sol";
import {ITapeOutFactory} from "../src/interfaces/ITapeOut.sol";

interface IProc {
    function tapeout(bytes calldata nl, uint32 nIn, uint32 nOut) external payable returns (uint256);
    function TAPEOUT_FEE() external view returns (uint256);
    function transistors() external view returns (address);
    function circuitInfo(uint256 id) external view returns (uint256, uint256, uint256, uint256);
    function netlist(uint256 id) external view returns (bytes memory);
}

interface ITransistors {
    function mint(uint256 id, uint256 amount) external payable;
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
}

/// Runs against a fork of X Layer: tapes out the real starter brains on an existing
/// processor, hatches pets with them, and checks every replayed beat against the
/// TypeScript evaluator's answers (test/fixtures/starters.json).
///   forge test --fork-url https://rpc.xlayer.tech --match-contract PetRegistryFork
contract PetRegistryForkTest is Test {
    using stdJson for string;

    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    // "Xehemoth", processor index 2: mints NAND in OKB, so a fork can buy transistors.
    IProc constant PROC = IProc(0xE0EF4FffD869cBD24b2F83E6d2d83109937E05ff);

    PetRegistry reg;
    string fixtures;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        if (block.chainid != 196) vm.skip(true);
        fixtures = vm.readFile("test/fixtures/starters.json");
        reg = new PetRegistry(FACTORY, owner);
    }

    function _tapeout(string memory name) internal returns (uint64 id) {
        bytes memory nl = fixtures.readBytes(string.concat(".", name, ".netlist"));
        uint256 gates = fixtures.readUint(string.concat(".", name, ".gates"));
        ITransistors t = ITransistors(PROC.transistors());
        vm.deal(address(this), 1_000 ether);
        uint256 latches = fixtures.readUint(string.concat(".", name, ".nState"));
        // TapeOut burns one NAND transistor (id 0) per NAND and one LATCH transistor (id 1) per LATCH.
        t.mint{value: t.mintPrice() * (gates - latches) + t.protocolFee()}(0, gates - latches);
        if (latches > 0) t.mint{value: t.mintPrice() * latches + t.protocolFee()}(1, latches);
        id = uint64(PROC.tapeout{value: PROC.TAPEOUT_FEE()}(nl, 16, 8));
        assertEq(keccak256(PROC.netlist(id)), keccak256(nl), "stored netlist differs");
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function test_everyStarterBeatMatchesTheEvaluator() public {
        string[3] memory names = ["gentle", "bold", "curious"];
        for (uint256 k = 0; k < 3; k++) {
            uint64 id = _tapeout(names[k]);
            (uint256 nIn, uint256 nOut, uint256 nState,) = PROC.circuitInfo(id);
            assertEq(nIn, 16);
            assertEq(nOut, 8);
            assertEq(nState, fixtures.readUint(string.concat(".", names[k], ".nState")));
            vm.prank(owner);
            reg.setStarterBrain(address(PROC), id, true);
            uint256 petId = reg.hatch(alice, uint8(k), address(PROC), id, 0);
            assertEq(reg.ownerOf(petId), alice);
            for (uint256 i = 0; i < 48; i++) {
                string memory b = string.concat(".", names[k], ".beats[", vm.toString(i), "]");
                uint64 s = uint64(vm.parseUint(fixtures.readString(string.concat(b, ".state"))));
                uint16 w = uint16(vm.parseUint(fixtures.readString(string.concat(b, ".inputs"))));
                uint64 nx = uint64(vm.parseUint(fixtures.readString(string.concat(b, ".next"))));
                uint8 o = uint8(vm.parseUint(fixtures.readString(string.concat(b, ".out"))));
                (uint64 gotNext, uint8 gotOut) = reg.replayStep(petId, s, w);
                assertEq(gotOut, o, "outputs");
                assertEq(gotNext, nx, "next state");
                assertTrue(reg.verifyBeat(petId, s, w, nx, o));
            }
        }
    }

    function test_stepInsideATransactionCostsWhatWeBudgeted() public {
        uint64 id = _tapeout("gentle");
        vm.prank(owner);
        reg.setStarterBrain(address(PROC), id, true);
        uint256 petId = reg.hatch(alice, 0, address(PROC), id, 0);
        uint256 g = gasleft();
        reg.replayStep(petId, 0, 0x1234);
        uint256 used = g - gasleft();
        emit log_named_uint("gas for one on-chain beat of a 296-gate brain", used);
        assertLt(used, 3_000_000);
    }

    function test_hatchRequiresAnApprovedStarter() public {
        uint64 id = _tapeout("bold");
        vm.expectRevert(PetRegistry.NotStarter.selector);
        reg.hatch(alice, 1, address(PROC), id, 0);
    }

    function test_onlyOwnerApprovesStarters_andOnlyRightPins() public {
        uint64 id = _tapeout("bold");
        vm.expectRevert();
        reg.setStarterBrain(address(PROC), id, true);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PetRegistry.NotACpu.selector, address(0xBEEF)));
        reg.setStarterBrain(address(0xBEEF), id, true);
        // circuit 1 on this processor is not a 16-in, 8-out brain
        vm.prank(owner);
        vm.expectRevert();
        reg.setStarterBrain(address(PROC), 1, true);
    }

    function test_checkpointRules() public {
        uint64 id = _tapeout("gentle");
        vm.prank(owner);
        reg.setStarterBrain(address(PROC), id, true);
        uint256 petId = reg.hatch(alice, 0, address(PROC), id, 0);

        // strangers cannot write
        vm.prank(bob);
        vm.expectRevert(PetRegistry.NotKeeper.selector);
        reg.checkpoint(petId, 1, 5, bytes32(uint256(1)));

        // day 1 is today; day 2 is the future
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(PetRegistry.DayInFuture.selector, uint32(2), uint32(1)));
        reg.checkpoint(petId, 2, 5, bytes32(uint256(1)));
        reg.checkpoint(petId, 1, (uint256(0xABCD) << 64) | 0x3FF, bytes32(uint256(1)));
        PetRegistry.Pet memory p = reg.pet(petId);
        assertEq(p.day, 1);
        // brain bits above the brain's 8 latches are cleared; game bits above 64 are kept
        assertEq(p.state, (uint256(0xABCD) << 64) | 0xFF);
        vm.expectRevert(abi.encodeWithSelector(PetRegistry.DayNotAfter.selector, uint32(1), uint32(1)));
        reg.checkpoint(petId, 1, 0, bytes32(0));
        vm.warp(block.timestamp + 3 days);
        reg.checkpoint(petId, 4, 7, bytes32(uint256(2)));
        vm.stopPrank();
    }

    function test_sitterCanCareUntilTheirTimeEnds_andNeverOwns() public {
        uint64 id = _tapeout("curious");
        vm.prank(owner);
        reg.setStarterBrain(address(PROC), id, true);
        uint256 petId = reg.hatch(alice, 2, address(PROC), id, 0);
        vm.prank(bob);
        vm.expectRevert(PetRegistry.NotKeeper.selector);
        reg.setSitter(petId, bob, uint64(block.timestamp + 1 days));
        vm.prank(alice);
        reg.setSitter(petId, carol, uint64(block.timestamp + 1 days));
        vm.prank(carol);
        reg.checkpoint(petId, 1, 1, bytes32(0));
        vm.prank(carol);
        vm.expectRevert(PetRegistry.NotKeeper.selector);
        reg.setBrain(petId, address(PROC), id);
        vm.warp(block.timestamp + 2 days);
        vm.prank(carol);
        vm.expectRevert(PetRegistry.NotKeeper.selector);
        reg.checkpoint(petId, 3, 1, bytes32(0));
        assertEq(reg.ownerOf(petId), alice);
    }

    function test_sitterLosesAccessWhenThePetChangesHands_andSittingIsCapped() public {
        uint64 id = _tapeout("gentle");
        vm.prank(owner);
        reg.setStarterBrain(address(PROC), id, true);
        uint256 petId = reg.hatch(alice, 0, address(PROC), id, 0);
        vm.prank(alice);
        vm.expectRevert(PetRegistry.SittingTooLong.selector);
        reg.setSitter(petId, carol, uint64(block.timestamp + 31 days));
        vm.prank(alice);
        reg.setSitter(petId, carol, uint64(block.timestamp + 10 days));
        assertTrue(reg.isKeeper(petId, carol));
        vm.prank(alice);
        reg.transferFrom(alice, bob, petId);
        assertFalse(reg.isKeeper(petId, carol));
        vm.prank(carol);
        vm.expectRevert(PetRegistry.NotKeeper.selector);
        reg.checkpoint(petId, 1, 1, bytes32(0));
        // and the sitting does not come back if the pet returns to alice
        vm.prank(bob);
        reg.transferFrom(bob, alice, petId);
        assertFalse(reg.isKeeper(petId, carol));
    }

    function test_settledPetsAndMetadataWithoutARenderer() public {
        uint64 id = _tapeout("gentle");
        vm.prank(owner);
        reg.setStarterBrain(address(PROC), id, true);
        uint256 petId = reg.hatch(alice, 0, address(PROC), id, 0);
        assertFalse(reg.isSettled(petId), "a fresh hatch is not settled");
        vm.warp(block.timestamp + 3 days);
        assertFalse(reg.isSettled(petId), "old enough but nothing saved");
        vm.prank(alice);
        reg.checkpoint(petId, 2, 0, bytes32(0));
        assertFalse(reg.isSettled(petId), "only two days saved");
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        reg.checkpoint(petId, 4, 0, bytes32(0));
        assertTrue(reg.isSettled(petId));
        string memory uri = reg.tokenURI(petId);
        assertEq(bytes(uri).length > 60, true);
        assertEq(_startsWith(uri, "data:application/json;base64,"), true);
        // each change of hands is counted
        assertEq(reg.transferCount(petId), 0);
        vm.prank(alice);
        reg.transferFrom(alice, bob, petId);
        assertEq(reg.transferCount(petId), 1);
    }

    function _startsWith(string memory s, string memory pre) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(pre);
        if (a.length < b.length) return false;
        for (uint256 i = 0; i < b.length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    function test_newBrainKeepsSharedMemory() public {
        uint64 a = _tapeout("gentle");
        uint64 b = _tapeout("bold");
        vm.startPrank(owner);
        reg.setStarterBrain(address(PROC), a, true);
        vm.stopPrank();
        uint256 petId = reg.hatch(alice, 0, address(PROC), a, 0xA5);
        vm.prank(alice);
        reg.setBrain(petId, address(PROC), b);
        PetRegistry.Pet memory p = reg.pet(petId);
        assertEq(p.brainId, b);
        assertEq(p.state, 0xA5);
    }

    function test_breedingOnlyThroughApprovedBreeders() public {
        uint64 id = _tapeout("gentle");
        vm.prank(owner);
        reg.setStarterBrain(address(PROC), id, true);
        uint256 pa = reg.hatch(alice, 0, address(PROC), id, 0);
        uint256 pb = reg.hatch(bob, 0, address(PROC), id, 0);
        vm.expectRevert(PetRegistry.NotBreeder.selector);
        reg.hatchChild(alice, 0, address(PROC), id, 0, uint128(pa), uint128(pb));
        vm.prank(owner);
        reg.setBreeder(address(this), true);
        vm.expectRevert(PetRegistry.UnknownPet.selector);
        reg.hatchChild(alice, 0, address(PROC), id, 0, uint128(pa), 999);
        uint256 child = reg.hatchChild(alice, 0, address(PROC), id, 0, uint128(pa), uint128(pb));
        PetRegistry.Pet memory p = reg.pet(child);
        assertEq(p.parentA, pa);
        assertEq(p.parentB, pb);
    }

    function test_logHashChain() public view {
        bytes32 h = reg.chainLog(bytes32(0), 0x1234);
        assertEq(h, keccak256(abi.encodePacked(bytes32(0), uint16(0x1234))));
    }
}
