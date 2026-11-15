// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, stdJson, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {RedPacket, ISealProcessor, IPetCount} from "../src/RedPacket.sol";
import {ITapeOutFactory} from "../src/interfaces/ITapeOut.sol";

interface IProcR {
    function tapeout(bytes calldata nl, uint32 nIn, uint32 nOut) external payable returns (uint256);
    function TAPEOUT_FEE() external view returns (uint256);
    function transistors() external view returns (address);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
}

interface ITransistorsR {
    function mint(uint256 id, uint256 amount) external payable;
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
}

/// Red packets on a fork of X Layer with real USDT: the seal circuit is taped out on
/// a TapeOut processor and decides every claim; the escrow pays exactly what it holds.
contract RedPacketForkTest is Test {
    using stdJson for string;

    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    IProcR constant PROC = IProcR(0xE0EF4FffD869cBD24b2F83E6d2d83109937E05ff);
    IERC20 constant USDT = IERC20(0x1E4a5963aBFD975d8c9021ce480b42188849D41d);

    RedPacket rp;
    PetRegistry reg;
    uint256 sealId;
    string fx;
    address sender = makeAddr("sender");
    uint256 keyPk = 0xA11CE;
    address key;

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function setUp() public {
        if (block.chainid != 196) vm.skip(true);
        fx = vm.readFile("test/fixtures/starters.json");
        vm.deal(address(this), 1_000 ether);
        bytes memory nl = fx.readBytes(".seal.netlist");
        uint256 gates = fx.readUint(".seal.gates");
        ITransistorsR t = ITransistorsR(PROC.transistors());
        t.mint{value: t.mintPrice() * gates + t.protocolFee()}(0, gates);
        sealId = PROC.tapeout{value: PROC.TAPEOUT_FEE()}(nl, 16, 8);
        reg = new PetRegistry(FACTORY, makeAddr("owner"));
        rp = new RedPacket(ISealProcessor(address(PROC)), sealId, IPetCount(address(reg)));
        key = vm.addr(keyPk);
        deal(address(USDT), sender, 1_000e6);
        vm.prank(sender);
        USDT.approve(address(rp), type(uint256).max);
    }

    function _sig(uint256 id, address claimer, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, rp.claimDigest(id, claimer));
        return abi.encodePacked(r, s, v);
    }

    function _claim(uint256 id, address who) internal returns (uint256) {
        bytes memory sig = _sig(id, who, keyPk);
        vm.prank(who);
        return rp.claim(id, sig);
    }

    function test_sealOnChainAnswersLikeTheReference() public view {
        for (uint256 i = 0; i < 6; i++) {
            uint256 w = fx.readUint(string.concat(".seal.probe[", vm.toString(i), "].word"));
            uint256 o = fx.readUint(string.concat(".seal.probe[", vm.toString(i), "].out"));
            bytes memory out = PROC.eval(sealId, abi.encodePacked(uint8(w), uint8(w >> 8)));
            assertEq(uint8(out[0]), o, "seal output");
        }
    }

    function test_evenSplitPaysEachTheSameAndStops() public {
        vm.prank(sender);
        uint256 id = rp.create(USDT, 100e6, 4, 0, 1 days, key, false, false);
        for (uint256 i = 0; i < 4; i++) {
            address who = makeAddr(string.concat("friend", vm.toString(i)));
            assertEq(_claim(id, who), 25e6);
            assertEq(USDT.balanceOf(who), 25e6);
        }
        bytes memory late = _sig(id, makeAddr("late"), keyPk);
        vm.prank(makeAddr("late"));
        vm.expectRevert(RedPacket.AllClaimed.selector);
        rp.claim(id, late);
        assertEq(USDT.balanceOf(address(rp)), 0);
    }

    function test_luckySplitIsWholeFairAndReplayable() public {
        vm.prank(sender);
        uint256 id = rp.create(USDT, 100e6, 5, 0, 1 days, key, true, false);
        uint256 sum;
        uint128 floor = rp.packet(id).floor;
        for (uint256 i = 0; i < 5; i++) {
            address who = makeAddr(string.concat("lucky", vm.toString(i)));
            assertEq(_claim(id, who), 0, "a lucky claim only reserves");
            // revealing in the same or the next block is refused: the deciding hash does not exist yet
            vm.prank(who);
            vm.expectRevert(RedPacket.TooEarly.selector);
            rp.reveal(id);
            vm.roll(block.number + 1);
            vm.prank(who);
            vm.expectRevert(RedPacket.TooEarly.selector);
            rp.reveal(id);
            vm.roll(block.number + 1);
            vm.recordLogs();
            vm.prank(who);
            uint256 got = rp.reveal(id);
            assertGe(got, floor, "never below the floor");
            sum += got;
            // the seal's answer in the event is exactly what eval gives for that input
            (, , uint16 index, uint16 word, uint8 o) = _lastClaim();
            assertEq(index, i);
            bytes memory again = PROC.eval(sealId, abi.encodePacked(uint8(word), uint8(word >> 8)));
            assertEq(uint8(again[0]), o, "anyone can re-run the seal");
            uint256 weight = (o >> 1) & 15;
            assertGe(weight, 1);
            assertLe(weight, 15);
        }
        assertEq(sum, 100e6, "every token is paid out");
    }

    function _lastClaim() internal returns (address, uint256, uint16, uint16, uint8) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; i--) {
            if (logs[i - 1].topics[0] == RedPacket.Claimed.selector) {
                (uint256 amount, uint16 index, uint16 word, uint8 o) = abi.decode(logs[i - 1].data, (uint256, uint16, uint16, uint8));
                return (address(uint160(uint256(logs[i - 1].topics[2]))), amount, index, word, o);
            }
        }
        revert("no claim event");
    }

    function test_theKeyIsBoundToTheClaimer() public {
        vm.prank(sender);
        uint256 id = rp.create(USDT, 10e6, 2, 0, 1 days, key, false, false);
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        // bob replays alice's signature: refused
        bytes memory forAlice = _sig(id, alice, keyPk);
        vm.prank(bob);
        vm.expectRevert(RedPacket.BadKey.selector);
        rp.claim(id, forAlice);
        // a different key: refused
        bytes memory wrong = _sig(id, bob, 0xB0B);
        vm.prank(bob);
        vm.expectRevert(RedPacket.BadKey.selector);
        rp.claim(id, wrong);
        // once only
        _claim(id, alice);
        vm.prank(alice);
        vm.expectRevert(RedPacket.AlreadyClaimed.selector);
        rp.claim(id, forAlice);
    }

    function test_petOwnersOnlyAsksTheSeal() public {
        vm.prank(sender);
        uint256 id = rp.create(USDT, 10e6, 2, 0, 1 days, key, false, true);
        address stranger = makeAddr("stranger");
        bytes memory sig = _sig(id, stranger, keyPk);
        vm.prank(stranger);
        vm.expectRevert(RedPacket.SealSaysNo.selector);
        rp.claim(id, sig);
        // a pet owner may open it (a hatched pet on the registry)
        address owner = makeAddr("owner");
        address keeper = makeAddr("keeper");
        bytes memory starter = fx.readBytes(".gentle.netlist");
        ITransistorsR t = ITransistorsR(PROC.transistors());
        uint256 gates = fx.readUint(".gentle.gates");
        uint256 latches = fx.readUint(".gentle.nState");
        t.mint{value: t.mintPrice() * (gates - latches) + t.protocolFee()}(0, gates - latches);
        t.mint{value: t.mintPrice() * latches + t.protocolFee()}(1, latches);
        uint64 brain = uint64(PROC.tapeout{value: PROC.TAPEOUT_FEE()}(starter, 16, 8));
        vm.prank(owner);
        reg.setStarterBrain(address(PROC), brain, true);
        vm.prank(keeper);
        reg.hatch(keeper, 0, address(PROC), brain, 0);
        assertGt(_claim(id, keeper), 0);
    }

    function test_expiryRefundsTheSenderOnly() public {
        vm.prank(sender);
        uint256 id = rp.create(USDT, 30e6, 3, 0, 1 days, key, false, false);
        _claim(id, makeAddr("early"));
        vm.expectRevert(RedPacket.NotYet.selector);
        rp.refund(id);
        vm.warp(block.timestamp + 1 days);
        bytes memory sig = _sig(id, makeAddr("late"), keyPk);
        vm.prank(makeAddr("late"));
        vm.expectRevert(RedPacket.Expired.selector);
        rp.claim(id, sig);
        uint256 before = USDT.balanceOf(sender);
        vm.prank(makeAddr("anyone"));
        rp.refund(id);
        assertEq(USDT.balanceOf(sender) - before, 20e6, "the rest goes back to the sender");
        vm.expectRevert(RedPacket.Empty.selector);
        rp.refund(id);
    }

    function test_refusesBadPackets() public {
        vm.startPrank(sender);
        vm.expectRevert(RedPacket.BadShares.selector);
        rp.create(USDT, 10e6, 0, 0, 1 days, key, false, false);
        vm.expectRevert(RedPacket.BadShares.selector);
        rp.create(USDT, 10e6, 17, 0, 1 days, key, false, false);
        vm.expectRevert(RedPacket.BadLifetime.selector);
        rp.create(USDT, 10e6, 2, 0, 31 days, key, false, false);
        vm.expectRevert(RedPacket.NoKey.selector);
        rp.create(USDT, 10e6, 2, 0, 1 days, address(0), false, false);
        vm.expectRevert(RedPacket.TooSmall.selector);
        rp.create(USDT, 10e6, 4, 3e6, 1 days, key, false, false);
        vm.stopPrank();
    }

    function test_revealRulesAndLateReveals() public {
        vm.prank(sender);
        uint256 id = rp.create(USDT, 40e6, 2, 0, 1 days, key, true, false);
        address a = makeAddr("a");
        address b = makeAddr("b");
        vm.prank(a);
        vm.expectRevert(RedPacket.NothingToReveal.selector);
        rp.reveal(id);
        _claim(id, a);
        // a second reservation by the same address is refused
        bytes memory again = _sig(id, a, keyPk);
        vm.prank(a);
        vm.expectRevert(RedPacket.AlreadyClaimed.selector);
        rp.claim(id, again);
        // revealing 300 blocks later, after the deciding hash is gone, earns the smallest weight
        vm.roll(block.number + 300);
        vm.recordLogs();
        vm.prank(a);
        uint256 got = rp.reveal(id);
        (, , , , uint8 o) = _lastClaim();
        assertEq((o >> 1) & 15, 1, "late reveal: weight 1");
        uint128 floor = rp.packet(id).floor;
        assertEq(got, floor + ((80e6 / 2 - floor) * 1) / 16);
        // the last share takes exactly what is left
        _claim(id, b);
        vm.roll(block.number + 2);
        vm.prank(b);
        assertEq(rp.reveal(id), 40e6 - got);
        assertEq(USDT.balanceOf(address(rp)), 0);
    }

    function test_reservedSharesSurviveExpiryForTheGrace() public {
        vm.prank(sender);
        uint256 id = rp.create(USDT, 20e6, 2, 0, 1 days, key, true, false);
        address a = makeAddr("a");
        _claim(id, a);
        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 2);
        // the sender cannot sweep a reserved share during the grace period
        vm.expectRevert(RedPacket.NotYet.selector);
        rp.refund(id);
        vm.prank(a);
        uint256 got = rp.reveal(id);
        assertGt(got, 0);
        vm.warp(block.timestamp + 1 hours);
        uint256 before = USDT.balanceOf(sender);
        rp.refund(id);
        assertEq(USDT.balanceOf(sender) - before, 20e6 - got);
    }
}
