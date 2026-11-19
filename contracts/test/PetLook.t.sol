// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {PetLook} from "../src/PetLook.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {ITapeOutFactory} from "../src/interfaces/ITapeOut.sol";

/// Every processor is a CPU here: PetLook only needs a registry that hatches and keeps pets.
contract MockTapeOutFactory {
    function isCPU(address) external pure returns (bool) {
        return true;
    }
}

/// A 16-in, 8-out brain with 64 LATCH bits, so the registry stores every state word exactly as written.
contract MockBrainProcessor {
    function circuitInfo(uint256) external pure returns (uint256, uint256, uint256, uint256) {
        return (16, 8, 64, 100);
    }
}

/// Small string and base64 helpers for reading what PetLook returns, written independently of the contract.
library LookText {
    function decode64(string memory s) internal pure returns (bytes memory out) {
        bytes memory b = bytes(s);
        require(b.length % 4 == 0, "base64 length");
        uint256 pad;
        if (b.length != 0 && b[b.length - 1] == "=") pad++;
        if (b.length > 1 && b[b.length - 2] == "=") pad++;
        out = new bytes((b.length / 4) * 3 - pad);
        uint256 o;
        for (uint256 i; i < b.length; i += 4) {
            uint256 v = (_sextet(b[i]) << 18) | (_sextet(b[i + 1]) << 12) | (_sextet(b[i + 2]) << 6) | _sextet(b[i + 3]);
            if (o < out.length) out[o++] = bytes1(uint8(v >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(v >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(v));
        }
    }

    function _sextet(bytes1 c) private pure returns (uint256) {
        uint8 x = uint8(c);
        if (x >= 65 && x <= 90) return x - 65;
        if (x >= 97 && x <= 122) return x - 71;
        if (x >= 48 && x <= 57) return x + 4;
        if (x == 43) return 62;
        if (x == 47) return 63;
        if (x == 61) return 0;
        revert("base64 character");
    }

    function startsWith(bytes memory s, bytes memory p) internal pure returns (bool) {
        if (p.length > s.length) return false;
        for (uint256 i; i < p.length; ++i) if (s[i] != p[i]) return false;
        return true;
    }

    function endsWith(bytes memory s, bytes memory p) internal pure returns (bool) {
        if (p.length > s.length) return false;
        uint256 off = s.length - p.length;
        for (uint256 i; i < p.length; ++i) if (s[off + i] != p[i]) return false;
        return true;
    }

    /// The text after a required prefix.
    function after_(bytes memory s, bytes memory p) internal pure returns (bytes memory r) {
        require(startsWith(s, p), "missing prefix");
        r = new bytes(s.length - p.length);
        for (uint256 i; i < r.length; ++i) r[i] = s[p.length + i];
    }

    function count(bytes memory s, bytes memory needle) internal pure returns (uint256 n) {
        if (needle.length == 0 || needle.length > s.length) return 0;
        for (uint256 i; i + needle.length <= s.length; ++i) {
            bool hit = true;
            for (uint256 k; k < needle.length; ++k) {
                if (s[i + k] != needle[k]) {
                    hit = false;
                    break;
                }
            }
            if (hit) n++;
        }
    }

    function contains(bytes memory s, bytes memory needle) internal pure returns (bool) {
        return count(s, needle) != 0;
    }

    function hex2(uint8 b) internal pure returns (string memory) {
        bytes memory d = "0123456789ABCDEF";
        return string(abi.encodePacked(d[b >> 4], d[b & 15]));
    }

    /// UTF-8 encoding of one code point (surrogates encode as the ill-formed ED A0..BF form).
    function utf8(uint256 cp) internal pure returns (bytes memory) {
        if (cp < 0x80) return abi.encodePacked(uint8(cp));
        if (cp < 0x800) return abi.encodePacked(uint8(0xC0 | (cp >> 6)), uint8(0x80 | (cp & 0x3F)));
        if (cp < 0x10000) {
            return abi.encodePacked(uint8(0xE0 | (cp >> 12)), uint8(0x80 | ((cp >> 6) & 0x3F)), uint8(0x80 | (cp & 0x3F)));
        }
        return abi.encodePacked(
            uint8(0xF0 | (cp >> 18)), uint8(0x80 | ((cp >> 12) & 0x3F)), uint8(0x80 | ((cp >> 6) & 0x3F)), uint8(0x80 | (cp & 0x3F))
        );
    }

    /// keccak of the name with ASCII A-Z folded to a-z: the key PetLook's nameHolder is indexed by.
    function lowerKey(bytes memory b) internal pure returns (bytes32) {
        bytes memory low = new bytes(b.length);
        for (uint256 i; i < b.length; ++i) {
            uint8 c = uint8(b[i]);
            low[i] = bytes1(c >= 65 && c <= 90 ? c + 32 : c);
        }
        return keccak256(low);
    }
}

/// A real PetRegistry on a mock TapeOut, with PetLook as its renderer; helpers to hatch, settle and install art.
abstract contract PetLookBase is Test {
    PetRegistry reg;
    PetLook look;
    address proc;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 constant ASLEEP = 1 << 151;
    uint256 constant ILL = 1 << 219;
    uint256 constant BRAIN = 1;

    function setUp() public virtual {
        reg = new PetRegistry(ITapeOutFactory(address(new MockTapeOutFactory())), owner);
        proc = address(new MockBrainProcessor());
        look = new PetLook(reg, owner);
        vm.startPrank(owner);
        reg.setStarterBrain(proc, BRAIN, true);
        reg.setRenderer(look);
        reg.setBreeder(address(this), true);
        vm.stopPrank();
    }

    /* ── pets ──────────────────────────────────────────────────────────── */

    function _hatch(address to, uint256 state) internal returns (uint256) {
        return reg.hatch(to, 0, proc, uint64(BRAIN), state);
    }

    /// Hatched, three days old, third day saved: what the names gate accepts.
    function _settled(address to) internal returns (uint256 id) {
        id = _hatch(to, 0);
        vm.warp(block.timestamp + 3 days);
        vm.prank(to);
        reg.checkpoint(id, 3, 0, bytes32(0));
        assertTrue(reg.isSettled(id));
    }

    function _settledWith(address to, uint256 state) internal returns (uint256 id) {
        id = _hatch(to, 0);
        vm.warp(block.timestamp + 3 days);
        vm.prank(to);
        reg.checkpoint(id, 3, state, bytes32(0));
    }

    function _state(uint256 line, uint256 stage, uint256 food, uint256 joy, uint256 energy) internal pure returns (uint256) {
        return (food << 64) | (joy << 74) | (energy << 84) | (stage << 148) | (line << 152);
    }

    /// meters that give each face: neutral 0, happy 1, sparkly 2 (trace lit), sulk 3, sleepy 4, dizzy 12, sad 13, asleep 14
    function _moodState(uint256 line, uint256 stage, uint256 face) internal pure returns (uint256) {
        if (face == 0) return _state(line, stage, 500, 300, 500);
        if (face == 1) return _state(line, stage, 500, 600, 500);
        if (face == 2) return _state(line, stage, 500, 800, 500);
        if (face == 3) return _state(line, stage, 500, 100, 500);
        if (face == 4) return _state(line, stage, 500, 300, 100);
        if (face == 12) return _state(line, stage, 500, 300, 500) | ILL;
        if (face == 13) return _state(line, stage, 100, 300, 500);
        if (face == 14) return _state(line, stage, 500, 300, 500) | ASLEEP;
        revert("no state gives that face");
    }

    /* ── art ───────────────────────────────────────────────────────────── */

    function _run(uint256 x, uint256 y, uint256 len, uint256 role) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(x), uint8(y), uint8(len), uint8(role));
    }

    function _setLayer(uint256 key, bytes memory data) internal {
        uint256[] memory k = new uint256[](1);
        bytes[] memory d = new bytes[](1);
        k[0] = key;
        d[0] = data;
        vm.prank(owner);
        look.setLayers(k, d);
    }

    /// 16 colours: role r is (tag, r, 0xAB) and opaque, except role 16 at alpha 0x33 (as the live palettes do).
    function _palette(uint8 tag) internal pure returns (bytes memory p) {
        for (uint256 r = 1; r <= 16; ++r) p = abi.encodePacked(p, tag, uint8(r), uint8(0xAB), uint8(r == 16 ? 0x33 : 0xFF));
    }

    function _facesAt(uint8 x, uint8 y) internal pure returns (bytes memory at) {
        for (uint256 i; i < 16; ++i) at = abi.encodePacked(at, x, y);
    }

    function _slot(uint256 line, uint256 stage) internal pure returns (uint256) {
        return stage == 0 ? 0 : 10 * (line + 1) + stage;
    }

    /// Every piece freezeArt asks for, except the one numbered `skip` (type(uint256).max skips nothing):
    /// 0 the egg, 1..6 palettes 0..5, 7..18 bodies, 19..30 face positions, 31..62 faces.
    function _installArtExcept(uint256 skip) internal {
        uint256 n;
        uint256[] memory keys = new uint256[](45);
        bytes[] memory data = new bytes[](45);
        if (skip != 0) {
            keys[n] = 0;
            data[n] = _run(20, 30, 8, 1);
            n++;
        }
        for (uint256 i; i < 12; ++i) {
            if (skip == 7 + i) continue;
            keys[n] = 100 + 10 * (i / 4 + 1) + (i % 4) + 1;
            data[n] = _run(i, 40, 2, 2);
            n++;
        }
        for (uint256 f; f < 32; ++f) {
            if (skip == 31 + f) continue;
            keys[n] = 1000 + f;
            data[n] = _run(f, 1, 1, 3);
            n++;
        }
        assembly {
            mstore(keys, n)
            mstore(data, n)
        }
        vm.startPrank(owner);
        look.setLayers(keys, data);
        for (uint256 id; id < 6; ++id) {
            if (skip != 1 + id) look.setPalette(id, _palette(uint8(id)));
        }
        for (uint256 i; i < 12; ++i) {
            uint256 slot = 10 * (i / 4 + 1) + (i % 4) + 1;
            if (skip != 19 + i) look.setFaces(slot, i % 2 == 1, _facesAt(0, 0));
        }
        vm.stopPrank();
    }

    function _installCompleteArt() internal {
        _installArtExcept(type(uint256).max);
    }

    /// The <style> PetLook should write for a palette: ".cR{fill:#RRGGBB[;fill-opacity:.PP]}" for roles 1..16,
    /// with the alpha as a rounded two-digit percentage (alpha 254 has no two-digit form; see the defect test).
    function _css(bytes memory pal) internal pure returns (string memory s) {
        for (uint256 r = 1; r <= 16; ++r) {
            uint256 o = (r - 1) * 4;
            s = string.concat(
                s, ".c", Strings.toString(r), "{fill:#", LookText.hex2(uint8(pal[o])), LookText.hex2(uint8(pal[o + 1])), LookText.hex2(uint8(pal[o + 2]))
            );
            uint256 a = uint8(pal[o + 3]);
            if (a != 255) {
                require(a != 254, "alpha 254 has no two-digit opacity");
                uint256 pct = (a * 200 + 255) / 510; // round half up of a / 255 in percent
                s = string.concat(s, ";fill-opacity:.", pct < 10 ? "0" : "", Strings.toString(pct));
            }
            s = string.concat(s, "}");
        }
    }

    function _rect(uint256 x, uint256 y, uint256 w, uint256 role) internal pure returns (string memory) {
        return string.concat(
            '<rect x="', Strings.toString(x), '" y="', Strings.toString(y), '" width="', Strings.toString(w), '" height="1" class="c', Strings.toString(role), '"/>'
        );
    }

    string constant SVG_HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="';
    string constant SVG_STYLE = '" shape-rendering="crispEdges"><style>';
    string constant SVG_GROUND = '</style><rect width="48" height="48" fill="#FFF7E8"/>';
    string constant SVG_END = "</svg>";
}

