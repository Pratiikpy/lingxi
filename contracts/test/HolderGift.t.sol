// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {OutfitMarketV2} from "../src/OutfitMarketV2.sol";
import {HolderGift, IGiftMarket} from "../src/HolderGift.sol";
import {MockBEM} from "./OutfitMarketV2.t.sol";

contract MockNFT is ERC721 {
    constructor(string memory n) ERC721(n, n) {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

/// The reviewer's farming attempt: a fresh contract with the minimum BEM tries to claim. It is not in the
/// snapshot, so it cannot.
contract Puppet is IERC1155Receiver {
    function tryClaim(HolderGift g, uint256 bemBal, bytes32[] calldata proof) external {
        g.claimWithSnapshot(bemBal, 0, proof);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 i) external pure returns (bool) {
        return i == type(IERC1155Receiver).interfaceId;
    }
}

contract HolderGiftTest is Test {
    OutfitMarketV2 m;
    HolderGift g;
    MockNFT test1;
    MockNFT rig;
    uint256 outfit;
    address owner = address(0xA11);
    address alice = address(0xA1); // in the snapshot with 0.5 BEM
    address bob = address(0xB0); // in the snapshot with 20 FAB
    address carol = address(0xCA); // in the snapshot with too little of both
    address dave = address(0xDA); // in the snapshot with exactly the BEM minimum
    bytes pin = hex"00030202ff0000ffff00a50a";
    bytes32[4] leaves;
    bytes32 root;

    function _leaf(address who, uint256 b, uint256 f) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(who, b, f))));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// The proof for leaf i of a four-leaf tree.
    function _proof(uint256 i) internal view returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = leaves[i ^ 1];
        p[1] = i < 2 ? _pair(leaves[2], leaves[3]) : _pair(leaves[0], leaves[1]);
    }

    function setUp() public {
        MockBEM bem = new MockBEM();
        test1 = new MockNFT("TCT1");
        rig = new MockNFT("RIG");
        m = new OutfitMarketV2(owner, IERC20(address(bem)));
        vm.prank(owner);
        outfit = m.create(pin, "Holder pin", 0, 1000, 500);
        leaves = [_leaf(alice, 0.5e8, 0), _leaf(bob, 0, 20e8), _leaf(carol, 0.09e8, 9e8), _leaf(dave, 0.1e8, 0)];
        root = _pair(_pair(leaves[0], leaves[1]), _pair(leaves[2], leaves[3]));
        g = new HolderGift(IGiftMarket(address(m)), outfit, address(test1), address(rig), root, 76_000_000, 0.1e8, 10e8);
        vm.prank(owner);
        m.setMinter(outfit, address(g), 999);
    }

    function test_aTest1HolderClaimsOnceAndTheTokenCannotGiveAgain() public {
        test1.mint(alice, 7);
        vm.prank(alice);
        g.claimWithNft(address(test1), 7);
        assertEq(m.balanceOf(alice, outfit), 1);
        assertTrue(g.claimed(alice));
        assertTrue(g.tokenUsed(address(test1), 7));
        vm.prank(alice);
        test1.transferFrom(alice, bob, 7);
        vm.prank(bob);
        vm.expectRevert(HolderGift.TokenUsed.selector);
        g.claimWithNft(address(test1), 7);
    }

    function test_snapshotHoldersClaimWithTheirProof() public {
        vm.prank(alice);
        g.claimWithSnapshot(0.5e8, 0, _proof(0));
        vm.prank(bob);
        g.claimWithSnapshot(0, 20e8, _proof(1));
        vm.prank(dave);
        g.claimWithSnapshot(0.1e8, 0, _proof(3));
        assertEq(m.balanceOf(alice, outfit), 1);
        assertEq(m.balanceOf(bob, outfit), 1);
        assertEq(m.balanceOf(dave, outfit), 1);
        assertEq(g.total(), 3);
    }

    function test_aSnapshotEntryBelowBothMinimumsIsRefused() public {
        vm.prank(carol);
        vm.expectRevert(HolderGift.NotHolder.selector);
        g.claimWithSnapshot(0.09e8, 9e8, _proof(2));
    }

    function test_aClaimedBalanceThatDiffersFromTheSnapshotIsRefused() public {
        vm.prank(alice);
        vm.expectRevert(HolderGift.NotHolder.selector);
        g.claimWithSnapshot(5e8, 0, _proof(0)); // inflated
        vm.prank(bob);
        vm.expectRevert(HolderGift.NotHolder.selector);
        g.claimWithSnapshot(0.5e8, 0, _proof(0)); // someone else's entry
    }

    /// The reviewer's farm: fresh contracts holding the minimum are not in the snapshot.
    function test_farmingThroughFreshWalletsFails() public {
        for (uint256 i = 0; i < 5; i++) {
            Puppet p = new Puppet();
            vm.expectRevert(HolderGift.NotHolder.selector);
            p.tryClaim(g, 0.5e8, _proof(0));
        }
        assertEq(g.total(), 0);
    }

    function test_aWalletClaimsOnlyOnceWhateverItHolds() public {
        test1.mint(alice, 1);
        rig.mint(alice, 2);
        vm.startPrank(alice);
        g.claimWithNft(address(test1), 1);
        vm.expectRevert(HolderGift.AlreadyClaimed.selector);
        g.claimWithNft(address(rig), 2);
        vm.expectRevert(HolderGift.AlreadyClaimed.selector);
        g.claimWithSnapshot(0.5e8, 0, _proof(0));
        vm.stopPrank();
        assertEq(m.balanceOf(alice, outfit), 1);
        assertFalse(g.tokenUsed(address(rig), 2)); // the refused claim used nothing up
    }

    function test_someoneElsesNftCannotBeUsed() public {
        test1.mint(alice, 3);
        vm.prank(bob);
        vm.expectRevert(HolderGift.NotHolder.selector);
        g.claimWithNft(address(test1), 3);
    }

    function test_onlyTheTwoCollectionsCount() public {
        MockNFT other = new MockNFT("X");
        other.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(HolderGift.UnknownCollection.selector);
        g.claimWithNft(address(other), 1);
    }

    function test_theMarketsGrantCapsTheGiftsAndAFailedClaimIsUndone() public {
        vm.prank(owner);
        m.setMinter(outfit, address(g), 1);
        vm.prank(alice);
        g.claimWithSnapshot(0.5e8, 0, _proof(0));
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.NotMinter.selector);
        g.claimWithSnapshot(0, 20e8, _proof(1));
        assertFalse(g.claimed(bob));
    }

    function test_aBadSetupIsRefused() public {
        vm.expectRevert(HolderGift.BadSetup.selector);
        new HolderGift(IGiftMarket(address(m)), outfit, address(test1), address(rig), bytes32(0), 1, 1, 1);
        vm.expectRevert(HolderGift.BadSetup.selector);
        new HolderGift(IGiftMarket(address(m)), outfit, address(test1), address(rig), root, 1, 0, 1);
        vm.expectRevert(HolderGift.BadSetup.selector);
        new HolderGift(IGiftMarket(address(0)), outfit, address(test1), address(rig), root, 1, 1, 1);
    }

    function test_theGiftIsAnOrdinaryOutfitThatCanBeSold() public {
        test1.mint(alice, 9);
        vm.prank(alice);
        g.claimWithNft(address(test1), 9);
        vm.prank(alice);
        m.list(outfit, 1, 0.5e8, uint64(block.timestamp + 1 days), address(0));
        assertEq(m.balanceOf(alice, outfit), 1);
    }
}
