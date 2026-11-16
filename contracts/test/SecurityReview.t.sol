// SPDX-License-Identifier: MIT
// Proof tests from the independent security re-review (research/run/reviews/outfitmarketv2-holdergift-review.md), kept as regression tests.
pragma solidity 0.8.28;

import {Test, stdJson} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {OutfitMarketV2} from "../src/OutfitMarketV2.sol";
import {HolderGift, IGiftMarket} from "../src/HolderGift.sol";
import {BreederV2} from "../src/BreederV2.sol";
import {PetRegistry} from "../src/PetRegistry.sol";
import {MockBEM} from "./OutfitMarketV2.t.sol";
import {MockNFT} from "./HolderGift.t.sol";
import {BreederV2ForkTest} from "./BreederV2.fork.t.sol";

/* ── market: the fixes and what they could have broken ───────────────────── */

contract Review2MarketTest is Test {
    OutfitMarketV2 m;
    MockBEM bem;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11);
    address creator = address(0xC0);
    address alice = address(0xA1);
    address bob = address(0xB0);
    address carol = address(0xCA);
    uint96 constant ONE = 1e8;
    bytes hat = hex"00030202ff0000ffff00a50a";

    function setUp() public {
        bem = new MockBEM();
        m = new OutfitMarketV2(owner, IERC20(address(bem)));
        address[4] memory people = [alice, bob, creator, carol];
        for (uint256 i = 0; i < 4; i++) {
            bem.mint(people[i], 1_000_000 * uint256(ONE));
            vm.prank(people[i]);
            bem.approve(address(m), type(uint256).max);
        }
    }

    function _until() internal view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    /// The remainder of a partly bought listing stays buyable; the seller's other listings of the type retire;
    /// isLive agrees with buy in every case.
    function test_partialFillKeepsRemainderAndRetiresTheRest() public {
        vm.prank(creator);
        uint256 id = m.create(hat, "Red cap", ONE, 100, 500);
        vm.prank(alice);
        m.mint(id, 5, ONE);
        vm.startPrank(alice);
        uint256 a = m.list(id, 3, 2 * ONE, _until(), address(0));
        uint256 b = m.list(id, 2, 3 * ONE, _until(), address(0));
        vm.stopPrank();
        vm.prank(bob);
        m.buy(a, 1, 2 * ONE);
        assertTrue(m.isLive(a));
        assertFalse(m.isLive(b));
        vm.prank(carol);
        vm.expectRevert(OutfitMarketV2.NoListing.selector);
        m.buy(b, 1, 3 * ONE);
        vm.prank(carol);
        m.buy(a, 2, 2 * ONE); // the re-stamped remainder
        assertFalse(m.isLive(a));
        assertEq(m.balanceOf(carol, id), 2);
    }

    /// A listing made before a fee raise pays the lower fee; one made before a fee cut pays the lower (current) fee.
    function test_feeIsTheLowerOfListedAndCurrent() public {
        vm.prank(creator);
        uint256 id = m.create(hat, "Red cap", ONE, 100, 0);
        vm.prank(alice);
        m.mint(id, 2, ONE);
        vm.prank(alice);
        uint256 a = m.list(id, 1, 100 * ONE, _until(), address(0)); // listed at 3%
        vm.prank(owner);
        m.setFee(500);
        vm.prank(alice);
        uint256 b = m.list(id, 1, 100 * ONE, _until(), address(0)); // listed at 5%
        vm.prank(owner);
        m.setFee(100);

        uint256 burned = m.totalBurned();
        vm.prank(bob);
        m.buy(a, 1, 100 * ONE);
        assertEq(m.totalBurned() - burned, 1 * uint256(ONE)); // min(3%, 1%)
        // listing b was retired by the sale of a (same seller, same type)
        assertFalse(m.isLive(b));
    }

    /// Fee rounded up plus royalty rounded down never exceed the total, at any price the market accepts.
    function testFuzz_splitNeverUnderflows(uint96 price, uint32 q, uint16 fee, uint16 roy) public {
        price = uint96(bound(price, m.MIN_PRICE(), 1e12));
        q = uint32(bound(q, 1, 50));
        fee = uint16(bound(fee, 0, 500));
        roy = uint16(bound(roy, 0, 1000));
        vm.prank(creator);
        uint256 id = m.create(hat, "Red cap", price, 100_000, roy);
        vm.prank(alice);
        m.mint(id, q, price);
        vm.prank(owner);
        m.setFee(fee);
        vm.prank(alice);
        uint256 l = m.list(id, q, price, _until(), address(0));
        uint256 before = m.totalBurned();
        vm.prank(bob);
        m.buy(l, q, price);
        uint256 total = uint256(price) * q;
        uint256 burned = m.totalBurned() - before;
        assertLe(burned, (total * fee) / 10_000 + 1);
        assertEq(bem.balanceOf(address(m)), m.totalOwed());
    }

    /// burnStray burns only what nobody is owed, and moves no owed BEM.
    function test_burnStrayTakesOnlyTheExcess() public {
        vm.prank(creator);
        uint256 id = m.create(hat, "Red cap", ONE, 100, 0);
        vm.prank(alice);
        m.mint(id, 1, ONE);
        vm.expectRevert(OutfitMarketV2.NothingOwed.selector);
        m.burnStray();
        vm.prank(bob);
        bem.transfer(address(m), 7 * uint256(ONE));
        uint256 dead = bem.balanceOf(DEAD);
        vm.prank(carol);
        m.burnStray();
        assertEq(bem.balanceOf(DEAD) - dead, 7 * uint256(ONE));
        assertEq(bem.balanceOf(address(m)), m.totalOwed());
        assertEq(m.totalBurned(), bem.balanceOf(DEAD));
        vm.prank(creator);
        m.withdraw();
        assertEq(bem.balanceOf(address(m)), 0);
    }

    /// Item kinds follow the current owner; the old owner loses them at once.
    function test_itemsFollowTheCurrentOwner() public {
        vm.prank(owner);
        uint256 item = m.createItem("Lantern", 10);
        address next = address(0x2222);
        vm.prank(owner);
        m.transferOwnership(next);
        vm.prank(next);
        m.acceptOwnership();
        vm.prank(owner);
        vm.expectRevert(OutfitMarketV2.NotCreator.selector);
        m.setMinter(item, owner, 10);
        vm.prank(next);
        m.setMinter(item, next, 10);
    }

    /// Info: any buyer can retire a seller's other listings of a type by buying one copy (it costs the price).
    function test_info_oneCopyPurchaseRetiresTheSellersOtherListings() public {
        vm.prank(creator);
        uint256 id = m.create(hat, "Red cap", ONE, 100, 0);
        uint96 minPrice = m.MIN_PRICE();
        vm.prank(alice);
        m.mint(id, 10, ONE);
        vm.startPrank(alice);
        uint256 cheapOne = m.list(id, 1, minPrice, _until(), address(0));
        uint256 bulk = m.list(id, 9, 5 * ONE, _until(), address(0));
        vm.stopPrank();
        vm.prank(bob);
        m.buy(cheapOne, 1, minPrice);
        assertFalse(m.isLive(bulk));
    }
}

