// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm, stdJson} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RedPacket, ISealProcessor, IPetMembers} from "../src/RedPacket.sol";
import {MockBEM} from "./OutfitMarketV2.t.sol";

/// LX-SEAL/1 as plain arithmetic (`sealReference` in packages/brain/src/seal.ts), with two faults the taped-out
/// seal never has: refusing every claim, and answering weight 0. The escrow's own guards must hold against both.
contract ReferenceSeal is ISealProcessor {
    bool public refuses;
    bool public weightless;

    function setFaults(bool refuses_, bool weightless_) external {
        refuses = refuses_;
        weightless = weightless_;
    }

    function eval(uint256, bytes calldata inputs) external view returns (bytes memory) {
        uint256 word = uint256(uint8(inputs[0])) | (uint256(uint8(inputs[1])) << 8);
        uint256 seed = (word >> 4) & 255;
        uint256 open = (word >> 12) & 1;
        uint256 member = (word >> 13) & 1;
        uint256 lucky = (word >> 14) & 1;
        uint256 only = (word >> 15) & 1;
        uint256 allowed = refuses ? 0 : open & (member | (only ^ 1));
        uint256 weight = 8;
        if (lucky == 1) {
            weight = (((seed & 15) + (seed >> 4)) >> 1) + 1;
            if (weight > 15) weight = 15;
        }
        if (weightless) weight = 0;
        uint256 best = lucky == 1 && weight == 15 ? 1 : 0;
        return abi.encodePacked(uint8(allowed | (weight << 1) | (best << 5)));
    }
}

