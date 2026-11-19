// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {PetLook} from "../src/PetLook.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {PetLookBase, LookText} from "./PetLook.t.sol";

/* ── choosing the look, drawing it, and the metadata ──────────────────── */

contract PetLookPictureTest is PetLookBase {
    using LookText for bytes;

    /* ── lookOf ────────────────────────────────────────────────────────── */

    function test_lookOfReadsLineAndStage() public view {
        for (uint256 line; line < 3; ++line) {
            for (uint256 stage; stage <= 4; ++stage) {
                (uint256 l, uint256 s,,) = look.lookOf(_moodState(line, stage, 0));
                assertEq(l, line);
                assertEq(s, stage);
            }
        }
    }

    function test_lookOfSendsTheUnusedLineThreeToGentle() public view {
        (uint256 line,,,) = look.lookOf(_moodState(3, 2, 0));
        assertEq(line, 0);
    }

    function test_lookOfDressesEldersAndUnusedStagesAsAdults() public view {
        for (uint256 stage = 5; stage <= 7; ++stage) {
            (, uint256 s,,) = look.lookOf(_moodState(1, stage, 0));
            assertEq(s, 4);
        }
    }

    /// Asleep beats ill beats hungry beats tired; then joy picks sparkly (lit), happy, sulk or neutral.
    function test_lookOfMoodPrecedence() public view {
        uint256 all = _state(0, 2, 100, 800, 100) | ASLEEP | ILL;
        _expectFace(all, 14, false);
        _expectFace(all & ~ASLEEP, 12, false);
        _expectFace(all & ~ASLEEP & ~ILL, 13, false);
        _expectFace(_state(0, 2, 500, 800, 100), 4, false);
        _expectFace(_state(0, 2, 500, 800, 500), 2, true);
        _expectFace(_state(0, 2, 500, 600, 500), 1, false);
        _expectFace(_state(0, 2, 500, 100, 500), 3, false);
        _expectFace(_state(0, 2, 500, 300, 500), 0, false);
    }

    function test_lookOfMoodThresholds() public view {
        _expectFace(_state(0, 1, 199, 300, 500), 13, false);
        _expectFace(_state(0, 1, 200, 300, 500), 0, false);
        _expectFace(_state(0, 1, 500, 300, 199), 4, false);
        _expectFace(_state(0, 1, 500, 300, 200), 0, false);
        _expectFace(_state(0, 1, 500, 749, 500), 1, false);
        _expectFace(_state(0, 1, 500, 750, 500), 2, true);
        _expectFace(_state(0, 1, 500, 499, 500), 0, false);
        _expectFace(_state(0, 1, 500, 500, 500), 1, false);
        _expectFace(_state(0, 1, 500, 199, 500), 3, false);
        _expectFace(_state(0, 1, 500, 200, 500), 0, false);
        _expectFace(_state(0, 1, 500, 1023, 500), 2, true); // meters are 10 bits; values above 1000 still count
    }

    function _expectFace(uint256 state, uint256 face, bool lit) internal view {
        (,, uint256 f, bool l) = look.lookOf(state);
        assertEq(f, face);
        assertEq(l, lit);
    }

    /// Any state word: lookOf equals a model written from the state layout in packages/game/src/pack.ts.
    function testFuzz_lookOfMatchesTheStateLayout(uint256 state) public view {
        uint256 line = (state / 2 ** 152) % 4;
        if (line == 3) line = 0;
        uint256 stage = (state / 2 ** 148) % 8;
        if (stage >= 5) stage = 4;
        uint256 food = (state / 2 ** 64) % 1024;
        uint256 joy = (state / 2 ** 74) % 1024;
        uint256 energy = (state / 2 ** 84) % 1024;
        uint256 face;
        if ((state / 2 ** 151) % 2 == 1) face = 14;
        else if ((state / 2 ** 219) % 2 == 1) face = 12;
        else if (food < 200) face = 13;
        else if (energy < 200) face = 4;
        else if (joy >= 750) face = 2;
        else if (joy >= 500) face = 1;
        else if (joy < 200) face = 3;
        (uint256 l, uint256 s, uint256 f, bool lit) = look.lookOf(state);
        assertEq(l, line);
        assertEq(s, stage);
        assertEq(f, face);
        assertEq(lit, face == 2);
    }

    /// Flipping any bit outside food, joy, energy, stage, asleep, line and sick never changes the look.
    function testFuzz_lookOfIgnoresEveryOtherBit(uint256 state, uint8 bit) public view {
        uint256 b = bit;
        vm.assume(!(b >= 64 && b < 94) && !(b >= 148 && b < 154) && b != 219);
        (uint256 l1, uint256 s1, uint256 f1, bool lit1) = look.lookOf(state);
        (uint256 l2, uint256 s2, uint256 f2, bool lit2) = look.lookOf(state ^ (uint256(1) << b));
        assertEq(l1, l2);
        assertEq(s1, s2);
        assertEq(f1, f2);
        assertEq(lit1, lit2);
    }

    /* ── svgOf ─────────────────────────────────────────────────────────── */

    function test_svgOfWithNoArtIsAnEmptyCanvas() public view {
        assertEq(
            look.svgOf(_moodState(1, 3, 2)),
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" shape-rendering="crispEdges"><style></style><rect width="48" height="48" fill="#FFF7E8"/></svg>'
        );
    }

    /// A gentle baby, sparkly: frame, palette 0, body, lit trace, then the face shifted to its position.
    function test_svgOfDrawsAPetExactly() public {
        _setLayer(111, abi.encodePacked(_run(10, 20, 5, 1), _run(3, 9, 12, 11)));
        _setLayer(211, _run(12, 21, 2, 16));
        _setLayer(1002, _run(1, 2, 3, 4));
        vm.startPrank(owner);
        bytes memory at = new bytes(32);
        at[4] = bytes1(uint8(20)); // face 2 sits at (20, 18)
        at[5] = bytes1(uint8(18));
        look.setFaces(11, false, at);
        look.setFrame(11, 7, 14, 34);
        look.setPalette(0, _palette(0x10));
        look.setPalette(3, _palette(0x99)); // the egg's palette must not be used
        vm.stopPrank();
        string memory expected = string.concat(
            SVG_HEAD,
            "7 14 34 34",
            SVG_STYLE,
            _css(_palette(0x10)),
            SVG_GROUND,
            '<rect x="10" y="20" width="5" height="1" class="c1"/><rect x="3" y="9" width="12" height="1" class="c11"/>',
            '<rect x="12" y="21" width="2" height="1" class="c16"/>',
            '<rect x="21" y="20" width="3" height="1" class="c4"/>',
            SVG_END
        );
        assertEq(look.svgOf(_moodState(0, 1, 2)), expected);
        // the same pet, merely happy: no trace, face 1 (not set) draws nothing
        assertEq(
            look.svgOf(_moodState(0, 1, 1)),
            string.concat(
                SVG_HEAD,
                "7 14 34 34",
                SVG_STYLE,
                _css(_palette(0x10)),
                SVG_GROUND,
                '<rect x="10" y="20" width="5" height="1" class="c1"/><rect x="3" y="9" width="12" height="1" class="c11"/>',
                SVG_END
            )
        );
    }

    /// One literal pin of the colour CSS, independent of the _css helper.
    function test_svgOfWritesTheLivePaletteFormatLiterally() public {
        bytes memory pal = hex"ff7a59ff2b214033";
        for (uint256 r = 3; r <= 16; ++r) pal = abi.encodePacked(pal, hex"0a0b0cff");
        vm.prank(owner);
        look.setPalette(0, pal);
        bytes memory svg = bytes(look.svgOf(_moodState(0, 1, 0)));
        assertTrue(svg.contains("<style>.c1{fill:#FF7A59}.c2{fill:#2B2140;fill-opacity:.20}.c3{fill:#0A0B0C}"));
        assertTrue(svg.contains(".c16{fill:#0A0B0C}</style>"));
    }

    /// The egg: shared egg layer, the line's egg palette (3 + line), frame of slot 0, never a face or trace.
    function test_svgOfDrawsTheEggWithItsLinesPaletteAndNoFaceOrTrace() public {
        _installCompleteArt();
        _setLayer(0, _run(15, 25, 5, 2));
        _setLayer(200, _run(1, 1, 1, 1)); // "200 + slot 0" would be a lit egg: never drawn
        vm.startPrank(owner);
        look.setFrame(0, 7, 14, 34);
        look.setPalette(3, _palette(0x30));
        look.setPalette(4, _palette(0x40));
        look.setPalette(5, _palette(0x50));
        vm.stopPrank();
        for (uint256 line; line < 3; ++line) {
            string memory expected = string.concat(
                SVG_HEAD, "7 14 34 34", SVG_STYLE, _css(_palette(uint8(0x30 + 0x10 * line))), SVG_GROUND, _rect(15, 25, 5, 2), SVG_END
            );
            assertEq(look.svgOf(_moodState(line, 0, 2)), expected);
            assertEq(look.svgOf(_moodState(line, 0, 14)), expected);
        }
    }

    /// Each of the eight moods draws its own face: small set at 1000 + face, large set at 1016 + face.
    function test_svgOfEachMoodDrawsItsOwnFaceFromTheRightSet() public {
        uint256[8] memory faces = [uint256(0), 1, 2, 3, 4, 12, 13, 14];
        for (uint256 i; i < 16; ++i) {
            _setLayer(1000 + i, _run(i, 40, 1, 3));
            _setLayer(1016 + i, _run(i, 41, 1, 5));
        }
        vm.startPrank(owner);
        look.setFaces(21, false, _facesAt(0, 0));
        look.setFaces(22, true, _facesAt(0, 0));
        vm.stopPrank();
        for (uint256 k; k < faces.length; ++k) {
            bytes memory small = bytes(look.svgOf(_moodState(1, 1, faces[k])));
            assertTrue(small.contains(bytes(_rect(faces[k], 40, 1, 3))));
            assertEq(small.count('y="40"'), 1);
            assertEq(small.count('y="41"'), 0);
            bytes memory large = bytes(look.svgOf(_moodState(1, 2, faces[k])));
            assertTrue(large.contains(bytes(_rect(faces[k], 41, 1, 5))));
            assertEq(large.count('y="41"'), 1);
            assertEq(large.count('y="40"'), 0);
        }
    }

    /// Face i is placed at the i-th (x, y) pair of its slot's positions.
    function test_svgOfPlacesEachFaceAtItsOwnPositionPair() public {
        bytes memory at = new bytes(32);
        for (uint256 i; i < 16; ++i) {
            at[2 * i] = bytes1(uint8(i + 1));
            at[2 * i + 1] = bytes1(uint8(30 + i));
            _setLayer(1000 + i, _run(0, 0, 1, 7));
        }
        vm.prank(owner);
        look.setFaces(33, false, at);
        uint256[8] memory faces = [uint256(0), 1, 2, 3, 4, 12, 13, 14];
        for (uint256 k; k < faces.length; ++k) {
            bytes memory svg = bytes(look.svgOf(_moodState(2, 3, faces[k])));
            assertTrue(svg.contains(bytes(_rect(faces[k] + 1, 30 + faces[k], 1, 7))));
        }
    }

    function test_svgOfWithoutFacePositionsDrawsFacesWhereTheirRunsSay() public {
        _setLayer(1000, _run(9, 8, 2, 4));
        bytes memory svg = bytes(look.svgOf(_moodState(0, 4, 0)));
        assertTrue(svg.contains(bytes(_rect(9, 8, 2, 4))));
    }

    /// Runs pushed past the canvas by the face position are dropped; a run that starts inside keeps its full width
    /// (it reaches past the 48-pixel edge and the frame's viewBox crops it).
    function test_svgOfDropsRunsTheFacePositionPushesOffTheCanvas() public {
        _setLayer(1000, abi.encodePacked(_run(8, 0, 3, 2), _run(0, 8, 2, 2), _run(7, 7, 5, 2)));
        vm.prank(owner);
        look.setFaces(12, false, _facesAt(40, 40));
        bytes memory svg = bytes(look.svgOf(_moodState(0, 2, 0)));
        assertEq(svg.count("<rect x="), 1);
        assertTrue(svg.contains(bytes(_rect(47, 47, 5, 2))));
    }

    function test_svgOfWithoutAFrameShowsTheWholeCanvas() public {
        vm.prank(owner);
        look.setFrame(0, 7, 14, 34); // another slot's frame is not borrowed
        assertTrue(bytes(look.svgOf(_moodState(0, 4, 0))).contains('viewBox="0 0 48 48"'));
        assertTrue(bytes(look.svgOf(_moodState(0, 0, 0))).contains('viewBox="7 14 34 34"'));
    }

    function test_svgOfDrawsEldersWithTheAdultArtAndLineThreeAsGentle() public {
        _setLayer(114, _run(1, 1, 1, 1));
        _setLayer(124, _run(2, 2, 2, 2));
        string memory adultGentle = look.svgOf(_moodState(0, 4, 0));
        assertEq(look.svgOf(_moodState(0, 5, 0)), adultGentle);
        assertEq(look.svgOf(_moodState(0, 7, 0)), adultGentle);
        assertEq(look.svgOf(_moodState(3, 4, 0)), adultGentle);
        assertTrue(bytes(look.svgOf(_moodState(1, 5, 0))).contains(bytes(_rect(2, 2, 2, 2))));
    }

    function test_svgOfWritesOpacityAsARoundedTwoDigitFraction() public {
        uint8[6] memory alphas = [255, 0, 1, 51, 128, 253];
        string[6] memory want = ["{fill:#0A0B0C}", "{fill:#0A0B0C;fill-opacity:.00}", "{fill:#0A0B0C;fill-opacity:.00}", "{fill:#0A0B0C;fill-opacity:.20}", "{fill:#0A0B0C;fill-opacity:.50}", "{fill:#0A0B0C;fill-opacity:.99}"];
        for (uint256 i; i < alphas.length; ++i) {
            bytes memory pal;
            for (uint256 r; r < 16; ++r) pal = abi.encodePacked(pal, hex"0a0b0c", alphas[i]);
            vm.prank(owner);
            look.setPalette(1, pal);
            bytes memory svg = bytes(look.svgOf(_moodState(1, 1, 0)));
            assertEq(svg.count(bytes(want[i])), 16, want[i]);
        }
    }

    /// DEFECT. An alpha of 254 rounds to 100%, and _style writes its two "digits" as 48 + 10 (':') and '0':
    /// ";fill-opacity:.:0" is not a CSS number, so viewers drop the declaration. setPalette accepts alpha 254 and
    /// freezeArt would make it permanent. (No live palette uses 254 today; see the fork test.)
    function test_defect_alpha254WritesAMalformedFillOpacity() public {
        bytes memory pal;
        for (uint256 r; r < 16; ++r) pal = abi.encodePacked(pal, hex"0a0b0cfe");
        vm.prank(owner);
        look.setPalette(2, pal);
        bytes memory svg = bytes(look.svgOf(_moodState(2, 1, 0)));
        assertEq(svg.count("{fill:#0A0B0C;fill-opacity:.:0}"), 16);
    }

    /// Every alpha from 0 to 253 writes a well-formed ".PP" equal to round(alpha / 255 * 100).
    function testFuzz_svgOfWritesEveryOtherAlphaCorrectly(uint8 alpha) public {
        alpha = uint8(bound(alpha, 0, 253));
        bytes memory pal;
        for (uint256 r; r < 16; ++r) pal = abi.encodePacked(pal, hex"0a0b0c", alpha);
        vm.prank(owner);
        look.setPalette(0, pal);
        bytes memory svg = bytes(look.svgOf(_moodState(0, 1, 0)));
        assertTrue(svg.contains(bytes(string.concat("<style>", _css(pal), "</style>"))));
    }

    /* ── tokenURI ──────────────────────────────────────────────────────── */

    string constant DESCRIPTION =
        "A Lingxi pet. Its mind is a TapeOut circuit on X Layer, and this picture is drawn on chain from its saved state.";

    function _json(uint256 id) internal view returns (string memory json) {
        bytes memory uri = bytes(look.tokenURI(id));
        json = string(LookText.decode64(string(uri.after_("data:application/json;base64,"))));
    }

    function _image(string memory json) internal pure returns (string memory) {
        bytes memory img = bytes(vm.parseJsonString(json, ".image"));
        return string(LookText.decode64(string(img.after_("data:image/svg+xml;base64,"))));
    }

    function test_tokenURIIsBase64JsonWithThePictureAndEveryFact() public {
        _installCompleteArt();
        vm.prank(owner);
        reg.setStarterBrain(proc, 77, true);
        uint256 state = _moodState(2, 3, 2) | (uint256(7) << 220) | (uint256(200) << 226) | (uint256(5) << 234);
        uint256 id = reg.hatch(alice, 2, proc, 77, 0);
        vm.warp(block.timestamp + 4 days);
        vm.prank(alice);
        reg.checkpoint(id, 4, state, bytes32(0));

        string memory json = _json(id);
        assertEq(
            json,
            string.concat(
                '{"name":"Lingxi #',
                Strings.toString(id),
                '","description":"',
                DESCRIPTION,
                '","image":"data:image/svg+xml;base64,',
                Base64.encode(bytes(look.svgOf(state))),
                '","attributes":[{"trait_type":"stage","value":"teen"},{"trait_type":"days saved","value":4},',
                '{"trait_type":"care mistakes","value":7},{"trait_type":"kinship","value":200},',
                '{"trait_type":"generation","value":0},{"trait_type":"brain circuit","value":77}]}'
            )
        );
        // and as a JSON reader sees it
        assertEq(vm.parseJsonString(json, ".name"), string.concat("Lingxi #", Strings.toString(id)));
        assertEq(vm.parseJsonString(json, ".description"), DESCRIPTION);
        assertEq(_image(json), look.svgOf(state));
        assertEq(vm.parseJsonString(json, ".attributes[0].value"), "teen");
        assertEq(vm.parseJsonUint(json, ".attributes[1].value"), 4);
        assertEq(vm.parseJsonUint(json, ".attributes[2].value"), 7);
        assertEq(vm.parseJsonUint(json, ".attributes[3].value"), 200);
        assertEq(vm.parseJsonUint(json, ".attributes[4].value"), 0);
        assertEq(vm.parseJsonUint(json, ".attributes[5].value"), 77);
        assertEq(vm.parseJsonString(json, ".attributes[5].trait_type"), "brain circuit");
    }

    function test_tokenURIUsesThePetsNameOnceItHasOne() public {
        uint256 id = _settled(alice);
        vm.prank(alice);
        look.setName(id, unicode"O'Neil 小灵");
        assertEq(vm.parseJsonString(_json(id), ".name"), string(hex"4f274e65696c20e5b08fe781b5"));
        vm.prank(alice);
        look.setName(id, "");
        assertEq(vm.parseJsonString(_json(id), ".name"), string.concat("Lingxi #", Strings.toString(id)));
    }

    function test_tokenURINamesEveryStageValue() public {
        string[8] memory names = ["egg", "baby", "child", "teen", "adult", "elder", "adult", "adult"];
        uint256 id = _hatch(alice, 0);
        for (uint256 s; s < 8; ++s) {
            vm.warp(block.timestamp + 1 days);
            vm.prank(alice);
            reg.checkpoint(id, uint32(s + 2), _moodState(0, s, 0), bytes32(0));
            assertEq(vm.parseJsonString(_json(id), ".attributes[0].value"), names[s]);
        }
    }

    function test_tokenURIReadsTheMaximumMistakesAndKinshipWithoutNeighbouringBits() public {
        uint256 state = (uint256(63) << 220) | (uint256(255) << 226) | (uint256(1) << 219) | (uint256(0x7f) << 234) | (uint256(1) << 255);
        uint256 id = _settledWith(alice, state);
        string memory json = _json(id);
        assertEq(vm.parseJsonUint(json, ".attributes[2].value"), 63);
        assertEq(vm.parseJsonUint(json, ".attributes[3].value"), 255);
    }

    /// "generation" is a bred-or-hatched flag: a grandchild still reads 1, as in the registry's own fallback.
    function test_tokenURIGenerationIsOneForEveryBredPetEvenAGrandchild() public {
        uint256 a = _hatch(alice, 0);
        uint256 b = _hatch(bob, 0);
        uint256 child = reg.hatchChild(alice, 0, proc, uint64(BRAIN), 0, uint128(a), uint128(b));
        uint256 grandchild = reg.hatchChild(alice, 0, proc, uint64(BRAIN), 0, uint128(child), uint128(a));
        assertEq(vm.parseJsonUint(_json(a), ".attributes[4].value"), 0);
        assertEq(vm.parseJsonUint(_json(child), ".attributes[4].value"), 1);
        assertEq(vm.parseJsonUint(_json(grandchild), ".attributes[4].value"), 1);
    }

    /// The picture's line comes from the state word (bits 152-153), not from the line the registry recorded at
    /// hatching: a pet hatched as curious (2) whose saved state says gentle (0) is drawn with gentle art.
    function test_tokenURIDrawsTheLineFromTheSavedStateNotTheRegistryRecord() public {
        _setLayer(111, _run(1, 1, 1, 1));
        _setLayer(131, _run(3, 3, 3, 3));
        uint256 id = reg.hatch(alice, 2, proc, uint64(BRAIN), _moodState(0, 1, 0));
        assertEq(reg.pet(id).line, 2);
        string memory svg = _image(_json(id));
        assertTrue(bytes(svg).contains(bytes(_rect(1, 1, 1, 1))));
        assertFalse(bytes(svg).contains(bytes(_rect(3, 3, 3, 3))));
    }

    function test_theRegistryServesThisRenderersMetadata() public {
        _installCompleteArt();
        uint256 id = _settledWith(alice, _moodState(1, 2, 1));
        assertEq(reg.tokenURI(id), look.tokenURI(id));
    }

    function test_tokenURIOfAnUnknownPetReverts() public {
        vm.expectRevert(PetRegistry.UnknownPet.selector);
        look.tokenURI(999);
    }

    /// Whatever name validName lets through, the metadata stays valid JSON and reads back as that exact name.
    function testFuzz_tokenURIIsValidJsonForEveryAcceptedName(uint24 c1, uint24 c2, uint24 c3, uint24 c4) public {
        bytes memory name = abi.encodePacked(
            LookText.utf8(bound(c1, 0x20, 0x10ffff)),
            LookText.utf8(bound(c2, 0, 0x10ffff)),
            LookText.utf8(bound(c3, 0, 0x7f)),
            LookText.utf8(bound(c4, 0x20, 0x10ffff))
        );
        if (!look.validName(name)) return;
        uint256 id = _settled(alice);
        vm.prank(alice);
        look.setName(id, string(name));
        assertEq(vm.parseJsonString(_json(id), ".name"), string(name));
    }
}

