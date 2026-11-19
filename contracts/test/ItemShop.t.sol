// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {OutfitMarketV2} from "../src/OutfitMarketV2.sol";
import {ItemShop, IItemMarket} from "../src/ItemShop.sol";
import {MockBEM, ShortToken} from "./OutfitMarketV2.t.sol";

/// A buyer contract that tries to buy again from inside the copy it receives.
contract ShopReenterer is IERC1155Receiver {
    ItemShop immutable shop;
    uint256 immutable id;
    bool public tried;
    bool public succeeded;

    constructor(ItemShop shop_, IERC20 bem, uint256 id_) {
        shop = shop_;
        id = id_;
        bem.approve(address(shop_), type(uint256).max);
    }

    function go() external {
        shop.buy(id, 1, shop.price(id));
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        if (!tried) {
            tried = true;
            try shop.buy(id, 1, shop.price(id)) {
                succeeded = true;
            } catch {}
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 i) external pure returns (bool) {
        return i == type(IERC1155Receiver).interfaceId;
    }
}

contract ItemShopTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    MockBEM bem;
    OutfitMarketV2 market;
    ItemShop shop;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 signerKey = 0xA11CE5;
    address signer;
    uint256 lamp;
    uint256 banner;

    function setUp() public {
        signer = vm.addr(signerKey);
        bem = new MockBEM();
        market = new OutfitMarketV2(owner, IERC20(address(bem)));
        shop = new ItemShop(owner, IItemMarket(address(market)), IERC20(address(bem)), signer);
        vm.startPrank(owner);
        lamp = market.createItem("Star lamp", 500);
        banner = market.createItem("Together banner", 100_000);
        market.setMinter(lamp, address(shop), 500);
        market.setMinter(banner, address(shop), 100_000);
        shop.setPrice(lamp, 0.05e8);
        vm.stopPrank();
        bem.mint(alice, 10e8);
        bem.mint(bob, 10e8);
        vm.prank(alice);
        bem.approve(address(shop), type(uint256).max);
        vm.prank(bob);
        bem.approve(address(shop), type(uint256).max);
    }

    function _voucher(address to, uint256 id, uint32 q, uint256 nonce, uint64 exp) internal view returns (ItemShop.Voucher memory v, bytes memory sig) {
        v = ItemShop.Voucher({to: to, id: id, quantity: q, nonce: nonce, expiresAt: exp});
        (uint8 r8, bytes32 r, bytes32 s) = vm.sign(signerKey, shop.voucherDigest(v));
        sig = abi.encodePacked(r, s, r8);
    }

    /* ── buying ── */

    function test_buyBurnsTheWholePriceAndMints() public {
        vm.prank(alice);
        shop.buy(lamp, 3, 0.05e8);
        assertEq(market.balanceOf(alice, lamp), 3);
        assertEq(bem.balanceOf(alice), 10e8 - 0.15e8);
        assertEq(bem.balanceOf(DEAD), 0.15e8);
        assertEq(shop.totalBurned(), 0.15e8);
        assertEq(bem.balanceOf(address(shop)), 0);
        assertEq(shop.available(lamp), 497);
    }

    function test_burnEventsAddUpToTotalBurned() public {
        vm.recordLogs();
        vm.prank(alice);
        shop.buy(lamp, 1, 0.05e8);
        vm.prank(bob);
        shop.buy(lamp, 4, 0.05e8);
        uint256 sum;
        bytes32 burned = keccak256("Burned(address,uint256)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) if (logs[i].emitter == address(shop) && logs[i].topics[0] == burned) sum += abi.decode(logs[i].data, (uint256));
        assertEq(sum, 0.25e8);
        assertEq(sum, shop.totalBurned());
        assertEq(sum, bem.balanceOf(DEAD));
    }

    function test_wrongPriceIsRefused() public {
        vm.prank(alice);
        vm.expectRevert(ItemShop.PriceMoved.selector);
        shop.buy(lamp, 1, 0.04e8);
        vm.prank(owner);
        shop.setPrice(lamp, 0.06e8);
        vm.prank(alice);
        vm.expectRevert(ItemShop.PriceMoved.selector);
        shop.buy(lamp, 1, 0.05e8);
        assertEq(bem.balanceOf(alice), 10e8);
    }

    function test_notForSaleAndBadQuantities() public {
        vm.prank(alice);
        vm.expectRevert(ItemShop.NotForSale.selector);
        shop.buy(banner, 1, 0);
        vm.prank(alice);
        vm.expectRevert(ItemShop.BadTerms.selector);
        shop.buy(lamp, 0, 0.05e8);
        vm.prank(alice);
        vm.expectRevert(ItemShop.BadTerms.selector);
        shop.buy(lamp, 11, 0.05e8);
        vm.prank(owner);
        shop.setPrice(lamp, 0);
        vm.prank(alice);
        vm.expectRevert(ItemShop.NotForSale.selector);
        shop.buy(lamp, 1, 0.05e8);
    }

    function test_soldOutAtTheGrant() public {
        vm.prank(owner);
        market.setMinter(lamp, address(shop), 2);
        vm.prank(alice);
        shop.buy(lamp, 2, 0.05e8);
        vm.prank(bob);
        vm.expectRevert(OutfitMarketV2.NotMinter.selector);
        shop.buy(lamp, 1, 0.05e8);
        assertEq(bem.balanceOf(bob), 10e8);
        assertEq(shop.available(lamp), 0);
    }

    function test_priceBoundsAndOwnerOnly() public {
        vm.startPrank(owner);
        vm.expectRevert(ItemShop.BadTerms.selector);
        shop.setPrice(lamp, 1e5 - 1);
        vm.expectRevert(ItemShop.BadTerms.selector);
        shop.setPrice(lamp, 10e8 + 1);
        shop.setPrice(lamp, 10e8);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert();
        shop.setPrice(lamp, 1e5);
        vm.prank(alice);
        vm.expectRevert();
        shop.setSigner(alice);
    }

    function test_shortTokenIsRefused() public {
        ShortToken t = new ShortToken();
        OutfitMarketV2 m2 = new OutfitMarketV2(owner, IERC20(address(t)));
        ItemShop s2 = new ItemShop(owner, IItemMarket(address(m2)), IERC20(address(t)), signer);
        vm.startPrank(owner);
        uint256 id = m2.createItem("Lamp", 10);
        m2.setMinter(id, address(s2), 10);
        s2.setPrice(id, 0.05e8);
        vm.stopPrank();
        t.mint(alice, 1e8);
        vm.startPrank(alice);
        t.approve(address(s2), type(uint256).max);
        vm.expectRevert(ItemShop.WrongPayment.selector);
        s2.buy(id, 1, 0.05e8);
        vm.stopPrank();
    }

    function test_aBuyerCannotReenterFromItsCallback() public {
        ShopReenterer r = new ShopReenterer(shop, IERC20(address(bem)), lamp);
        bem.mint(address(r), 1e8);
        r.go();
        assertTrue(r.tried());
        assertFalse(r.succeeded());
        assertEq(market.balanceOf(address(r), lamp), 1);
        assertEq(shop.totalBurned(), 0.05e8);
    }

    function test_strayBemCanOnlyBeBurned() public {
        vm.expectRevert(ItemShop.BadTerms.selector);
        shop.burnStray();
        vm.prank(alice);
        bem.transfer(address(shop), 0.3e8);
        vm.prank(bob);
        shop.burnStray();
        assertEq(bem.balanceOf(address(shop)), 0);
        assertEq(bem.balanceOf(DEAD), 0.3e8);
        assertEq(shop.totalBurned(), 0.3e8);
    }

    /* ── vouchers ── */

    function test_voucherClaimsOnceToItsRecipient() public {
        (ItemShop.Voucher memory v, bytes memory sig) = _voucher(alice, banner, 1, 7, uint64(block.timestamp + 1 days));
        vm.prank(bob); // anyone may submit it; the copy goes to alice
        shop.claim(v, sig);
        assertEq(market.balanceOf(alice, banner), 1);
        assertEq(market.balanceOf(bob, banner), 0);
        assertTrue(shop.usedNonce(7));
        vm.expectRevert(ItemShop.Used.selector);
        shop.claim(v, sig);
    }

    function test_expiredVoucherIsRefused() public {
        (ItemShop.Voucher memory v, bytes memory sig) = _voucher(alice, banner, 1, 8, uint64(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(ItemShop.Expired.selector);
        shop.claim(v, sig);
    }

    function test_tamperedVoucherIsRefused() public {
        (ItemShop.Voucher memory v, bytes memory sig) = _voucher(alice, banner, 1, 9, uint64(block.timestamp + 1 days));
        // each tampered copy is a fresh struct (assigning a memory struct only copies the reference)
        ItemShop.Voucher[4] memory bad = [
            ItemShop.Voucher(bob, v.id, v.quantity, v.nonce, v.expiresAt),
            ItemShop.Voucher(v.to, v.id, 5, v.nonce, v.expiresAt),
            ItemShop.Voucher(v.to, lamp, v.quantity, v.nonce, v.expiresAt),
            ItemShop.Voucher(v.to, v.id, v.quantity, v.nonce, v.expiresAt + 1)
        ];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.expectRevert(ItemShop.BadSignature.selector);
            shop.claim(bad[i], sig);
        }
        shop.claim(v, sig);
        assertEq(market.balanceOf(alice, banner), 1);
    }

    function test_wrongSignerAndJunkSignatureAreRefused() public {
        ItemShop.Voucher memory v = ItemShop.Voucher({to: alice, id: banner, quantity: 1, nonce: 10, expiresAt: uint64(block.timestamp + 1 days)});
        (uint8 r8, bytes32 r, bytes32 s) = vm.sign(0xB0B, shop.voucherDigest(v));
        vm.expectRevert(ItemShop.BadSignature.selector);
        shop.claim(v, abi.encodePacked(r, s, r8));
        vm.expectRevert(ItemShop.BadSignature.selector);
        shop.claim(v, hex"1234");
        // a voucher signed for another shop (another verifying contract) does not work here
        ItemShop other = new ItemShop(owner, IItemMarket(address(market)), IERC20(address(bem)), signer);
        (r8, r, s) = vm.sign(signerKey, other.voucherDigest(v));
        vm.expectRevert(ItemShop.BadSignature.selector);
        shop.claim(v, abi.encodePacked(r, s, r8));
    }

    function test_aNewSignerRetiresTheOldOnesVouchers() public {
        (ItemShop.Voucher memory v, bytes memory sig) = _voucher(alice, banner, 1, 11, uint64(block.timestamp + 1 days));
        vm.prank(owner);
        shop.setSigner(makeAddr("newSigner"));
        vm.expectRevert(ItemShop.BadSignature.selector);
        shop.claim(v, sig);
    }

    function test_copiesResellOnTheMarketWithItsFeeBurned() public {
        vm.prank(alice);
        shop.buy(lamp, 1, 0.05e8);
        vm.prank(alice);
        uint256 lid = market.list(lamp, 1, 0.2e8, uint64(block.timestamp + 1 days), address(0));
        vm.prank(bob);
        bem.approve(address(market), type(uint256).max);
        vm.prank(bob);
        market.buy(lid, 1, 0.2e8);
        assertEq(market.balanceOf(bob, lamp), 1);
        assertEq(bem.balanceOf(DEAD), 0.05e8 + 0.006e8);
    }

    /* ── refusals at the edges ── */

    function test_theShopNeedsAMarketBemAndASigner() public {
        IItemMarket m = IItemMarket(address(market));
        IERC20 b = IERC20(address(bem));
        vm.expectRevert(ItemShop.BadTerms.selector);
        new ItemShop(owner, IItemMarket(address(0)), b, signer);
        vm.expectRevert(ItemShop.BadTerms.selector);
        new ItemShop(owner, m, IERC20(address(0)), signer);
        vm.expectRevert(ItemShop.BadTerms.selector);
        new ItemShop(owner, m, b, address(0));
    }

    /// Signed by the real key, a voucher is still refused if it names nobody, nothing or more than ten copies, and
    /// its nonce stays unused.
    function test_aSignedVoucherForNobodyNothingOrTooMuchIsRefused() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        (ItemShop.Voucher memory toNobody, bytes memory s1) = _voucher(address(0), banner, 1, 21, exp);
        (ItemShop.Voucher memory nothing, bytes memory s2) = _voucher(alice, banner, 0, 22, exp);
        (ItemShop.Voucher memory tooMany, bytes memory s3) = _voucher(alice, banner, 11, 23, exp);
        vm.expectRevert(ItemShop.BadTerms.selector);
        shop.claim(toNobody, s1);
        vm.expectRevert(ItemShop.BadTerms.selector);
        shop.claim(nothing, s2);
        vm.expectRevert(ItemShop.BadTerms.selector);
        shop.claim(tooMany, s3);
        assertFalse(shop.usedNonce(21));
        assertFalse(shop.usedNonce(22));
        assertFalse(shop.usedNonce(23));
        (ItemShop.Voucher memory ten, bytes memory s4) = _voucher(alice, banner, 10, 24, exp);
        shop.claim(ten, s4);
        assertEq(market.balanceOf(alice, banner), 10);
    }

    function test_theSignerCanNeverBeSetToTheZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ItemShop.BadTerms.selector);
        shop.setSigner(address(0));
        assertEq(shop.signer(), signer);
    }
}

import {Vm} from "forge-std/Vm.sol";