/// Red packets on a local deployment, for what the fork suite cannot reach with the real seal: packets that do not
/// exist, a reservation left past the grace, the token list, and a seal that misbehaves.
contract RedPacketTest is Test {
    using stdJson for string;

    ReferenceSeal seal;
    RedPacket rp;
    MockBEM token; // a plain ERC-20 in USDT's place
    address owner = makeAddr("owner");
    address sender = makeAddr("sender");
    address a = makeAddr("a");
    address b = makeAddr("b");
    uint256 keyPk = 0xA11CE;
    address key;

    function setUp() public {
        seal = new ReferenceSeal();
        token = new MockBEM();
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        // no packet here is for pet owners only, so the members contract is never asked
        rp = new RedPacket(seal, 5, IPetMembers(makeAddr("pets")), owner, tokens);
        key = vm.addr(keyPk);
        token.mint(sender, 1_000e6);
        vm.prank(sender);
        token.approve(address(rp), type(uint256).max);
    }

    function _create(uint256 total, uint16 count, bool lucky) internal returns (uint256 id) {
        vm.prank(sender);
        id = rp.create(token, total, count, 0, 1 days, key, lucky, false);
    }

    function _sig(uint256 id, address claimer) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(keyPk, rp.claimDigest(id, claimer));
        return abi.encodePacked(r, s, v);
    }

    function _claim(uint256 id, address who) internal returns (uint256) {
        bytes memory sig = _sig(id, who);
        vm.prank(who);
        return rp.claim(id, sig, 0);
    }

    /// Two blocks past `who`'s reservation, with a hash for the deciding block (on a fork it lies past the chain's head).
    function _readyToReveal(uint256 id, address who) internal {
        (uint64 atBlock,,) = rp.pending(id, who);
        vm.roll(uint256(atBlock) + 2);
        vm.setBlockhash(uint256(atBlock) + 1, keccak256(abi.encode("decider", id, who)));
    }

    function _lastSealOutput() internal view returns (uint8 o) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; i--) {
            if (logs[i - 1].topics[0] == RedPacket.Claimed.selector) {
                (,,, o) = abi.decode(logs[i - 1].data, (uint256, uint16, uint16, uint8));
                return o;
            }
        }
        revert("no claim event");
    }

    /// These tests lean on the stand-in, so first: it answers the recorded probes as the taped-out seal does.
    function test_theReferenceSealAnswersTheRecordedProbes() public view {
        string memory fx = vm.readFile("test/fixtures/starters.json");
        for (uint256 i = 0; i < 6; i++) {
            uint256 w = fx.readUint(string.concat(".seal.probe[", vm.toString(i), "].word"));
            uint256 o = fx.readUint(string.concat(".seal.probe[", vm.toString(i), "].out"));
            assertEq(uint8(seal.eval(0, abi.encodePacked(uint8(w), uint8(w >> 8)))[0]), o);
        }
    }

    function test_anUnknownPacketCannotBeClaimedReadOrRefunded() public {
        bytes memory sig = _sig(9, a);
        vm.prank(a);
        vm.expectRevert(RedPacket.Unknown.selector);
        rp.claim(9, sig, 0);
        vm.expectRevert(RedPacket.Unknown.selector);
        rp.packet(9);
        vm.expectRevert(RedPacket.Unknown.selector);
        rp.refund(9);
        // nobody is the sender of a packet that was never made
        vm.prank(a);
        vm.expectRevert(RedPacket.NotSender.selector);
        rp.refundTo(9, a);
        vm.prank(a);
        vm.expectRevert(RedPacket.NothingToReveal.selector);
        rp.reveal(9);
    }

    /// A reservation must be revealed before the grace after expiry ends. Past it the share is lost: whoever opened
    /// theirs shares the pool, and only the unopened share's floor goes back to the sender.
    function test_aReservationUnrevealedByTheEndOfTheGraceIsLost() public {
        uint256 id = _create(20e6, 2, true);
        _claim(id, a);
        _claim(id, b);
        uint256 end = uint256(rp.packet(id).expiry) + rp.REVEAL_GRACE();
        _readyToReveal(id, a);
        vm.warp(end - 1);
        vm.prank(a);
        uint256 got = rp.reveal(id);
        vm.warp(end);
        vm.prank(b);
        vm.expectRevert(RedPacket.Expired.selector);
        rp.reveal(id);
        uint128 floor = rp.packet(id).floor;
        rp.refund(id);
        assertEq(token.balanceOf(sender), 1_000e6 - 20e6 + floor, "only b's floor goes back");
        vm.prank(a);
        rp.collect(id);
        assertEq(token.balanceOf(a), 20e6 - floor);
        assertGt(token.balanceOf(a), got, "a is topped up with what b never opened");
        assertEq(token.balanceOf(b), 0);
        assertEq(token.balanceOf(address(rp)), 0);
    }

    /// The seal decides every claim; if it says no, the claim fails whole: no slot is taken and nothing moves.
    function test_aSealThatSaysNoStopsTheClaimAndTakesNoSlot() public {
        uint256 even = _create(10e6, 2, false);
        uint256 lucky = _create(10e6, 2, true);
        seal.setFaults(true, false);
        bytes memory sigEven = _sig(even, a);
        bytes memory sigLucky = _sig(lucky, a);
        vm.prank(a);
        vm.expectRevert(RedPacket.SealSaysNo.selector);
        rp.claim(even, sigEven, 0);
        vm.prank(a);
        vm.expectRevert(RedPacket.SealSaysNo.selector);
        rp.claim(lucky, sigLucky, 0);
        assertFalse(rp.tookSlot(even, a));
        assertFalse(rp.tookSlot(lucky, a));
        assertEq(rp.packet(even).claimed, 0);
        assertEq(rp.packet(lucky).claimed, 0);
        assertEq(token.balanceOf(address(rp)), 20e6);
        seal.setFaults(false, false);
        assertEq(_claim(even, a), 5e6, "the slot is still there to take");
    }

    /// A zero weight counts as one, so the weights can never sum to zero and the final share-out can always divide.
    function test_aSealAnsweringWeightZeroIsCountedAsWeightOne() public {
        seal.setFaults(false, true);
        uint256 id = _create(30e6, 2, true);
        _claim(id, a);
        _claim(id, b);
        _readyToReveal(id, a);
        RedPacket.Packet memory p = rp.packet(id);
        uint256 weightOne = p.floor + uint256(p.extra) / (15 * 2);
        vm.recordLogs();
        vm.prank(a);
        assertEq(rp.reveal(id), weightOne);
        assertEq((_lastSealOutput() >> 1) & 15, 0, "the seal said weight 0");
        vm.prank(b);
        assertEq(rp.reveal(id), weightOne);
        assertEq(rp.weightSum(id), 2);
        assertTrue(rp.settled(id));
        vm.prank(a);
        rp.collect(id);
        vm.prank(b);
        rp.collect(id);
        assertEq(token.balanceOf(a), 15e6);
        assertEq(token.balanceOf(b), 15e6);
        assertEq(token.balanceOf(address(rp)), 0);
        // an even split pays by what is left, whatever weight the seal names
        uint256 even = _create(10e6, 2, false);
        assertEq(_claim(even, a), 5e6);
    }

    /// The owner keeps the list of tokens a packet may hold. Taking one off stops new packets only: a packet already
    /// funded with it still pays its claimers and refunds its sender.
    function test_onlyTheOwnerChangesTheTokenListAndRetiringATokenStrandsNoPacket() public {
        MockBEM other = new MockBEM();
        other.mint(sender, 100e6);
        vm.prank(sender);
        other.approve(address(rp), type(uint256).max);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        rp.setToken(address(other), true);
        vm.expectEmit(true, false, false, true, address(rp));
        emit RedPacket.TokenAllowed(address(other), true);
        vm.prank(owner);
        rp.setToken(address(other), true);
        vm.prank(sender);
        uint256 id = rp.create(other, 20e6, 2, 0, 1 days, key, false, false);
        vm.prank(owner);
        rp.setToken(address(other), false);
        assertFalse(rp.allowedToken(address(other)));
        vm.prank(sender);
        vm.expectRevert(RedPacket.TokenNotAllowed.selector);
        rp.create(other, 20e6, 2, 0, 1 days, key, false, false);
        assertEq(_claim(id, a), 10e6);
        vm.warp(block.timestamp + 1 days);
        rp.refund(id);
        assertEq(other.balanceOf(sender), 100e6 - 10e6);
        assertEq(other.balanceOf(address(rp)), 0);
    }
}