/* ── stateful invariants against the new market ─────────────────────────── */

contract Handler2 is Test {
    OutfitMarketV2 public m;
    MockBEM public bem;
    address[4] public actors;
    uint256[] public ids;
    uint256[] public lids;
    uint256 public okBuys;
    uint256 public okMints;
    uint256 public okWithdraws;
    bool public liveButFailed;

    constructor(OutfitMarketV2 m_, MockBEM bem_, address[4] memory a) {
        m = m_;
        bem = bem_;
        actors = a;
        for (uint256 i = 0; i < 4; i++) {
            bem.mint(a[i], 1e18);
            vm.prank(a[i]);
            bem.approve(address(m), type(uint256).max);
        }
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(a[i]);
            ids.push(m.create(hex"00030202ff0000ffff00a50a", "x", uint96(10_000 + i * 7_777_777), 50_000, uint16(i * 450)));
        }
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[s % 4];
    }

    function mint(uint256 s, uint256 d, uint32 q) external {
        uint256 id = ids[d % ids.length];
        q = uint32(bound(q, 1, 20));
        uint96 price = m.design(id).price;
        vm.prank(_a(s));
        try m.mint(id, q, price) {
            okMints++;
        } catch {}
    }

    function list(uint256 s, uint256 d, uint32 q, uint96 p, uint256 b) external {
        uint256 id = ids[d % ids.length];
        address seller = _a(s);
        uint256 held = m.balanceOf(seller, id);
        if (held == 0) return;
        q = uint32(bound(q, 1, held));
        p = uint96(bound(p, 10_000, 1e12));
        address buyer = b % 3 == 0 ? _a(s + 1 + (b / 3) % 3) : address(0);
        vm.prank(seller);
        lids.push(m.list(id, q, p, uint64(block.timestamp + 1 days), buyer));
    }

    function buy(uint256 s, uint256 l, uint32 q) external {
        if (lids.length == 0) return;
        uint256 lid = lids[l % lids.length];
        (address seller,, uint32 lq, uint96 priceEach,,, address named,) = m.listings(lid);
        if (seller == address(0)) return;
        address who = named != address(0) ? named : _a(s);
        if (who == seller) who = _a(s + 1);
        q = uint32(bound(q, 1, lq));
        bool live = m.isLive(lid);
        if (live && q == lq && named != address(0) && named == seller) live = false;
        vm.prank(who);
        try m.buy(lid, q, priceEach) {
            okBuys++;
        } catch {
            // isLive true means a full buy must succeed
            if (live && q == lq) liveButFailed = true;
        }
    }

    function transfer(uint256 s, uint256 t, uint256 d, uint256 v) external {
        uint256 id = ids[d % ids.length];
        address from = _a(s);
        v = bound(v, 0, m.balanceOf(from, id));
        vm.prank(from);
        m.safeTransferFrom(from, _a(t), id, v, "");
    }

    function withdraw(uint256 s) external {
        vm.prank(_a(s));
        try m.withdraw() {
            okWithdraws++;
        } catch {}
    }

    function donateAndBurn(uint256 s, uint96 v) external {
        v = uint96(bound(v, 1, 1e10));
        vm.prank(_a(s));
        bem.transfer(address(m), v);
        m.burnStray();
    }

    function setFee(uint16 f) external {
        vm.prank(m.owner());
        m.setFee(uint16(bound(f, 0, 500)));
    }

    function warp(uint256 t) external {
        vm.warp(block.timestamp + bound(t, 0, 2 days));
    }

    function sumOwed() external view returns (uint256 x) {
        for (uint256 i = 0; i < 4; i++) x += m.owed(actors[i]);
    }
}

