// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {PetLook} from "../src/PetLook.sol";
import {PetLookBase, LookText} from "./PetLook.t.sol";

/* ── names: who may name, settling, uniqueness, moderation, and the rules ─ */

contract PetLookNamesTest is PetLookBase {
    function _key(string memory s) internal pure returns (bytes32) {
        return LookText.lowerKey(bytes(s));
    }

    function test_ownerNamesASettledPet() public {
        uint256 id = _settled(alice);
        vm.expectEmit(true, false, false, true, address(look));
        emit PetLook.Named(id, "Mochi");
        vm.prank(alice);
        look.setName(id, "Mochi");
        assertEq(look.nameOf(id), "Mochi");
        assertEq(look.nameHolder(keccak256("mochi")), id + 1);
    }

    function test_anOperatorApprovedForAllMayName() public {
        uint256 id = _settled(alice);
        vm.prank(alice);
        reg.setApprovalForAll(bob, true);
        vm.prank(bob);
        look.setName(id, "Bao");
        assertEq(look.nameOf(id), "Bao");
    }

    function test_approvalForOneTokenIsNotEnoughToName() public {
        uint256 id = _settled(alice);
        vm.prank(alice);
        reg.approve(bob, id);
        vm.prank(bob);
        vm.expectRevert(PetLook.NotPetOwner.selector);
        look.setName(id, "Bao");
    }

    function test_aSitterMayNotName() public {
        uint256 id = _settled(alice);
        vm.prank(alice);
        reg.setSitter(id, bob, uint64(block.timestamp + 1 days));
        assertTrue(reg.isKeeper(id, bob));
        vm.prank(bob);
        vm.expectRevert(PetLook.NotPetOwner.selector);
        look.setName(id, "Bao");
    }

    function test_aStrangerMayNotNameOrClear() public {
        uint256 id = _settled(alice);
        vm.prank(alice);
        look.setName(id, "Mochi");
        vm.startPrank(carol);
        vm.expectRevert(PetLook.NotPetOwner.selector);
        look.setName(id, "Pip");
        vm.expectRevert(PetLook.NotPetOwner.selector);
        look.setName(id, "");
        vm.stopPrank();
        assertEq(look.nameOf(id), "Mochi");
    }

    function test_namingAnUnknownPetReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 999));
        look.setName(999, "Mochi");
    }

    /// Settled means both three days on chain and the third day saved; either alone is not enough.
    function test_onlySettledPetsTakeANameButAnyPetMayClear() public {
        uint256 id = _hatch(alice, 0);
        vm.startPrank(alice);
        vm.expectRevert(PetLook.NotSettled.selector);
        look.setName(id, "Mochi");
        // two days on: day 3 can be saved, but the pet is not three days old
        vm.warp(block.timestamp + 2 days);
        reg.checkpoint(id, 3, 0, bytes32(0));
        vm.expectRevert(PetLook.NotSettled.selector);
        look.setName(id, "Mochi");
        // clearing needs no settling
        vm.expectEmit(true, false, false, true, address(look));
        emit PetLook.Named(id, "");
        look.setName(id, "");
        vm.warp(block.timestamp + 1 days);
        look.setName(id, "Mochi");
        vm.stopPrank();
        assertEq(look.nameOf(id), "Mochi");

        // three days old but only day 1 saved
        uint256 other = _hatch(bob, 0);
        vm.warp(block.timestamp + 5 days);
        vm.startPrank(bob);
        reg.checkpoint(other, 1, 0, bytes32(0));
        vm.expectRevert(PetLook.NotSettled.selector);
        look.setName(other, "Bao");
        vm.stopPrank();
    }

    function test_renamingFreesTheOldNameForOthers() public {
        uint256 a = _settled(alice);
        uint256 b = _settled(bob);
        vm.prank(alice);
        look.setName(a, "Mochi");
        vm.prank(alice);
        look.setName(a, "Bao");
        assertEq(look.nameHolder(_key("Mochi")), 0);
        assertEq(look.nameHolder(_key("Bao")), a + 1);
        vm.prank(bob);
        look.setName(b, "mochi");
        assertEq(look.nameHolder(_key("Mochi")), b + 1);
    }

    function test_namesAreUniqueIgnoringAsciiCaseAndTheErrorNamesTheHolder() public {
        uint256 a = _settled(alice);
        uint256 b = _settled(bob);
        vm.prank(alice);
        look.setName(a, "Mochi");
        string[3] memory clashes = ["Mochi", "mOCHI", "mochi"];
        for (uint256 i; i < 3; ++i) {
            vm.prank(bob);
            vm.expectRevert(abi.encodeWithSelector(PetLook.NameTaken.selector, a));
            look.setName(b, clashes[i]);
        }
        assertEq(look.nameOf(b), "");
    }

    function test_aRefusedRenameKeepsTheOldName() public {
        uint256 a = _settled(alice);
        uint256 b = _settled(bob);
        vm.prank(alice);
        look.setName(a, "Mochi");
        vm.prank(bob);
        look.setName(b, "Bao");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PetLook.NameTaken.selector, a));
        look.setName(b, "MOCHI");
        assertEq(look.nameOf(b), "Bao");
        assertEq(look.nameHolder(_key("Bao")), b + 1);
        vm.prank(bob);
        vm.expectRevert(PetLook.BadName.selector);
        look.setName(b, " bad");
        assertEq(look.nameOf(b), "Bao");
        assertEq(look.nameHolder(_key("Bao")), b + 1);
    }

    function test_aPetMayRetakeItsOwnNameInNewCasing() public {
        uint256 a = _settled(alice);
        vm.startPrank(alice);
        look.setName(a, "Mochi");
        look.setName(a, "Mochi");
        look.setName(a, "MOCHI");
        vm.stopPrank();
        assertEq(look.nameOf(a), "MOCHI");
        assertEq(look.nameHolder(_key("mochi")), a + 1);
    }

    function test_clearingANameReleasesIt() public {
        uint256 a = _settled(alice);
        uint256 b = _settled(bob);
        vm.prank(alice);
        look.setName(a, "Mochi");
        vm.expectEmit(true, false, false, true, address(look));
        emit PetLook.Named(a, "");
        vm.prank(alice);
        look.setName(a, "");
        assertEq(look.nameOf(a), "");
        assertEq(look.nameHolder(_key("Mochi")), 0);
        vm.prank(bob);
        look.setName(b, "Mochi");
    }

    function test_theNameStaysWithThePetWhenItChangesHands() public {
        uint256 id = _settled(alice);
        vm.prank(alice);
        look.setName(id, "Mochi");
        vm.prank(alice);
        reg.transferFrom(alice, bob, id);
        assertEq(look.nameOf(id), "Mochi");
        vm.prank(alice);
        vm.expectRevert(PetLook.NotPetOwner.selector);
        look.setName(id, "Pip");
        vm.prank(bob);
        look.setName(id, "Pip");
        assertEq(look.nameOf(id), "Pip");
    }

    function test_setNameRefusesBadNames() public {
        uint256 id = _settled(alice);
        bytes[8] memory bad = [bytes(" Mochi"), bytes("Mochi "), bytes("Mo<chi"), bytes("a\"b"), bytes(hex"4d6f0a"), bytes("1234567890123456789012345"), bytes(hex"e2808b4d"), bytes(hex"c3")];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(PetLook.BadName.selector);
            look.setName(id, string(bad[i]));
        }
    }

    /// Case folding covers ASCII only: É and é are different names.
    function test_nonAsciiLettersAreNotCaseFolded() public {
        uint256 a = _settled(alice);
        uint256 b = _settled(bob);
        vm.prank(alice);
        look.setName(a, string(hex"c389")); // É
        vm.prank(bob);
        look.setName(b, string(hex"c3a9")); // é
        assertEq(look.nameHolder(keccak256(hex"c389")), a + 1);
        assertEq(look.nameHolder(keccak256(hex"c3a9")), b + 1);
    }

    function test_ownerReleasesAnAbusiveNameForSomeoneElse() public {
        uint256 a = _settled(alice);
        uint256 b = _settled(bob);
        vm.prank(alice);
        look.setName(a, "Mochi");
        vm.expectEmit(true, false, false, true, address(look));
        emit PetLook.Named(a, "");
        vm.prank(owner);
        look.releaseName(a);
        assertEq(look.nameOf(a), "");
        assertEq(look.nameHolder(_key("Mochi")), 0);
        vm.prank(bob);
        look.setName(b, "MOCHI");
        assertEq(look.nameHolder(_key("mochi")), b + 1);
    }

    function test_releasingAnUnnamedPetDoesNothing() public {
        uint256 a = _settled(alice);
        vm.recordLogs();
        vm.prank(owner);
        look.releaseName(a);
        assertEq(vm.getRecordedLogs().length, 0);
        vm.prank(owner);
        look.releaseName(12345); // a pet that does not exist: also a no-op
    }

    function test_releaseNameIsOwnerOnly() public {
        uint256 a = _settled(alice);
        vm.prank(alice);
        look.setName(a, "Mochi");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        look.releaseName(a);
    }

    /// Random ASCII letters: every casing of a held name is refused to every other pet.
    function testFuzz_everyAsciiCasingOfAHeldNameIsTaken(bytes32 seed, uint8 len) public {
        len = uint8(bound(len, 1, 24));
        bytes memory lower = new bytes(len);
        bytes memory mixed = new bytes(len);
        for (uint256 i; i < len; ++i) {
            uint8 c = uint8(97 + uint8(seed[i % 32]) % 26);
            lower[i] = bytes1(c);
            mixed[i] = bytes1((uint8(seed[(i + 7) % 32]) & 1) == 1 ? c - 32 : c);
        }
        uint256 a = _settled(alice);
        uint256 b = _settled(bob);
        vm.prank(alice);
        look.setName(a, string(mixed));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PetLook.NameTaken.selector, a));
        look.setName(b, string(lower));
        assertEq(look.nameHolder(keccak256(lower)), a + 1);
    }

    /* ── validName ─────────────────────────────────────────────────────── */

    function test_validNameAcceptsOrdinaryNames() public view {
        bytes[14] memory good = [
            bytes("a"),
            bytes("Mochi"),
            bytes("Mo chi"),
            bytes("O'Neil #2 (the 3rd)!"),
            bytes("123456789012345678901234"), // exactly 24 bytes
            bytes(hex"e5b08fe781b5"), // 小灵
            bytes(hex"f09f90b1"), // a cat emoji, four bytes
            bytes(hex"c3a9"), // é
            bytes(hex"c2a1"), // U+00A1, just past the hidden C1/NBSP range
            bytes(hex"dfbf"), // U+07FF, largest two-byte form
            bytes(hex"efbfbd"), // U+FFFD replacement character
            bytes(hex"f48fbfbf"), // U+10FFFF, the last code point
            bytes(hex"e0a080"), // U+0800, smallest three-byte form
            bytes(hex"f0908080") // U+10000, smallest four-byte form
        ];
        for (uint256 i; i < good.length; ++i) assertTrue(look.validName(good[i]), string(good[i]));
    }

    function test_validNameRefusesLengthEdgeSpacesAndUnsafeAscii() public view {
        bytes[14] memory bad = [
            bytes(""),
            bytes("1234567890123456789012345"),
            bytes(" "),
            bytes(" a"),
            bytes("a "),
            bytes("a\"b"),
            bytes("a\\b"),
            bytes("a<b"),
            bytes("a>b"),
            bytes("a&b"),
            bytes(hex"6100"),
            bytes(hex"611f"),
            bytes(hex"617f"),
            bytes(hex"6109")
        ];
        for (uint256 i; i < bad.length; ++i) assertFalse(look.validName(bad[i]));
    }

    function test_validNameRefusesMalformedUtf8() public view {
        bytes[16] memory bad = [
            bytes(hex"80"), // a lone continuation byte
            bytes(hex"bf"),
            bytes(hex"c0af"), // overlong lead bytes
            bytes(hex"c1bf"),
            bytes(hex"f5808080"), // lead bytes past U+10FFFF
            bytes(hex"ff"),
            bytes(hex"61c3"), // truncated sequences
            bytes(hex"e5b0"),
            bytes(hex"f09f90"),
            bytes(hex"c341"), // a continuation that is not one
            bytes(hex"e5418f"),
            bytes(hex"f09f9041"),
            bytes(hex"e09fbf"), // overlong three-byte form
            bytes(hex"eda080"), // a surrogate (U+D800)
            bytes(hex"f08fbfbf"), // overlong four-byte form
            bytes(hex"f4908080") // U+110000
        ];
        for (uint256 i; i < bad.length; ++i) assertFalse(look.validName(bad[i]));
    }

    /// Each listed hidden range at both ends, and the single listed code points, inside a name.
    function test_validNameRefusesEveryListedHiddenCodePoint() public view {
        uint24[28] memory hidden = [
            uint24(0x80), 0x9f, 0xa0, 0xad, 0x34f, 0x115f, 0x1160, 0x180e, 0x2000, 0x200b, 0x200d, 0x200e, 0x202e, 0x2066, 0x206f,
            0x3000, 0x3164, 0xfe00, 0xfe0f, 0xfeff, 0xffa0, 0xfff0, 0xfff9, 0xfffb, 0xe0000, 0xe0001, 0xe0100, 0xe0fff
        ];
        for (uint256 i; i < hidden.length; ++i) {
            assertFalse(look.validName(abi.encodePacked("a", LookText.utf8(hidden[i]), "b")), Strings.toHexString(hidden[i]));
        }
    }

    function test_validNameAcceptsCodePointsJustOutsideTheHiddenRanges() public view {
        uint24[13] memory near = [uint24(0xa1), 0xac, 0xae, 0x34e, 0x350, 0x1fff, 0x2070, 0x2fff, 0x3001, 0xfdff, 0xfe10, 0xfffc, 0xe1000];
        for (uint256 i; i < near.length; ++i) {
            assertTrue(look.validName(abi.encodePacked("a", LookText.utf8(near[i]), "b")), Strings.toHexString(near[i]));
        }
    }

    /// DEFECT. The NatSpec promises "no invisible or direction-changing characters", but the hidden list misses
    /// Unicode Default_Ignorable code points: U+061C ARABIC LETTER MARK (a bidi control), U+17B4..17B5, the
    /// Mongolian free variation selectors U+180B..180D and U+180F, U+1BCA0..1BCA3 and U+1D173..1D17A.
    /// All of them render as nothing, and validName accepts every one.
    function test_defect_validNameAcceptsInvisibleDefaultIgnorablesMissingFromTheHiddenList() public view {
        uint24[13] memory missed =
            [uint24(0x61c), 0x17b4, 0x17b5, 0x180b, 0x180c, 0x180d, 0x180f, 0x1bca0, 0x1bca3, 0x1d173, 0x1d177, 0x1d17a, 0x1d175];
        for (uint256 i; i < missed.length; ++i) {
            assertTrue(look.validName(abi.encodePacked("Mochi", LookText.utf8(missed[i]))), Strings.toHexString(missed[i]));
        }
    }

    /// DEFECT, consequence of the gap above: a second pet takes "Mochi" + U+061C, which displays exactly as the
    /// first pet's "Mochi" — the impersonation the name rules say they prevent.
    function test_defect_aLookalikeNameWithAnInvisibleArabicLetterMarkIsAccepted() public {
        uint256 a = _settled(alice);
        uint256 b = _settled(bob);
        vm.prank(alice);
        look.setName(a, "Mochi");
        vm.prank(bob);
        look.setName(b, string(abi.encodePacked("Mochi", hex"d89c")));
        assertEq(look.nameHolder(_key("Mochi")), a + 1);
        assertEq(look.nameHolder(keccak256(abi.encodePacked("mochi", hex"d89c"))), b + 1);
    }

    /// A limit, not a promise broken: names are compared byte for byte (after ASCII folding), so a precomposed é and
    /// e + combining acute (which look identical) are two different names.
    function test_precomposedAndDecomposedAccentsAreDifferentNames() public {
        uint256 a = _settled(alice);
        uint256 b = _settled(bob);
        vm.prank(alice);
        look.setName(a, string(hex"4a6f73c3a9")); // José, NFC
        vm.prank(bob);
        look.setName(b, string(hex"4a6f7365cc81")); // José, NFD
        assertEq(look.nameHolder(keccak256(hex"6a6f73c3a9")), a + 1);
        assertEq(look.nameHolder(keccak256(hex"6a6f7365cc81")), b + 1);
    }

    /// Any one code point between two letters: accepted exactly when it is printable ASCII outside " \ < > &,
    /// or a non-surrogate above U+007F outside the documented hidden list.
    function testFuzz_validNameJudgesEveryCodePointByTheDocumentedRule(uint256 cp) public view {
        cp = bound(cp, 0, 0x10ffff);
        bool ok;
        if (cp < 0x80) ok = cp >= 0x20 && cp != 0x7f && cp != 0x22 && cp != 0x5c && cp != 0x3c && cp != 0x3e && cp != 0x26;
        else ok = !(cp >= 0xd800 && cp <= 0xdfff) && !_hiddenRef(cp);
        assertEq(look.validName(abi.encodePacked("a", LookText.utf8(cp), "b")), ok);
    }

    /// Random bytes: validName agrees with a validator written from the Unicode well-formed byte table (3-7).
    function testFuzz_validNameAgreesWithTheUnicodeWellFormedTable(bytes calldata b) public view {
        assertEq(look.validName(b), _refValid(b));
    }

    /// Three random code points in a row (the fuzzer rarely builds valid multi-byte text from raw bytes).
    function testFuzz_validNameAgreesWithTheTableOnEncodedText(uint24 c1, uint24 c2, uint24 c3) public view {
        bytes memory b = abi.encodePacked(LookText.utf8(bound(c1, 0, 0x10ffff)), LookText.utf8(bound(c2, 0, 0x10ffff)), LookText.utf8(bound(c3, 0, 0x10ffff)));
        assertEq(look.validName(b), _refValid(b));
    }

    function _hiddenRef(uint256 cp) internal pure returns (bool) {
        return (cp >= 0x80 && cp <= 0xa0) || cp == 0xad || cp == 0x34f || cp == 0x115f || cp == 0x1160 || cp == 0x180e
            || (cp >= 0x2000 && cp <= 0x206f) || cp == 0x3000 || cp == 0x3164 || (cp >= 0xfe00 && cp <= 0xfe0f) || cp == 0xfeff
            || cp == 0xffa0 || (cp >= 0xfff0 && cp <= 0xfffb) || (cp >= 0xe0000 && cp <= 0xe0fff);
    }

    /// Unicode 15, Table 3-7: well-formed UTF-8 byte sequences, plus the length, space, ASCII and hidden rules.
    function _refValid(bytes memory b) internal pure returns (bool) {
        uint256 n = b.length;
        if (n == 0 || n > 24 || b[0] == 0x20 || b[n - 1] == 0x20) return false;
        uint256 i;
        while (i < n) {
            uint8 c = uint8(b[i]);
            if (c <= 0x7f) {
                if (c < 0x20 || c == 0x7f || c == 0x22 || c == 0x5c || c == 0x3c || c == 0x3e || c == 0x26) return false;
                i++;
                continue;
            }
            uint256 len;
            uint8 lo = 0x80;
            uint8 hi = 0xbf;
            if (c >= 0xc2 && c <= 0xdf) len = 2;
            else if (c == 0xe0) (len, lo) = (3, 0xa0);
            else if (c == 0xed) (len, hi) = (3, 0x9f);
            else if (c >= 0xe1 && c <= 0xef) len = 3;
            else if (c == 0xf0) (len, lo) = (4, 0x90);
            else if (c == 0xf4) (len, hi) = (4, 0x8f);
            else if (c >= 0xf1 && c <= 0xf3) len = 4;
            else return false;
            if (i + len > n) return false;
            uint256 cp = c & (len == 2 ? 0x1f : len == 3 ? 0x0f : 0x07);
            for (uint256 k = 1; k < len; ++k) {
                uint8 d = uint8(b[i + k]);
                if (k == 1 ? (d < lo || d > hi) : (d < 0x80 || d > 0xbf)) return false;
                cp = (cp << 6) | (d & 0x3f);
            }
            if (_hiddenRef(cp)) return false;
            i += len;
        }
        return true;
    }
}