/* ── the largest art the contract accepts ─────────────────────────────── */

/// Every layer at the 1600-byte limit with all two-digit numbers, translucent palettes and two-digit frames:
/// the longest SVG PetLook can be asked to write.
contract PetLookWorstCaseTest is PetLookBase {
    using LookText for bytes;

    function _bigLayer(uint256 salt) internal pure returns (bytes memory d) {
        d = new bytes(1600);
        for (uint256 k; k < 400; ++k) {
            uint256 h = uint256(keccak256(abi.encode(salt, k)));
            d[4 * k] = bytes1(uint8(10 + h % 20)); // x 10..29
            d[4 * k + 1] = bytes1(uint8(10 + (h >> 8) % 38)); // y 10..47
            d[4 * k + 2] = bytes1(uint8(10 + (h >> 16) % 9)); // width 10..18, so x + width <= 47
            d[4 * k + 3] = bytes1(uint8(10 + (h >> 24) % 7)); // role 10..16
        }
    }

    function setUp() public override {
        super.setUp();
        uint256[] memory keys = new uint256[](1);
        bytes[] memory data = new bytes[](1);
        vm.startPrank(owner);
        for (uint256 i; i < 57; ++i) {
            // 0, 100 + slot (12), 200 + slot (12), 1000..1031
            if (i == 0) keys[0] = 0;
            else if (i <= 12) keys[0] = 100 + 10 * ((i - 1) / 4 + 1) + ((i - 1) % 4) + 1;
            else if (i <= 24) keys[0] = 200 + 10 * ((i - 13) / 4 + 1) + ((i - 13) % 4) + 1;
            else keys[0] = 1000 + (i - 25);
            data[0] = _bigLayer(i);
            look.setLayers(keys, data);
        }
        for (uint256 id; id < 6; ++id) {
            bytes memory pal;
            for (uint256 r; r < 16; ++r) pal = abi.encodePacked(pal, uint8(r * 16), uint8(id), uint8(255 - r), uint8(1 + r * 13)); // never 254 or 255
            look.setPalette(id, pal);
        }
        for (uint256 i; i < 12; ++i) {
            uint256 slot = 10 * (i / 4 + 1) + (i % 4) + 1;
            bytes memory at = new bytes(32);
            for (uint256 j; j < 32; ++j) at[j] = bytes1(uint8((i + j) % 10)); // two-digit runs stay mostly on the canvas
            look.setFaces(slot, i % 2 == 0, at);
            look.setFrame(slot, 10, 10, 38);
        }
        look.setFrame(0, 10, 10, 38);
        look.freezeArt();
        vm.stopPrank();
    }

    function _expectedRects(uint256 state) internal view returns (uint256 n) {
        (uint256 line, uint256 stage, uint256 face, bool lit) = look.lookOf(state);
        n = 1 + 400; // the ground and the body
        if (stage == 0) return n;
        uint256 slot = 10 * (line + 1) + stage;
        if (lit) n += 400;
        bytes memory at = look.faceAt(slot);
        uint256 fx = uint8(at[2 * face]);
        uint256 fy = uint8(at[2 * face + 1]);
        bytes memory runs = look.layer((look.largeFace(slot) ? 1016 : 1000) + face);
        for (uint256 j; j < runs.length; j += 4) {
            if (uint8(runs[j]) + fx < 48 && uint8(runs[j + 1]) + fy < 48) n++;
        }
    }

    /// Any state: the writer's buffer is never overrun, and every run on the canvas becomes exactly one rect.
    function testFuzz_svgOfNeverOverrunsAndDrawsEveryRunOnTheCanvas(uint256 state) public view {
        bytes memory svg = bytes(look.svgOf(state));
        assertTrue(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 38 38"'));
        assertTrue(svg.endsWith("</svg>"));
        assertEq(svg.count("<rect "), _expectedRects(state));
        assertEq(svg.count(";fill-opacity:."), 16);
    }

    /// The heaviest picture there is (lit trace and the largest faces) decodes back exactly and fits an eth_call.
    function test_theHeaviestMetadataDecodesAndItsGasIsMeasured() public {
        uint256 state = _moodState(0, 1, 2); // slot 11 has the large face set; sparkly lights the trace
        uint256 id = _settledWith(alice, state);
        vm.prank(alice);
        look.setName(id, "123456789012345678901234");
        uint256 g = gasleft();
        string memory uri = look.tokenURI(id);
        uint256 used = g - gasleft();
        emit log_named_uint("gas for the largest tokenURI PetLook can serve", used);
        emit log_named_uint("its length in bytes", bytes(uri).length);
        assertLt(used, 50_000_000); // geth's default eth_call cap (RPCGasCap)
        string memory json = string(LookText.decode64(string(bytes(uri).after_("data:application/json;base64,"))));
        bytes memory img = bytes(vm.parseJsonString(json, ".image"));
        bytes memory svg = LookText.decode64(string(img.after_("data:image/svg+xml;base64,")));
        assertEq(string(svg), look.svgOf(state));
        assertEq(svg.count("<rect "), _expectedRects(state));
        assertEq(vm.parseJsonString(json, ".name"), "123456789012345678901234");
    }
}
