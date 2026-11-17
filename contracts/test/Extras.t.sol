// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Extras} from "../src/Extras.sol";
import {MockBEM, ShortToken} from "./OutfitMarketV2.t.sol";

contract MockPets is ERC721 {
    constructor() ERC721("Lingxi Pet", "PET") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

/// A buyer that holds BEM and has approved Extras, and tries to buy again from inside the token's pull. Because it
/// can pay, only the reentrancy guard stops the second purchase.
contract Reentrant {
    Extras public target;
    bool public tried;
    bytes public reason;

    function aim(Extras t, IERC20 bem) external {
        target = t;
        bem.approve(address(t), type(uint256).max);
    }

    function buy() external {
        target.buyLooks(target.price(1));
    }

    function onPull() external {
        if (tried) return;
        tried = true;
        try target.buyRoom(target.price(0)) {} catch (bytes memory r) {
            reason = r;
        }
    }
}

/// A token that hands control to the buyer while it is being pulled.
contract HookToken is MockBEM {
    function transferFrom(address from, address to, uint256 a) public override returns (bool) {
        if (from.code.length != 0) Reentrant(from).onPull();
        return super.transferFrom(from, to, a);
    }
}

/// A token that delivers less than asked when it sends to the dead address: the burn must be refused.
contract LeakyBurnToken is MockBEM {
    function transfer(address to, uint256 a) public override returns (bool) {
        if (to == address(0xdEaD)) a -= a / 100;
        return super.transfer(to, a);
    }
}

contract ExtrasTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint96 constant P = 0.05e8;
    MockBEM bem;
    MockPets pets;
    Extras extras;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    event PriceSet(uint8 indexed feature, uint96 price);
    event ColoursAdded(uint8 colours);
    event Bought(address indexed buyer, uint8 indexed feature, uint256 indexed detail, uint256 paid);
    event NameColoured(uint256 indexed petId, uint8 colour, address indexed by);
    event Burned(address indexed payer, uint256 amount);

    function setUp() public {
        bem = new MockBEM();
        pets = new MockPets();
        extras = new Extras(owner, IERC20(address(bem)), IERC721(address(pets)), 8, P, P, P);
        for (uint256 i; i < 2; ++i) {
            address who = i == 0 ? alice : bob;
            bem.mint(who, 10e8);
            vm.prank(who);
            bem.approve(address(extras), type(uint256).max);
        }
        pets.mint(alice, 1);
        pets.mint(bob, 2);
    }

    function _noCounters(address who) internal view {
        assertEq(extras.totalBurned(), 0);
        assertEq(extras.spentBy(who), 0);
        for (uint8 f; f < 3; ++f) {
            assertEq(extras.spentOn(f), 0);
            assertEq(extras.sold(f), 0);
        }
    }

    /* ── setting up ──────────────────────────────────────────────────────── */

    function test_constructorRefusesBadTerms() public {
        vm.expectRevert(Extras.BadTerms.selector);
        new Extras(owner, IERC20(address(0)), IERC721(address(pets)), 8, P, P, P);
        vm.expectRevert(Extras.BadTerms.selector);
        new Extras(owner, IERC20(address(bem)), IERC721(address(0)), 8, P, P, P);
        vm.expectRevert(Extras.BadTerms.selector);
        new Extras(owner, IERC20(address(bem)), IERC721(address(pets)), 0, P, P, P);
        vm.expectRevert(Extras.BadTerms.selector);
        new Extras(owner, IERC20(address(bem)), IERC721(address(pets)), 33, P, P, P);
        vm.expectRevert(Extras.BadTerms.selector);
        new Extras(owner, IERC20(address(bem)), IERC721(address(pets)), 8, 1, P, P);
        vm.expectRevert(Extras.BadTerms.selector);
        new Extras(owner, IERC20(address(bem)), IERC721(address(pets)), 8, P, 11e8, P);
        // 0 is allowed: off sale from the start
        Extras off = new Extras(owner, IERC20(address(bem)), IERC721(address(pets)), 8, 0, P, P);
        assertEq(off.price(0), 0);
    }

    function test_constructorAnnouncesItsTerms() public {
        vm.expectEmit();
        emit ColoursAdded(8);
        vm.expectEmit();
        emit PriceSet(0, P);
        vm.expectEmit();
        emit PriceSet(1, 0.07e8);
        vm.expectEmit();
        emit PriceSet(2, 0.1e8);
        new Extras(owner, IERC20(address(bem)), IERC721(address(pets)), 8, P, 0.07e8, 0.1e8);
    }

    /* ── room space and saved looks ──────────────────────────────────────── */

    function test_roomBurnsTheWholePriceAndAddsAPack() public {
        vm.expectEmit(address(extras));
        emit Bought(alice, 0, 1, P);
        vm.expectEmit(address(extras));
        emit Burned(alice, P);
        vm.prank(alice);
        extras.buyRoom(P);
        assertEq(extras.roomPacks(alice), 1);
        assertEq(bem.balanceOf(alice), 10e8 - P);
        assertEq(bem.balanceOf(DEAD), P);
        assertEq(bem.balanceOf(address(extras)), 0);
        assertEq(extras.totalBurned(), P);
        assertEq(extras.spentBy(alice), P);
        assertEq(extras.spentOn(0), P);
        assertEq(extras.sold(0), 1);
        assertEq(extras.roomPacks(bob), 0);
        assertEq(extras.lookPacks(alice), 0);
    }

    function test_looksBurnsTheWholePriceAndAddsAPack() public {
        vm.expectEmit(address(extras));
        emit Bought(bob, 1, 1, P);
        vm.prank(bob);
        extras.buyLooks(P);
        assertEq(extras.lookPacks(bob), 1);
        assertEq(extras.roomPacks(bob), 0);
        assertEq(bem.balanceOf(DEAD), P);
        assertEq(extras.spentOn(1), P);
        assertEq(extras.sold(1), 1);
    }

    function test_atMostThreePacksEach() public {
        vm.startPrank(alice);
        for (uint256 i; i < 3; ++i) {
            vm.expectEmit(address(extras));
            emit Bought(alice, 0, i + 1, P);
            extras.buyRoom(P);
            extras.buyLooks(P);
        }
        vm.expectRevert(Extras.Full.selector);
        extras.buyRoom(P);
        vm.expectRevert(Extras.Full.selector);
        extras.buyLooks(P);
        vm.stopPrank();
        assertEq(extras.roomPacks(alice), 3);
        assertEq(extras.lookPacks(alice), 3);
        assertEq(bem.balanceOf(DEAD), 6 * uint256(P));
        assertEq(extras.totalBurned(), 6 * uint256(P));
        assertEq(extras.sold(0), 3);
        assertEq(extras.sold(1), 3);
    }

    function test_refusesAMovedPriceAndAnExtraOffSaleAndCountsNothing() public {
        vm.prank(owner);
        extras.setPrice(0, 0.07e8);
        vm.prank(alice);
        vm.expectRevert(Extras.PriceMoved.selector);
        extras.buyRoom(P);
        vm.prank(owner);
        extras.setPrice(0, 0);
        vm.prank(alice);
        vm.expectRevert(Extras.NotForSale.selector);
        extras.buyRoom(0);
        assertEq(extras.roomPacks(alice), 0);
        assertEq(bem.balanceOf(alice), 10e8);
        _noCounters(alice);
    }

    function test_noAllowanceOrTooLittleBemMovesNothing() public {
        address carol = makeAddr("carol");
        bem.mint(carol, 1e8);
        vm.prank(carol);
        vm.expectRevert();
        extras.buyRoom(P);
        address dave = makeAddr("dave");
        bem.mint(dave, P - 1);
        vm.prank(dave);
        bem.approve(address(extras), type(uint256).max);
        vm.prank(dave);
        vm.expectRevert();
        extras.buyLooks(P);
        assertEq(extras.roomPacks(carol), 0);
        assertEq(extras.lookPacks(dave), 0);
        _noCounters(carol);
        _noCounters(dave);
    }

    function test_refusesATokenThatDeliversLess() public {
        ShortToken short = new ShortToken();
        Extras e = new Extras(owner, IERC20(address(short)), IERC721(address(pets)), 8, P, P, P);
        short.mint(alice, 1e8);
        vm.startPrank(alice);
        short.approve(address(e), type(uint256).max);
        vm.expectRevert(Extras.WrongPayment.selector);
        e.buyRoom(P);
        // the colour path pays the same way, and its colour is undone with the payment
        vm.expectRevert(Extras.WrongPayment.selector);
        e.setNameColour(1, 3, P);
        vm.stopPrank();
        assertEq(e.roomPacks(alice), 0);
        assertEq(e.nameColour(1), 0);
        assertEq(e.totalBurned(), 0);
        assertEq(e.sold(2), 0);
    }

    function test_refusesABurnThatArrivesShort() public {
        LeakyBurnToken leaky = new LeakyBurnToken();
        Extras e = new Extras(owner, IERC20(address(leaky)), IERC721(address(pets)), 8, P, P, P);
        leaky.mint(alice, 1e8);
        vm.startPrank(alice);
        leaky.approve(address(e), type(uint256).max);
        vm.expectRevert(Extras.BurnShort.selector);
        e.buyLooks(P);
        vm.stopPrank();
        assertEq(e.lookPacks(alice), 0);
        assertEq(leaky.balanceOf(alice), 1e8);
        assertEq(e.totalBurned(), 0);
    }

    function test_aPayingBuyerCannotReenterAPurchase() public {
        HookToken hook = new HookToken();
        Extras e = new Extras(owner, IERC20(address(hook)), IERC721(address(pets)), 8, P, P, P);
        Reentrant r = new Reentrant();
        hook.mint(address(r), 1e8);
        r.aim(e, IERC20(address(hook)));
        r.buy();
        assertTrue(r.tried());
        assertEq(r.reason(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(e.lookPacks(address(r)), 1);
        assertEq(e.roomPacks(address(r)), 0);
        assertEq(hook.balanceOf(address(r)), 1e8 - P);
    }

    function test_strayBemAlreadyHereDoesNotDisturbAPurchase() public {
        vm.prank(bob);
        bem.transfer(address(extras), 1e8);
        vm.prank(alice);
        extras.buyRoom(P);
        assertEq(bem.balanceOf(address(extras)), 1e8);
        assertEq(bem.balanceOf(DEAD), P);
        assertEq(extras.totalBurned(), P);
        assertEq(extras.strayBurned(), 0);
    }

    function testFuzz_anyAllowedPriceBurnsExactly(uint96 p, uint8 buys) public {
        p = uint96(bound(p, extras.MIN_PRICE(), extras.MAX_PRICE()));
        buys = uint8(bound(buys, 1, 3));
        vm.prank(owner);
        extras.setPrice(0, p);
        bem.mint(alice, uint256(p) * buys);
        uint256 before = bem.balanceOf(alice);
        vm.startPrank(alice);
        for (uint256 i; i < buys; ++i) extras.buyRoom(p);
        vm.stopPrank();
        assertEq(before - bem.balanceOf(alice), uint256(p) * buys);
        assertEq(bem.balanceOf(DEAD), uint256(p) * buys);
        assertEq(extras.roomPacks(alice), buys);
        assertEq(bem.balanceOf(address(extras)), 0);
    }

    /* ── name colours ────────────────────────────────────────────────────── */

    function test_ownerColoursAName() public {
        vm.expectEmit(address(extras));
        emit NameColoured(1, 3, alice);
        vm.expectEmit(address(extras));
        emit Bought(alice, 2, 1, P);
        vm.prank(alice);
        extras.setNameColour(1, 3, P);
        assertEq(extras.nameColour(1), 3);
        assertEq(bem.balanceOf(DEAD), P);
        assertEq(extras.spentOn(2), P);
        assertEq(extras.sold(2), 1);
    }

    function test_oneColourToAnotherIsPaidAgain() public {
        vm.startPrank(alice);
        extras.setNameColour(1, 3, P);
        extras.setNameColour(1, 5, P);
        vm.stopPrank();
        assertEq(extras.nameColour(1), 5);
        assertEq(extras.sold(2), 2);
        assertEq(bem.balanceOf(DEAD), 2 * uint256(P));
    }

    function test_plainIsFreeAndTheSameColourIsRefused() public {
        vm.startPrank(alice);
        extras.setNameColour(1, 3, P);
        vm.expectRevert(Extras.SameColour.selector);
        extras.setNameColour(1, 3, P);
        uint256 before = bem.balanceOf(alice);
        vm.expectEmit(address(extras));
        emit NameColoured(1, 0, alice);
        extras.setNameColour(1, 0, 0);
        assertEq(bem.balanceOf(alice), before);
        assertEq(extras.nameColour(1), 0);
        vm.expectRevert(Extras.SameColour.selector);
        extras.setNameColour(1, 0, 0);
        vm.stopPrank();
        assertEq(extras.sold(2), 1);
    }

    function test_plainStaysFreeWhileColoursAreOffSale() public {
        vm.prank(alice);
        extras.setNameColour(1, 2, P);
        vm.prank(owner);
        extras.setPrice(2, 0);
        vm.prank(alice);
        vm.expectRevert(Extras.NotForSale.selector);
        extras.setNameColour(1, 4, 0);
        vm.prank(alice);
        extras.setNameColour(1, 0, 0);
        assertEq(extras.nameColour(1), 0);
    }

    function test_onlyTheOwnerNotAnOperator() public {
        vm.prank(bob);
        vm.expectRevert(Extras.NotPetOwner.selector);
        extras.setNameColour(1, 2, P);
        vm.prank(alice);
        pets.approve(bob, 1);
        vm.prank(bob);
        vm.expectRevert(Extras.NotPetOwner.selector);
        extras.setNameColour(1, 2, P);
        // an operator for all of alice's pets still cannot change, or wipe for free, a colour she paid for
        vm.prank(alice);
        extras.setNameColour(1, 2, P);
        vm.prank(alice);
        pets.setApprovalForAll(bob, true);
        vm.prank(bob);
        vm.expectRevert(Extras.NotPetOwner.selector);
        extras.setNameColour(1, 0, 0);
        assertEq(extras.nameColour(1), 2);
        assertEq(extras.spentBy(bob), 0);
    }

    function test_refusesAColourNotOnOfferAndAPetThatDoesNotExist() public {
        vm.prank(alice);
        vm.expectRevert(Extras.BadColour.selector);
        extras.setNameColour(1, 9, P);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 99));
        extras.setNameColour(99, 1, P);
        _noCounters(alice);
    }

    function test_theColourStaysWithThePetWhenItChangesHands() public {
        vm.prank(alice);
        extras.setNameColour(1, 5, P);
        vm.prank(alice);
        pets.transferFrom(alice, bob, 1);
        assertEq(extras.nameColour(1), 5);
        vm.prank(alice);
        vm.expectRevert(Extras.NotPetOwner.selector);
        extras.setNameColour(1, 6, P);
        vm.prank(bob);
        extras.setNameColour(1, 6, P);
        assertEq(extras.nameColour(1), 6);
    }

    function test_aColourChangeRefusesAMovedPrice() public {
        vm.prank(owner);
        extras.setPrice(2, 0.1e8);
        vm.prank(alice);
        vm.expectRevert(Extras.PriceMoved.selector);
        extras.setNameColour(1, 1, P);
        assertEq(extras.nameColour(1), 0);
        _noCounters(alice);
    }

    function test_coloursOfReadsManyPets() public {
        vm.prank(alice);
        extras.setNameColour(1, 7, P);
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 42;
        uint8[] memory got = extras.coloursOf(ids);
        assertEq(got.length, 3);
        assertEq(got[0], 7);
        assertEq(got[1], 0);
        assertEq(got[2], 0);
    }

    /* ── the owner ───────────────────────────────────────────────────────── */

    function test_pricesOnlyWithinBoundsAndOnlyByTheOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        extras.setPrice(0, P);
        vm.startPrank(owner);
        vm.expectRevert(Extras.BadTerms.selector);
        extras.setPrice(0, 1e5 - 1);
        vm.expectRevert(Extras.BadTerms.selector);
        extras.setPrice(0, 10e8 + 1);
        vm.expectRevert(Extras.BadTerms.selector);
        extras.setPrice(3, P);
        vm.expectEmit(address(extras));
        emit PriceSet(1, 1e5);
        extras.setPrice(1, 1e5);
        extras.setPrice(2, 10e8);
        vm.stopPrank();
        assertEq(extras.price(1), 1e5);
        assertEq(extras.price(2), 10e8);
    }

    function test_coloursOnlyGrowToTheMaximum() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        extras.addColours(1);
        vm.startPrank(owner);
        vm.expectRevert(Extras.BadTerms.selector);
        extras.addColours(0);
        vm.expectRevert(Extras.BadTerms.selector);
        extras.addColours(25);
        vm.expectEmit(address(extras));
        emit ColoursAdded(32);
        extras.addColours(24);
        vm.expectRevert(Extras.BadTerms.selector);
        extras.addColours(1);
        vm.stopPrank();
        assertEq(extras.colours(), 32);
        vm.prank(alice);
        extras.setNameColour(1, 32, P);
        assertEq(extras.nameColour(1), 32);
    }

    function test_ownershipIsTwoStep() public {
        vm.prank(owner);
        extras.transferOwnership(bob);
        assertEq(extras.owner(), owner);
        vm.prank(alice);
        vm.expectRevert();
        extras.acceptOwnership();
        vm.prank(bob);
        extras.acceptOwnership();
        assertEq(extras.owner(), bob);
    }

    function test_strayBemIsBurnedByAnyoneAndCountedApart() public {
        vm.expectRevert(Extras.BadTerms.selector);
        extras.burnStray();
        vm.prank(alice);
        extras.buyRoom(P);
        vm.prank(alice);
        bem.transfer(address(extras), 3e8);
        vm.expectEmit(address(extras));
        emit Burned(bob, 3e8);
        vm.prank(bob);
        extras.burnStray();
        assertEq(bem.balanceOf(DEAD), 3e8 + uint256(P));
        assertEq(bem.balanceOf(address(extras)), 0);
        assertEq(extras.strayBurned(), 3e8);
        assertEq(extras.totalBurned(), 3e8 + uint256(P));
        assertEq(extras.spentOn(0), P);
        assertEq(extras.spentBy(bob), 0);
    }

    function test_extrasOfReadsEverythingInOneCall() public {
        vm.startPrank(alice);
        extras.buyRoom(P);
        extras.buyRoom(P);
        extras.buyLooks(P);
        vm.stopPrank();
        (uint8 room, uint8 looks, uint96 rp, uint96 lp, uint96 cp, uint8 n) = extras.extrasOf(alice);
        assertEq(room, 2);
        assertEq(looks, 1);
        assertEq(rp, P);
        assertEq(lp, P);
        assertEq(cp, P);
        assertEq(n, 8);
    }
}