contract Review2InvariantTest is Test {
    OutfitMarketV2 m;
    MockBEM bem;
    Handler2 h;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        bem = new MockBEM();
        m = new OutfitMarketV2(address(0xA11), IERC20(address(bem)));
        h = new Handler2(m, bem, [address(0x1001), address(0x1002), address(0x1003), address(0x1004)]);
        targetContract(address(h));
    }

    function invariant_balanceEqualsTotalOwedEqualsSum() public view {
        assertEq(bem.balanceOf(address(m)), m.totalOwed());
        assertEq(m.totalOwed(), h.sumOwed());
    }

    function invariant_totalBurnedEqualsDeadBalance() public view {
        assertEq(m.totalBurned(), bem.balanceOf(DEAD));
    }

    function invariant_isLiveNeverLies() public view {
        assertFalse(h.liveButFailed());
    }

    function afterInvariant() public {
        emit log_named_uint("successful mints", h.okMints());
        emit log_named_uint("successful buys", h.okBuys());
        emit log_named_uint("successful withdraws", h.okWithdraws());
    }
}

/* ── HolderGift: the leaf format equals @openzeppelin/merkle-tree's ──────── */

contract Review2GiftTest is Test {
    OutfitMarketV2 m;
    HolderGift g;
    uint256 outfit;
    address owner = address(0xA11);
    // produced by StandardMerkleTree.of(entries, ["address","uint256","uint256"]) from @openzeppelin/merkle-tree
    // (packages/chain node_modules) for the five entries below, in that order
    bytes32 constant ROOT = 0xe07d06643ac4a333787b1385e47fec6c42945e5ae71776725aa83cff44265ded;

    function setUp() public {
        MockBEM bem = new MockBEM();
        m = new OutfitMarketV2(owner, IERC20(address(bem)));
        vm.prank(owner);
        outfit = m.create(hex"00030202ff0000ffff00a50a", "Holder pin", 0, 1000, 0);
        g = new HolderGift(IGiftMarket(address(m)), outfit, address(new MockNFT("T1")), address(new MockNFT("R")), ROOT, 76_000_000, 0.1e8, 10e8);
        vm.prank(owner);
        m.setMinter(outfit, address(g), 999);
    }

    function _p(bytes32 a, bytes32 b, bytes32 c) internal pure returns (bytes32[] memory p) {
        uint256 n = c == bytes32(0) ? 2 : 3;
        p = new bytes32[](n);
        p[0] = a;
        p[1] = b;
        if (n == 3) p[2] = c;
    }

    function test_proofsFromTheJsLibraryVerify() public {
        vm.prank(address(0xa1));
        g.claimWithSnapshot(50000000, 0, _p(0xe25ceb42e231e8c93c3d64dfb08c19ad5ce59804a17ac178f3d5dd84c1cc2cf6, 0x6c401ce6ab47cb316f571c18406a24bd2858c38a7df7a59e8d8c4ec98aff6d71, 0));
        vm.prank(address(0xb0));
        g.claimWithSnapshot(0, 2000000000, _p(0x9bc89d43b89caefe2e51d0fe481d14271dac368a586cd7fb6ac2c9bcdee09668, 0xf202d8d7f79006b5ba539ea2d157acb5fd822140f8739d2a88a39d5caf73cea0, 0x05a328f55747d5ccecb7f704dab18ac79a47534f12e6be0875429deec750fb9d));
        vm.prank(address(0xda));
        g.claimWithSnapshot(10000000, 0, _p(0x54f4edd3dd8b7d93cb0414a22f42dd6aaf17f474aad2ec82627a43c33e66aa96, 0x05a328f55747d5ccecb7f704dab18ac79a47534f12e6be0875429deec750fb9d, 0));
        vm.prank(address(0xee));
        g.claimWithSnapshot(123456789, 987654321, _p(0xdf0ca73c020ebea021cf7dc03ed7156696bf5e4f4d2e4aa2f07acec936f22093, 0x6c401ce6ab47cb316f571c18406a24bd2858c38a7df7a59e8d8c4ec98aff6d71, 0));
        assertEq(g.total(), 4);
        // in the tree but under both minimums
        vm.prank(address(0xca));
        vm.expectRevert(HolderGift.NotHolder.selector);
        g.claimWithSnapshot(9000000, 900000000, _p(0xb89d1eb94c0326a37810f0e9d78baa5fcd7347c345cb3294cdc2cd4d182b10ec, 0xf202d8d7f79006b5ba539ea2d157acb5fd822140f8739d2a88a39d5caf73cea0, 0x05a328f55747d5ccecb7f704dab18ac79a47534f12e6be0875429deec750fb9d));
    }

    /// An inner node presented as a leaf (64-byte preimage) cannot be claimed: leaves are double-hashed.
    function test_innerNodeIsNotALeaf() public {
        vm.prank(address(0xa1));
        vm.expectRevert(HolderGift.NotHolder.selector);
        g.claimWithSnapshot(uint256(0xe25ceb42e231e8c93c3d64dfb08c19ad5ce59804a17ac178f3d5dd84c1cc2cf6), 0, new bytes32[](0));
    }
}

