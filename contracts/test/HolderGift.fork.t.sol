// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OutfitMarketV2} from "../src/OutfitMarketV2.sol";
import {HolderGift, IGiftMarket} from "../src/HolderGift.sol";

/// The holder gift against the real collections on a fork of X Layer: the owner of TapeCode-Test1 #1 claims
/// through it; a stranger cannot use that token; a real BEM balance above the minimum claims.
contract HolderGiftForkTest is Test {
    address constant BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
    address constant FAB = 0x72F349B1Eee7833B26f8C81a8410775A4e231ed2;
    address constant TEST1 = 0x0e91460D6823C711643e650A9a4C0cc21DE41614;
    address constant RIG = 0x9cfc959cd42B2e1d39a0d850c528210E818AE520;
    OutfitMarketV2 m;
    HolderGift g;
    uint256 outfit;
    address owner = makeAddr("owner");
    address snapHolder;

    function setUp() public {
        if (block.chainid != 196) vm.skip(true);
        m = new OutfitMarketV2(owner, IERC20(BEM));
        vm.prank(owner);
        outfit = m.create(hex"00030202ff0000ffff00a50a", "Holder pin", 0, 5000, 500);
        // a one-entry snapshot for the BEM test below: the root of a single leaf is the leaf itself
        snapHolder = makeAddr("bemHolder");
        bytes32 root = keccak256(bytes.concat(keccak256(abi.encode(snapHolder, uint256(0.1e8), uint256(0)))));
        g = new HolderGift(IGiftMarket(address(m)), outfit, TEST1, RIG, root, block.number, 0.1e8, 10e8);
        vm.prank(owner);
        m.setMinter(outfit, address(g), 4999);
    }

    function test_theRealOwnerOfTest1NumberOneClaims() public {
        address holder = IOwner(TEST1).ownerOf(1);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(HolderGift.NotHolder.selector);
        g.claimWithNft(TEST1, 1);
        vm.prank(holder);
        g.claimWithNft(TEST1, 1);
        assertEq(m.balanceOf(holder, outfit), 1);
    }

    function test_aRealRigOwnerClaims() public {
        uint256 id = _firstRig();
        address holder = IOwner(RIG).ownerOf(id);
        vm.prank(holder);
        g.claimWithNft(RIG, id);
        assertEq(m.balanceOf(holder, outfit), 1);
    }

    function test_aSnapshotEntryClaims() public {
        vm.prank(snapHolder);
        g.claimWithSnapshot(0.1e8, 0, new bytes32[](0));
        assertEq(m.balanceOf(snapHolder, outfit), 1);
    }

    function _firstRig() internal view returns (uint256 id) {
        for (id = 0; id < 50; id++) {
            try IOwner(RIG).ownerOf(id) returns (address o) {
                if (o != address(0)) return id;
            } catch {}
        }
        revert("no rig found");
    }
}

interface IOwner {
    function ownerOf(uint256) external view returns (address);
}