/* ── the art: who may change it, what it accepts, and freezing ─────────── */

contract PetLookArtTest is PetLookBase {
    function test_constructorWiresRegistryAndOwnerAndStartsOpen() public view {
        assertEq(address(look.registry()), address(reg));
        assertEq(look.owner(), owner);
        assertEq(look.pendingOwner(), address(0));
        assertFalse(look.artFrozen());
        assertEq(look.MAX_NAME_BYTES(), 24);
        assertEq(look.MAX_LAYER_BYTES(), 1600);
    }

    function test_constructorRefusesTheZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new PetLook(reg, address(0));
    }

    function test_setLayersStoresEachLayerAndEmitsItsRunCount() public {
        uint256[] memory keys = new uint256[](2);
        bytes[] memory data = new bytes[](2);
        (keys[0], data[0]) = (111, abi.encodePacked(_run(1, 2, 3, 4), _run(5, 6, 7, 8)));
        (keys[1], data[1]) = (1015, _run(0, 47, 48, 16));
        vm.expectEmit(true, false, false, true, address(look));
        emit PetLook.LayerSet(111, 2);
        vm.expectEmit(true, false, false, true, address(look));
        emit PetLook.LayerSet(1015, 1);
        vm.prank(owner);
        look.setLayers(keys, data);
        assertEq(look.layer(111), data[0]);
        assertEq(look.layer(1015), data[1]);
    }

    function test_setLayersIsOwnerOnly() public {
        uint256[] memory keys = new uint256[](1);
        bytes[] memory data = new bytes[](1);
        data[0] = _run(1, 1, 1, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        look.setLayers(keys, data);
    }

    function test_setLayersRefusesKeysAndDataOfDifferentLengths() public {
        vm.prank(owner);
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setLayers(new uint256[](2), new bytes[](1));
    }

    function test_setLayersRefusesEveryKindOfBadRun() public {
        bytes[] memory bad = new bytes[](12);
        bad[0] = hex"010203"; // not whole runs
        bad[1] = abi.encodePacked(_run(1, 1, 1, 1), hex"01"); // a trailing partial run
        bad[2] = _run(48, 0, 1, 1); // x off the canvas
        bad[3] = _run(255, 0, 1, 1);
        bad[4] = _run(0, 48, 1, 1); // y off the canvas
        bad[5] = _run(0, 0, 0, 1); // empty run
        bad[6] = _run(47, 0, 2, 1); // past the right edge
        bad[7] = _run(1, 0, 48, 1);
        bad[8] = _run(0, 0, 1, 0); // role 0 is "transparent", never stored
        bad[9] = _run(0, 0, 1, 17); // roles stop at 16
        bad[10] = abi.encodePacked(_run(1, 1, 1, 1), _run(2, 2, 2, 255)); // a bad second run
        bytes memory big; // 401 good runs: one run over the limit
        for (uint256 i; i < 401; ++i) big = abi.encodePacked(big, _run(0, 0, 1, 1));
        bad[11] = big;
        uint256[] memory keys = new uint256[](1);
        bytes[] memory data = new bytes[](1);
        for (uint256 i; i < bad.length; ++i) {
            data[0] = bad[i];
            vm.prank(owner);
            vm.expectRevert(PetLook.BadLayer.selector);
            look.setLayers(keys, data);
        }
    }

    function test_setLayersAcceptsTheEdgesOfTheCanvasAndTheSizeLimit() public {
        bytes memory edges = abi.encodePacked(_run(47, 47, 1, 16), _run(0, 0, 48, 1), _run(0, 47, 48, 16), _run(46, 0, 2, 9));
        _setLayer(7, edges);
        assertEq(look.layer(7), edges);
        bytes memory full;
        for (uint256 i; i < 400; ++i) full = abi.encodePacked(full, _run(i % 48, i % 48, 1, 1 + (i % 16)));
        assertEq(full.length, look.MAX_LAYER_BYTES());
        vm.expectEmit(true, false, false, true, address(look));
        emit PetLook.LayerSet(8, 400);
        _setLayer(8, full);
        assertEq(look.layer(8), full);
    }

    function test_setLayersWithEmptyDataClearsALayer() public {
        _setLayer(111, _run(1, 1, 1, 1));
        vm.expectEmit(true, false, false, true, address(look));
        emit PetLook.LayerSet(111, 0);
        _setLayer(111, "");
        assertEq(look.layer(111).length, 0);
    }

    function test_oneBadLayerRevertsTheWholeBatch() public {
        uint256[] memory keys = new uint256[](2);
        bytes[] memory data = new bytes[](2);
        (keys[0], data[0]) = (5, _run(1, 1, 1, 1));
        (keys[1], data[1]) = (6, _run(1, 1, 1, 0));
        vm.prank(owner);
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setLayers(keys, data);
        assertEq(look.layer(5).length, 0);
    }

    function test_aRepeatedKeyInOneBatchKeepsTheLastData() public {
        uint256[] memory keys = new uint256[](2);
        bytes[] memory data = new bytes[](2);
        (keys[0], data[0]) = (9, _run(1, 1, 1, 1));
        (keys[1], data[1]) = (9, _run(2, 2, 2, 2));
        vm.prank(owner);
        look.setLayers(keys, data);
        assertEq(look.layer(9), data[1]);
    }

    /// One run: accepted exactly when it sits on the canvas, is not empty, ends by the right edge and has role 1..16.
    function testFuzz_setLayersAcceptsARunExactlyWhenItIsOnTheCanvas(uint8 x, uint8 y, uint8 len, uint8 role) public {
        bool ok = x < 48 && y < 48 && len != 0 && uint256(x) + len <= 48 && role >= 1 && role <= 16;
        if (!ok) vm.expectRevert(PetLook.BadLayer.selector);
        _setLayer(3, _run(x, y, len, role));
        if (ok) assertEq(look.layer(3), _run(x, y, len, role));
    }

    /// Many good runs with one byte possibly broken: the layer is refused exactly when the broken run is bad.
    function testFuzz_setLayersJudgesEveryRunOfALongLayer(uint256 seed, uint16 count, uint16 at, uint8 value) public {
        count = uint16(bound(count, 1, 400));
        bytes memory d = new bytes(uint256(count) * 4);
        for (uint256 i; i < count; ++i) {
            uint256 h = uint256(keccak256(abi.encode(seed, i)));
            uint8 x = uint8(h % 48);
            d[i * 4] = bytes1(x);
            d[i * 4 + 1] = bytes1(uint8((h >> 8) % 48));
            d[i * 4 + 2] = bytes1(uint8(1 + (h >> 16) % (48 - x)));
            d[i * 4 + 3] = bytes1(uint8(1 + (h >> 24) % 16));
        }
        uint256 p = bound(at, 0, d.length - 1);
        d[p] = bytes1(value);
        uint256 r = p - (p % 4);
        bool ok = uint8(d[r]) < 48 && uint8(d[r + 1]) < 48 && uint8(d[r + 2]) != 0 && uint256(uint8(d[r])) + uint8(d[r + 2]) <= 48
            && uint8(d[r + 3]) >= 1 && uint8(d[r + 3]) <= 16;
        if (!ok) vm.expectRevert(PetLook.BadLayer.selector);
        _setLayer(4, d);
        if (ok) assertEq(keccak256(look.layer(4)), keccak256(d));
    }

    function test_setFacesStoresTheSixteenPositionsAndTheFaceSize() public {
        bytes memory at = hex"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
        vm.prank(owner);
        look.setFaces(23, true, at);
        assertEq(look.faceAt(23), at);
        assertTrue(look.largeFace(23));
        vm.prank(owner);
        look.setFaces(23, false, at);
        assertFalse(look.largeFace(23));
    }

    function test_setFacesRefusesTheEggBadSlotsAndWrongLengths() public {
        uint256[9] memory badSlots = [uint256(0), 1, 10, 15, 20, 25, 41, 44, 111];
        for (uint256 i; i < badSlots.length; ++i) {
            vm.prank(owner);
            vm.expectRevert(PetLook.BadLayer.selector);
            look.setFaces(badSlots[i], false, _facesAt(0, 0));
        }
        uint256[3] memory badLengths = [uint256(0), 31, 33];
        for (uint256 i; i < badLengths.length; ++i) {
            vm.prank(owner);
            vm.expectRevert(PetLook.BadLayer.selector);
            look.setFaces(11, false, new bytes(badLengths[i]));
        }
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        look.setFaces(11, false, _facesAt(0, 0));
    }

    /// Face positions belong to the twelve pet slots: 11..14, 21..24, 31..34.
    function testFuzz_setFacesAcceptsExactlyThePetSlots(uint256 slot) public {
        slot = bound(slot, 0, 60);
        bool ok = slot / 10 >= 1 && slot / 10 <= 3 && slot % 10 >= 1 && slot % 10 <= 4;
        if (!ok) vm.expectRevert(PetLook.BadLayer.selector);
        vm.prank(owner);
        look.setFaces(slot, false, _facesAt(1, 2));
    }

    function test_setFrameStoresThreePackedBytesAndAcceptsTheEgg() public {
        vm.startPrank(owner);
        look.setFrame(0, 7, 14, 34);
        look.setFrame(34, 0, 0, 48);
        look.setFrame(11, 32, 32, 16);
        vm.stopPrank();
        assertEq(look.frame(0), hex"070e22");
        assertEq(look.frame(34), hex"000030");
        assertEq(look.frame(11), hex"202010");
    }

    function test_setFrameRefusesSmallFramesFramesOffTheCanvasAndBadSlots() public {
        vm.startPrank(owner);
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setFrame(11, 0, 0, 15);
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setFrame(11, 33, 0, 16);
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setFrame(11, 0, 33, 16);
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setFrame(11, 255, 255, 255);
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setFrame(15, 0, 0, 16);
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setFrame(40, 0, 0, 16);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        look.setFrame(11, 0, 0, 16);
    }

    function testFuzz_setFrameAcceptsExactlyASquareOfAtLeast16InsideTheCanvas(uint8 x, uint8 y, uint8 size) public {
        bool ok = size >= 16 && uint256(x) + size <= 48 && uint256(y) + size <= 48;
        if (!ok) vm.expectRevert(PetLook.BadLayer.selector);
        vm.prank(owner);
        look.setFrame(22, x, y, size);
        if (ok) assertEq(look.frame(22), abi.encodePacked(x, y, size));
    }

    function test_setPaletteTakesSixPalettesOfSixteenColours() public {
        vm.startPrank(owner);
        for (uint256 id; id < 6; ++id) {
            look.setPalette(id, _palette(uint8(id)));
            assertEq(look.palette(id), _palette(uint8(id)));
        }
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setPalette(6, _palette(6));
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setPalette(0, new bytes(63));
        vm.expectRevert(PetLook.BadLayer.selector);
        look.setPalette(0, new bytes(65));
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        look.setPalette(0, _palette(0));
    }

    /// Each of the 63 required pieces, missing on its own, keeps the art from freezing.
    function test_freezeArtRefusesWhileAnyRequiredPieceIsMissing() public {
        for (uint256 skip; skip < 63; ++skip) {
            uint256 snap = vm.snapshotState();
            _installArtExcept(skip);
            vm.prank(owner);
            vm.expectRevert(PetLook.ArtIncomplete.selector);
            look.freezeArt();
            vm.revertToState(snap);
        }
    }

    function test_freezeArtRefusesAnEmptyContract() public {
        vm.prank(owner);
        vm.expectRevert(PetLook.ArtIncomplete.selector);
        look.freezeArt();
    }

    function test_freezeArtNeedsNoFramesAndNoLitTraces() public {
        _installCompleteArt();
        vm.expectEmit(false, false, false, true, address(look));
        emit PetLook.ArtFrozen();
        vm.prank(owner);
        look.freezeArt();
        assertTrue(look.artFrozen());
    }

    function test_freezeArtIsOwnerOnly() public {
        _installCompleteArt();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        look.freezeArt();
    }

    function test_frozenArtRefusesEveryArtChangeButNamesKeepWorking() public {
        _installCompleteArt();
        vm.prank(owner);
        look.freezeArt();
        vm.startPrank(owner);
        vm.expectRevert(PetLook.ArtIsFrozen.selector);
        look.setLayers(new uint256[](0), new bytes[](0));
        vm.expectRevert(PetLook.ArtIsFrozen.selector);
        look.setFaces(11, false, _facesAt(0, 0));
        vm.expectRevert(PetLook.ArtIsFrozen.selector);
        look.setFrame(0, 0, 0, 48);
        vm.expectRevert(PetLook.ArtIsFrozen.selector);
        look.setPalette(0, _palette(9));
        vm.stopPrank();
        // a stranger still meets the owner check first
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        look.setPalette(0, _palette(9));
        assertEq(look.palette(0), _palette(0));

        uint256 id = _settled(alice);
        vm.prank(alice);
        look.setName(id, "Mochi");
        assertEq(look.nameOf(id), "Mochi");
        vm.prank(owner);
        look.releaseName(id);
        assertEq(look.nameOf(id), "");
    }

    /// freezeArt has no "already frozen" check: calling it again succeeds and emits ArtFrozen a second time.
    function test_freezeArtCanBeCalledAgainAndEmitsAgain() public {
        _installCompleteArt();
        vm.startPrank(owner);
        look.freezeArt();
        vm.recordLogs();
        look.freezeArt();
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], PetLook.ArtFrozen.selector);
        assertTrue(look.artFrozen());
    }

    function test_twoStepOwnershipMovesArtAndModerationControl() public {
        vm.prank(owner);
        look.transferOwnership(bob);
        assertEq(look.pendingOwner(), bob);
        assertEq(look.owner(), owner);
        vm.prank(owner);
        look.setPalette(0, _palette(1)); // the old owner keeps control until bob accepts
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, carol));
        look.acceptOwnership();
        vm.prank(bob);
        look.acceptOwnership();
        assertEq(look.owner(), bob);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        look.setPalette(0, _palette(2));
        vm.prank(bob);
        look.setPalette(0, _palette(2));
        assertEq(look.palette(0), _palette(2));
    }

    /// Renouncing ownership ends moderation for good: nobody can release an abusive name afterwards.
    function test_renouncedOwnershipLeavesNamesWithoutModeration() public {
        uint256 id = _settled(alice);
        vm.prank(alice);
        look.setName(id, "Mochi");
        vm.prank(owner);
        look.renounceOwnership();
        assertEq(look.owner(), address(0));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        look.releaseName(id);
        assertEq(look.nameOf(id), "Mochi");
    }
}