/// Drives Extras with random purchases, colour changes, price changes and stray BEM for the invariant test.
contract ExtrasHandler is Test {
    Extras public immutable extras;
    MockBEM public immutable bem;
    MockPets public immutable pets;
    address public immutable owner;
    address[3] public buyers;
    uint256 public deadAtStart;

    constructor(Extras e, MockBEM b, MockPets p, address owner_) {
        extras = e;
        bem = b;
        pets = p;
        owner = owner_;
        for (uint256 i; i < 3; ++i) {
            address who = address(uint160(0xB0 + i));
            buyers[i] = who;
            b.mint(who, 1_000e8);
            vm.prank(who);
            b.approve(address(e), type(uint256).max);
            p.mint(who, 100 + i);
        }
    }

    function buyRoom(uint256 who) external {
        address b = buyers[who % 3];
        uint96 p = extras.price(0);
        vm.prank(b);
        try extras.buyRoom(p) {} catch {}
    }

    function buyLooks(uint256 who) external {
        address b = buyers[who % 3];
        uint96 p = extras.price(1);
        vm.prank(b);
        try extras.buyLooks(p) {} catch {}
    }

    function colour(uint256 who, uint8 c) external {
        uint256 i = who % 3;
        uint96 p = extras.price(2);
        vm.prank(buyers[i]);
        try extras.setNameColour(100 + i, uint8(bound(c, 0, extras.colours())), p) {} catch {}
    }

    function reprice(uint8 feature, uint96 p) external {
        p = uint96(bound(p, 0, extras.MAX_PRICE()));
        if (p != 0 && p < extras.MIN_PRICE()) p = extras.MIN_PRICE();
        vm.prank(owner);
        extras.setPrice(feature % 3, p);
    }

    function stray(uint256 who, uint256 amount) external {
        address b = buyers[who % 3];
        amount = bound(amount, 1, 1e8);
        vm.prank(b);
        bem.transfer(address(extras), amount);
        extras.burnStray();
    }
}

