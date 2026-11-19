// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PetLook} from "../src/PetLook.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {PetLookBase, LookText} from "./PetLook.t.sol";

/// Drives the names with random namings, renames, clears, moderation releases, transfers and art freezes,
/// over four settled pets and a pool of names that collide in ASCII case.
contract PetLookNamesHandler is Test {
    PetLook immutable look;
    PetRegistry immutable reg;
    address immutable owner;
    uint256[4] public pets;
    address[2] public people;
    bytes[8] pool;
    uint256 public namings;
    /// set if a pool name met any refusal other than NameTaken, or if a stranger's naming went through
    bool public broken;

    constructor(PetLook look_, PetRegistry reg_, address owner_, uint256[4] memory pets_, address[2] memory people_) {
        look = look_;
        reg = reg_;
        owner = owner_;
        pets = pets_;
        people = people_;
        pool[0] = "Mochi";
        pool[1] = "MOCHI";
        pool[2] = "mochi";
        pool[3] = "Bao";
        pool[4] = "bAO";
        pool[5] = "Pip";
        pool[6] = hex"e5b08fe781b5"; // 小灵
        pool[7] = hex"c389"; // É
    }

    function poolName(uint256 i) external view returns (bytes memory) {
        return pool[i];
    }

    function name(uint256 p, uint256 n) external {
        uint256 id = pets[p % 4];
        vm.prank(reg.ownerOf(id));
        try look.setName(id, string(pool[n % 8])) {
            namings++;
        } catch (bytes memory err) {
            // the only refusal a pool name can meet is another pet holding it
            if (bytes4(err) != PetLook.NameTaken.selector) broken = true;
        }
    }

    function clear(uint256 p) external {
        uint256 id = pets[p % 4];
        vm.prank(reg.ownerOf(id));
        look.setName(id, "");
    }

    function release(uint256 p) external {
        vm.prank(owner);
        look.releaseName(pets[p % 4]);
    }

    function give(uint256 p) external {
        uint256 id = pets[p % 4];
        address from = reg.ownerOf(id);
        address to = from == people[0] ? people[1] : people[0];
        vm.prank(from);
        reg.transferFrom(from, to, id);
    }

    function stranger(uint256 p, uint256 n) external {
        vm.prank(address(0xBAD));
        try look.setName(pets[p % 4], string(pool[n % 8])) {
            broken = true;
        } catch {}
    }
}

contract PetLookNamesInvariantTest is PetLookBase {
    PetLookNamesHandler handler;
    uint256[4] pets;

    function setUp() public override {
        // The public X Layer node refuses the fuzzer's many account lookups (HTTP 403): run these off the fork.
        if (block.chainid == 196) vm.skip(true);
        super.setUp();
        _installCompleteArt();
        for (uint256 i; i < 4; ++i) pets[i] = _settled(i % 2 == 0 ? alice : bob);
        handler = new PetLookNamesHandler(look, reg, owner, pets, [alice, bob]);
        vm.prank(owner);
        look.freezeArt(); // names must keep working on frozen art
        targetContract(address(handler));
    }

    /// Every named pet holds its own (case-folded) name, and the name is one validName accepts.
    function invariant_everyNamedPetHoldsItsName() public view {
        for (uint256 i; i < 4; ++i) {
            bytes memory n = bytes(look.nameOf(pets[i]));
            if (n.length == 0) continue;
            assertTrue(look.validName(n));
            assertEq(look.nameHolder(LookText.lowerKey(n)), pets[i] + 1);
        }
    }

    /// Every held name points at a pet whose current name folds to it: releases and renames leave no stale holder.
    function invariant_noNameIsHeldByAPetThatDropsIt() public view {
        for (uint256 k; k < 8; ++k) {
            bytes memory candidate = handler.poolName(k);
            uint256 h = look.nameHolder(LookText.lowerKey(candidate));
            if (h == 0) continue;
            assertEq(LookText.lowerKey(bytes(look.nameOf(h - 1))), LookText.lowerKey(candidate));
        }
    }

    /// No two pets ever share a name, in any ASCII casing.
    function invariant_noTwoPetsShareAName() public view {
        for (uint256 i; i < 4; ++i) {
            bytes memory a = bytes(look.nameOf(pets[i]));
            if (a.length == 0) continue;
            for (uint256 j = i + 1; j < 4; ++j) {
                bytes memory b = bytes(look.nameOf(pets[j]));
                if (b.length != 0) assertTrue(LookText.lowerKey(a) != LookText.lowerKey(b));
            }
        }
    }

    /// Owners only ever meet NameTaken with these names, and strangers never get through.
    function invariant_onlyTheExpectedRefusals() public view {
        assertFalse(handler.broken());
    }

    function invariant_artStaysFrozen() public view {
        assertTrue(look.artFrozen());
    }
}
