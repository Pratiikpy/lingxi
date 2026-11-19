// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {PetLook} from "../src/PetLook.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {LookText} from "./PetLook.t.sol";

/// The deployed PetLook on a fork of X Layer (addresses from packages/chain/deployments/xlayer.json): its code is
/// this source, the registry draws through it, the installed art is complete and draws every look, and a live pet
/// can be named. Everything written here stays in the fork. Run with `forge test --fork-url <X Layer RPC>`.
contract PetLookForkTest is Test {
    using LookText for bytes;

    PetLook constant LOOK = PetLook(0x0642A802967260714D4EfeC05feF701b17D31b75);
    PetRegistry constant REGISTRY = PetRegistry(0x103d7252eB6b2fec22B3F65A6BB605945F280E99);
    address constant DEPLOYER = 0xA551feD6f2Ab35d509A71B74D5E9F38742E0aaD8;

    function setUp() public {
        if (block.chainid != 196) vm.skip(true);
    }

    /// Byte for byte, including the metadata hash of the source and settings. Coverage builds without the
    /// optimizer, so the comparison only means something in a normal build.
    function test_deployedBytecodeIsBuiltFromThisSource() public {
        if (vm.isContext(VmSafe.ForgeContext.Coverage)) vm.skip(true);
        PetLook fresh = new PetLook(REGISTRY, address(this)); // the only immutable is the registry
        assertEq(address(LOOK).code.length, address(fresh).code.length);
        assertEq(keccak256(address(LOOK).code), keccak256(address(fresh).code));
    }

    function test_theRegistryDrawsThroughThisDeployment() public view {
        assertEq(address(REGISTRY.renderer()), address(LOOK));
        assertEq(address(LOOK.registry()), address(REGISTRY));
        assertEq(LOOK.owner(), DEPLOYER);
    }

    /// No live palette carries the alpha (254) that _style writes as ".:0".
    function test_noLivePaletteUsesTheMalformedAlpha() public view {
        for (uint256 id; id < 6; ++id) {
            bytes memory pal = LOOK.palette(id);
            assertEq(pal.length, 64);
            for (uint256 r; r < 16; ++r) assertTrue(uint8(pal[r * 4 + 3]) != 254);
        }
    }

    /// Every live pet's metadata, as the registry serves it: valid JSON, its name, its facts, and the picture of its
    /// saved state.
    function test_everyLivePetsMetadataDecodesAndShowsItsSavedState() public {
        uint256 next = REGISTRY.nextPetId();
        assertGt(next, 1);
        for (uint256 id = 1; id < next; ++id) {
            PetRegistry.Pet memory p = REGISTRY.pet(id);
            string memory uri = REGISTRY.tokenURI(id);
            assertEq(uri, LOOK.tokenURI(id));
            string memory json = string(LookText.decode64(string(bytes(uri).after_("data:application/json;base64,"))));
            string memory name = LOOK.nameOf(id);
            assertEq(vm.parseJsonString(json, ".name"), bytes(name).length != 0 ? name : string.concat("Lingxi #", Strings.toString(id)));
            bytes memory img = bytes(vm.parseJsonString(json, ".image"));
            assertEq(string(LookText.decode64(string(img.after_("data:image/svg+xml;base64,")))), LOOK.svgOf(p.state));
            assertEq(vm.parseJsonUint(json, ".attributes[1].value"), p.day);
            assertEq(vm.parseJsonUint(json, ".attributes[2].value"), (p.state >> 220) & 63);
            assertEq(vm.parseJsonUint(json, ".attributes[3].value"), (p.state >> 226) & 255);
            assertEq(vm.parseJsonUint(json, ".attributes[4].value"), p.parentA == 0 ? 0 : 1);
            assertEq(vm.parseJsonUint(json, ".attributes[5].value"), p.brainId);
            (uint256 line,,,) = LOOK.lookOf(p.state);
            if (line != p.line) {
                emit log_named_uint("pet drawn with a line other than the one it hatched with", id);
                emit log_named_uint("  registry line", p.line);
                emit log_named_uint("  drawn line (state bits 152-153)", line);
            }
        }
    }

    /// The installed art passes freezeArt's completeness check (the freeze stays in the fork).
    function test_theInstalledArtIsCompleteEnoughToFreeze() public {
        assertFalse(LOOK.artFrozen());
        vm.prank(LOOK.owner());
        LOOK.freezeArt();
        assertTrue(LOOK.artFrozen());
    }

    /// Every line and stage, unlit and lit, on the real art: the frame, all sixteen colours, and one rect per run
    /// on the canvas. Reports the heaviest picture's gas. It reads every stored layer (several hundred slots); under
    /// `forge coverage` every suite shares the public node at once and it answers HTTP 403, while calls into deployed
    /// bytecode add nothing to source coverage, so the sweep runs in the fork test command only.
    function test_theInstalledArtDrawsEveryLook() public {
        if (vm.isContext(VmSafe.ForgeContext.Coverage)) vm.skip(true);
        uint256 heaviest;
        for (uint256 line; line < 3; ++line) {
            for (uint256 stage; stage <= 4; ++stage) {
                for (uint256 m; m < 2; ++m) {
                    uint256 state = _mood(line, stage, m == 1);
                    uint256 g = gasleft();
                    bytes memory svg = bytes(LOOK.svgOf(state));
                    uint256 used = g - gasleft();
                    if (used > heaviest) heaviest = used;
                    uint256 slot = stage == 0 ? 0 : 10 * (line + 1) + stage;
                    bytes memory f = LOOK.frame(slot);
                    assertEq(f.length, 3);
                    string memory viewBox = string.concat(
                        'viewBox="', Strings.toString(uint8(f[0])), " ", Strings.toString(uint8(f[1])), " ", Strings.toString(uint8(f[2])), " ", Strings.toString(uint8(f[2])), '"'
                    );
                    assertTrue(svg.contains(bytes(viewBox)));
                    assertEq(svg.count("{fill:#"), 16);
                    assertEq(svg.count("<rect "), _expectedRects(state));
                    assertTrue(svg.endsWith("</svg>"));
                }
            }
        }
        emit log_named_uint("gas for the heaviest svgOf on the installed art", heaviest);
    }

    /// A live pet, settled in the fork, is named by its owner; the name shows in the registry's metadata and is
    /// refused to strangers and to the other pets.
    function test_aLivePetIsNamedAndTheNameShowsInItsMetadata() public {
        uint256 id = 1;
        PetRegistry.Pet memory p = REGISTRY.pet(id);
        address holder = REGISTRY.ownerOf(id);
        if (block.timestamp < uint256(p.born) + 3 days) vm.warp(uint256(p.born) + 3 days);
        if (p.day < 3) {
            vm.prank(holder);
            REGISTRY.checkpoint(id, 3, p.state, p.logHash); // the same state, saved as day 3
        }
        assertTrue(REGISTRY.isSettled(id));
        string memory name = "Fork Test Name 7";
        vm.prank(address(0xBAD));
        vm.expectRevert(PetLook.NotPetOwner.selector);
        LOOK.setName(id, name);
        vm.prank(holder);
        LOOK.setName(id, name);
        assertEq(LOOK.nameOf(id), name);
        assertEq(LOOK.nameHolder(keccak256("fork test name 7")), id + 1);
        string memory uri = REGISTRY.tokenURI(id);
        string memory json = string(LookText.decode64(string(bytes(uri).after_("data:application/json;base64,"))));
        assertEq(vm.parseJsonString(json, ".name"), name);
    }

    function _mood(uint256 line, uint256 stage, bool sparkly) internal pure returns (uint256) {
        uint256 joy = sparkly ? 800 : 300;
        return (uint256(500) << 64) | (joy << 74) | (uint256(500) << 84) | (stage << 148) | (line << 152);
    }

    function _expectedRects(uint256 state) internal view returns (uint256 n) {
        (uint256 line, uint256 stage, uint256 face, bool lit) = LOOK.lookOf(state);
        uint256 slot = stage == 0 ? 0 : 10 * (line + 1) + stage;
        n = 1 + LOOK.layer(stage == 0 ? 0 : 100 + slot).length / 4;
        if (stage == 0) return n;
        if (lit) n += LOOK.layer(200 + slot).length / 4;
        bytes memory at = LOOK.faceAt(slot);
        uint256 fx = uint8(at[2 * face]);
        uint256 fy = uint8(at[2 * face + 1]);
        bytes memory runs = LOOK.layer((LOOK.largeFace(slot) ? 1016 : 1000) + face);
        for (uint256 j; j < runs.length; j += 4) {
            if (uint8(runs[j]) + fx < 48 && uint8(runs[j + 1]) + fy < 48) n++;
        }
    }
}