contract ExtrasInvariantTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    MockBEM bem;
    MockPets pets;
    Extras extras;
    ExtrasHandler handler;

    function setUp() public {
        bem = new MockBEM();
        pets = new MockPets();
        address owner = makeAddr("owner");
        extras = new Extras(owner, IERC20(address(bem)), IERC721(address(pets)), 8, 0.05e8, 0.05e8, 0.05e8);
        handler = new ExtrasHandler(extras, bem, pets, owner);
        targetContract(address(handler));
    }

    /// The contract never keeps BEM: every purchase and every stray burn leaves it empty.
    function invariant_holdsNoBem() public view {
        assertEq(bem.balanceOf(address(extras)), 0);
    }

    /// Everything counted as burned is at the dead address, and the total is exactly the extras plus stray BEM.
    function invariant_countersAddUpAndMatchTheDeadAddress() public view {
        assertEq(bem.balanceOf(DEAD), extras.totalBurned());
        assertEq(extras.totalBurned(), extras.spentOn(0) + extras.spentOn(1) + extras.spentOn(2) + extras.strayBurned());
        uint256 spent;
        for (uint256 i; i < 3; ++i) spent += extras.spentBy(handler.buyers(i));
        assertEq(spent, extras.spentOn(0) + extras.spentOn(1) + extras.spentOn(2));
    }

    /// No wallet ever holds more than three packs of either kind, and no pet a colour that is not offered.
    function invariant_packsAndColoursStayInBounds() public view {
        for (uint256 i; i < 3; ++i) {
            address b = handler.buyers(i);
            assertLe(extras.roomPacks(b), 3);
            assertLe(extras.lookPacks(b), 3);
            assertLe(extras.nameColour(100 + i), extras.colours());
        }
    }
}