/* ── BreederV2: re-entry through the child's ERC-721 receipt (X Layer fork) ── */

contract Reentrant721 is IERC721Receiver {
    BreederV2 public b;
    uint256 public pa;
    uint256 public pb;
    address public proc;
    uint64 public childBrain;
    bool public armed;
    bytes public sameParents;
    bytes public withKid;

    function setUp(BreederV2 b_, IERC20 bem, uint256 a_, uint256 c_, address proc_, uint64 brain_) external {
        b = b_;
        pa = a_;
        pb = c_;
        proc = proc_;
        childBrain = brain_;
        bem.approve(address(b_), type(uint256).max);
    }

    function go() external returns (uint256) {
        armed = true;
        return b.breed(pa, pb, proc, childBrain, 0, type(uint256).max);
    }

    function onERC721Received(address, address, uint256 kid, bytes calldata) external returns (bytes4) {
        if (armed) {
            armed = false;
            try b.breed(pa, pb, proc, childBrain, 0, type(uint256).max) {} catch (bytes memory e) {
                sameParents = e;
            }
            try b.breed(kid, pa, proc, childBrain, 0, type(uint256).max) {} catch (bytes memory e) {
                withKid = e;
            }
        }
        return this.onERC721Received.selector;
    }
}

contract Review2BreederForkTest is BreederV2ForkTest {
    using stdJson for string;

    function test_review2_reentryOnHatchCannotBreedAgain() public {
        uint64 child = _child(brainA, brainB, fx.readBytes(".glue"));
        Reentrant721 r = new Reentrant721();
        vm.startPrank(alice);
        reg.transferFrom(alice, address(r), petA);
        reg.transferFrom(alice, address(r), petB);
        vm.stopPrank();
        deal(address(BEM), address(r), 10e8);
        r.setUp(breeder, BEM, petA, petB, address(PROC), child);
        uint256 dead = BEM.balanceOf(DEAD);
        uint256 kid = r.go();
        assertEq(reg.ownerOf(kid), address(r));
        assertEq(BEM.balanceOf(DEAD) - dead, FEE); // one child, one fee
        assertEq(breeder.children(petA), 1);
        assertEq(bytes4(r.sameParents()), BreederV2.TooSoon.selector);
        assertEq(bytes4(r.withKid()), BreederV2.NotFirstGeneration.selector);
    }
}
