// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, stdJson} from "forge-std/Test.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {BreederV2} from "../src/BreederV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITapeOutFactory, ITapeOutProcessor} from "../src/interfaces/ITapeOut.sol";

interface IProcB {
    function tapeout(bytes calldata nl, uint32 nIn, uint32 nOut) external payable returns (uint256);
    function TAPEOUT_FEE() external view returns (uint256);
    function transistors() external view returns (address);
    function circuitInfo(uint256 id) external view returns (uint256, uint256, uint256, uint256);
}

interface ITransistorsB {
    function mint(uint256 id, uint256 amount) external payable;
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
}

/// The BEM-fee breeder, ported from Breeder.fork.t.sol (all its checks still hold), on a fork of X Layer: a child circuit that REFs two parent brains tapes
/// out, steps correctly, and is accepted by the Breeder only when it is exactly the
/// composition of those parents.
contract BreederV2ForkTest is Test {
    IERC20 constant BEM = IERC20(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 constant FEE = 0.1e8;
    using stdJson for string;

    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    IProcB constant PROC = IProcB(0xE0EF4FffD869cBD24b2F83E6d2d83109937E05ff);

    PetRegistry reg;
    BreederV2 breeder;
    string fx;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint64 brainA;
    uint64 brainB;
    uint256 petA;
    uint256 petB;
    uint256 constant ADULT = uint256(4) << 148;

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function _mint(uint256 id, uint256 n) internal {
        if (n == 0) return;
        ITransistorsB t = ITransistorsB(PROC.transistors());
        t.mint{value: t.mintPrice() * n + t.protocolFee()}(id, n);
    }

    function _tapeoutStarter(string memory name) internal returns (uint64) {
        bytes memory nl = fx.readBytes(string.concat(".", name, ".netlist"));
        uint256 gates = fx.readUint(string.concat(".", name, ".gates"));
        uint256 latches = fx.readUint(string.concat(".", name, ".nState"));
        _mint(0, gates - latches);
        _mint(1, latches);
        return uint64(PROC.tapeout{value: PROC.TAPEOUT_FEE()}(nl, 16, 8));
    }

    function _ref(address cpu, uint64 id) internal pure returns (bytes memory r) {
        r = abi.encodePacked(uint8(2), cpu, id, uint8(16), uint8(8));
        for (uint256 k = 0; k < 16; k++) r = abi.encodePacked(r, uint24(2 + k));
    }

    function _child(uint64 a, uint64 b, bytes memory glue) internal returns (uint64) {
        bytes memory nl = abi.encodePacked(_ref(address(PROC), a), _ref(address(PROC), b), glue);
        _mint(0, glue.length / 7);
        return uint64(PROC.tapeout{value: PROC.TAPEOUT_FEE()}(nl, 16, 8));
    }

    function setUp() public {
        if (block.chainid != 196) vm.skip(true);
        fx = vm.readFile("test/fixtures/starters.json");
        vm.deal(address(this), 1_000 ether);
        reg = new PetRegistry(FACTORY, owner);
        breeder = new BreederV2(reg, BEM, owner);
        brainA = _tapeoutStarter("gentle");
        brainB = _tapeoutStarter("bold");
        vm.startPrank(owner);
        reg.setStarterBrain(address(PROC), brainA, true);
        reg.setStarterBrain(address(PROC), brainB, true);
        reg.setBreeder(address(breeder), true);
        vm.stopPrank();
        // breeders pay the fee in real BEM
        for (uint256 i = 0; i < 2; i++) {
            address w = i == 0 ? alice : bob;
            deal(address(BEM), w, 10e8);
            vm.prank(w);
            BEM.approve(address(breeder), type(uint256).max);
        }
        petA = reg.hatch(alice, 0, address(PROC), brainA, ADULT | 0xA5);
        petB = reg.hatch(alice, 1, address(PROC), brainB, ADULT | 0x3C);
        // grown up by on-chain age
        vm.warp(block.timestamp + 7 days);
    }

    function test_childBrainTapesOutStepsAndBreeds() public {
        uint64 child = _child(brainA, brainB, fx.readBytes(".glue"));
        (uint256 nIn, uint256 nOut, uint256 nState,) = PROC.circuitInfo(child);
        assertEq(nIn, 16);
        assertEq(nOut, 8);
        assertEq(nState, 16, "child holds both parents' memory");

        vm.prank(alice);
        uint256 kid = breeder.breed(petA, petB, address(PROC), child, 0, FEE);
        PetRegistry.Pet memory k = reg.pet(kid);
        assertEq(k.parentA, petA);
        assertEq(k.parentB, petB);
        assertEq(k.brainBits, 16);
        assertEq(k.state, uint256(0xA5) | (uint256(0x3C) << 8), "memories carried over");
        assertEq(reg.ownerOf(kid), alice);

        // the child's thoughts are its parents' thoughts, mixed as specified
        for (uint256 i = 0; i < 24; i++) _checkKidBeat(kid, i);
    }

    function _checkKidBeat(uint256 kid, uint256 i) internal view {
        uint16 w = uint16(uint256(keccak256(abi.encode(i))));
        uint64 sa = uint64(uint256(keccak256(abi.encode(i, 1))) & 0xff);
        uint64 sb = uint64(uint256(keccak256(abi.encode(i, 2))) & 0xff);
        (uint64 na, uint8 oa) = reg.replayStep(petA, sa, w);
        (uint64 nb, uint8 ob) = reg.replayStep(petB, sb, w);
        (uint64 nk, uint8 ok) = reg.replayStep(kid, sa | (sb << 8), w);
        bool fromA = ((w >> 8) & 3) == 1 || ((w >> 8) & 3) == 2;
        assertEq(ok, ((fromA ? oa : ob) & 7) | (oa & 0x18) | (ob & 0xE0), "child output");
        assertEq(nk, na | (nb << 8), "child memory");
    }

    function test_rejectsAChildCircuitOfOtherParentsOrSwappedOrder() public {
        uint64 swapped = _child(brainB, brainA, fx.readBytes(".glue"));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.NotAChildOf.selector, petA, petB));
        breeder.breed(petA, petB, address(PROC), swapped, 0, FEE);
    }

    function test_rejectsTamperedGlue() public {
        bytes memory glue = fx.readBytes(".glue");
        glue[3] = bytes1(uint8(glue[3]) ^ 1);
        uint64 bad = _child(brainA, brainB, glue);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.NotAChildOf.selector, petA, petB));
        breeder.breed(petA, petB, address(PROC), bad, 0, FEE);
    }

    function test_needsAdultsConsentAndCooldown() public {
        uint64 child = _child(brainA, brainB, fx.readBytes(".glue"));
        uint256 baby = reg.hatch(alice, 0, address(PROC), brainA, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.NotAdult.selector, baby));
        breeder.breed(baby, petB, address(PROC), child, 0, FEE);

        uint256 bobsPet = reg.hatch(bob, 1, address(PROC), brainB, ADULT);
        // stage bits written by the client do not make a pet adult; age on chain does
        vm.prank(alice);
        vm.expectRevert(BreederV2.NoConsent.selector);
        breeder.breed(petA, bobsPet, address(PROC), child, 0, FEE);
        vm.prank(bob);
        breeder.allowPartner(bobsPet, alice, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.NotAdult.selector, bobsPet));
        breeder.breed(petA, bobsPet, address(PROC), child, 0, FEE);

        vm.prank(alice);
        breeder.breed(petA, petB, address(PROC), child, 0, FEE);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.TooSoon.selector, petA));
        breeder.breed(petA, petB, address(PROC), child, 0, FEE);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(alice);
        breeder.breed(petA, petB, address(PROC), child, 0, FEE);

        vm.prank(alice);
        vm.expectRevert(BreederV2.SamePet.selector);
        breeder.breed(petA, petA, address(PROC), child, 0, FEE);
    }

    function test_childrenCannotHaveChildren() public {
        uint64 child = _child(brainA, brainB, fx.readBytes(".glue"));
        vm.prank(alice);
        uint256 kid = breeder.breed(petA, petB, address(PROC), child, 0, FEE);
        // a child is refused as a parent, on either side, before anything else is checked
        vm.warp(block.timestamp + 3 days + 1);
        uint256 other = reg.hatch(alice, 0, address(PROC), brainA, ADULT);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.NotFirstGeneration.selector, kid));
        breeder.breed(kid, other, address(PROC), child, 0, FEE);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.NotFirstGeneration.selector, kid));
        breeder.breed(other, kid, address(PROC), child, 0, FEE);
    }

    function test_consentFollowsTheOwnerAndIsUsedOnce() public {
        uint256 bobsPet = reg.hatch(bob, 1, address(PROC), brainB, 0);
        vm.warp(block.timestamp + 7 days + 1);
        uint64 child = _child(brainA, brainB, fx.readBytes(".glue"));
        vm.prank(bob);
        breeder.allowPartner(bobsPet, alice, true);
        assertTrue(breeder.consent(bobsPet, alice));
        // bob sells the pet: his consent no longer speaks for the new owner
        address carol = makeAddr("carol");
        vm.prank(bob);
        reg.transferFrom(bob, carol, bobsPet);
        assertFalse(breeder.consent(bobsPet, alice));
        vm.prank(alice);
        vm.expectRevert(BreederV2.NoConsent.selector);
        breeder.breed(petA, bobsPet, address(PROC), child, 0, FEE);
        // even if carol sells the pet back to bob, bob's old consent does not come back
        vm.prank(carol);
        reg.transferFrom(carol, bob, bobsPet);
        assertFalse(breeder.consent(bobsPet, alice));
        vm.prank(bob);
        reg.transferFrom(bob, carol, bobsPet);
        // carol agrees once; one child uses it up
        vm.prank(carol);
        breeder.allowPartner(bobsPet, alice, true);
        vm.prank(alice);
        breeder.breed(petA, bobsPet, address(PROC), child, 0, FEE);
        assertFalse(breeder.consent(bobsPet, alice));
    }

    function test_aParentWithAComposedBrainIsRefused() public {
        // petA switches to a composed (child-shaped) circuit; it may not become a parent with it
        uint64 composed = _child(brainA, brainB, fx.readBytes(".glue"));
        vm.prank(alice);
        reg.setBrain(petA, address(PROC), composed);
        uint64 child = _child(composed, brainB, fx.readBytes(".glue"));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.ComposedBrain.selector, petA));
        breeder.breed(petA, petB, address(PROC), child, 0, FEE);
    }

    /* ── new in V2: the fee, the cap ─────────────────────────────────────── */

    function test_theFeeIsBurnedFromTheCallerInRealBem() public {
        uint64 child = _child(brainA, brainB, fx.readBytes(".glue"));
        uint256 deadBefore = BEM.balanceOf(DEAD);
        uint256 aliceBefore = BEM.balanceOf(alice);
        vm.prank(alice);
        breeder.breed(petA, petB, address(PROC), child, 0, FEE);
        assertEq(BEM.balanceOf(DEAD) - deadBefore, FEE);
        assertEq(aliceBefore - BEM.balanceOf(alice), FEE);
        assertEq(breeder.totalBurned(), FEE);
        assertEq(BEM.balanceOf(address(breeder)), 0); // it never holds BEM
    }

    function test_withoutBemOrApprovalNothingHatches() public {
        uint64 child = _child(brainA, brainB, fx.readBytes(".glue"));
        vm.prank(alice);
        BEM.approve(address(breeder), 0);
        uint256 before = reg.nextPetId();
        vm.prank(alice);
        vm.expectRevert();
        breeder.breed(petA, petB, address(PROC), child, 0, FEE);
        assertEq(reg.nextPetId(), before);
        assertEq(breeder.children(petA), 0);
    }

    function test_aFeeRaiseInFlightIsRefused() public {
        uint64 child = _child(brainA, brainB, fx.readBytes(".glue"));
        vm.prank(owner);
        breeder.setFee(0.2e8);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.FeeMoved.selector, uint256(0.2e8)));
        breeder.breed(petA, petB, address(PROC), child, 0, FEE);
    }

    function test_onlyTheOwnerSetsTheFeeWithinItsBounds() public {
        vm.expectRevert();
        breeder.setFee(0.2e8);
        vm.startPrank(owner);
        vm.expectRevert(BreederV2.BadFee.selector);
        breeder.setFee(0.009e8);
        vm.expectRevert(BreederV2.BadFee.selector);
        breeder.setFee(1.01e8);
        breeder.setFee(0.01e8);
        breeder.setFee(1e8);
        vm.stopPrank();
        assertEq(breeder.breedFee(), 1e8);
    }

    function test_aPetHasAtMostFourChildren() public {
        uint64 child = _child(brainA, brainB, fx.readBytes(".glue"));
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(alice);
            breeder.breed(petA, petB, address(PROC), child, 0, FEE);
            vm.warp(block.timestamp + 3 days + 1);
        }
        assertEq(breeder.children(petA), 4);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreederV2.TooManyChildren.selector, petA));
        breeder.breed(petA, petB, address(PROC), child, 0, FEE);
        assertEq(breeder.totalBurned(), 4 * FEE);
    }

    function test_theOldBreederCanBeSwitchedOff() public {
        // the registry owner turns a breeder off; it can no longer hatch children
        vm.prank(owner);
        reg.setBreeder(address(breeder), false);
        uint64 child = _child(brainA, brainB, fx.readBytes(".glue"));
        vm.prank(alice);
        vm.expectRevert(PetRegistry.NotBreeder.selector);
        breeder.breed(petA, petB, address(PROC), child, 0, FEE);
    }
}
