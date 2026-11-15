// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface ISealProcessor {
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
}

interface IPetMembers {
    function ownerOf(uint256 petId) external view returns (address);
    /// true when the pet is at least a day old and has saved at least one day on chain
    function isSettled(uint256 petId) external view returns (bool);
}

/// @title Lingxi red packets
/// @notice A pet carries a red packet to friends: tokens held here in escrow, opened
/// by whoever has the link, with each claim decided by a TapeOut seal circuit
/// (LX-SEAL/1) that anyone can re-run with the processor's free `eval`.
///
/// The link carries a one-time key. Claiming needs that key's signature over the
/// claimer's own address, so a claim seen in the mempool cannot be taken over by
/// anyone else. Each address takes one slot per packet. Unclaimed tokens go back to
/// the sender after expiry; anyone may trigger that refund, and it only ever pays
/// the sender (or an address the sender names).
///
/// A lucky split is decided in two steps so nobody can pick a good moment to claim:
/// `claim` reserves a slot and records the block; `reveal` (at least two blocks
/// later) draws the seed from the hash of the block right after the reservation,
/// which did not exist when the claimer committed. Revealing more than 256 blocks
/// late, when that hash is gone, earns the smallest weight. Each lucky claimer is
/// paid the floor plus a slice of the pool by their own weight at once, and when the
/// last share opens the rest of the pool is shared out by weight (collected with
/// `collect`), so the final split is exact and does not depend on who revealed
/// when. If some never open theirs, at expiry those who did still share the rest of
/// the pool by weight, and only the floors of the unopened shares go back. X Layer's sequencer could in principle steer a
/// block hash; that trust assumption is stated on the claim screen.
contract RedPacket is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SHARES = 16;
    uint256 public constant MAX_LIFETIME = 30 days;
    /// time after expiry in which reserved lucky shares can still be revealed
    uint256 public constant REVEAL_GRACE = 1 hours;

    struct Packet {
        address sender;
        uint64 expiry;
        uint16 count;
        uint16 claimed; // slots taken (reserved or paid)
        uint16 paid; // shares paid out
        bool lucky;
        bool petOwnersOnly;
        IERC20 token;
        address key;
        uint128 remaining;
        uint128 floor;
        uint128 extra; // what was above the floors at funding: the pool a lucky split draws from
    }

    struct Pending {
        uint64 atBlock;
        uint16 index;
        bool member;
    }

    ISealProcessor public immutable processor;
    uint256 public immutable sealId;
    IPetMembers public immutable pets;

    uint256 public nextId = 1;
    mapping(uint256 => Packet) private _packets;
    mapping(uint256 => mapping(address => uint256)) public claimedBy;
    /// an address takes one slot per packet, whatever its share turns out to be
    mapping(uint256 => mapping(address => bool)) public tookSlot;
    /// a pet opens a pet-owners-only packet once, whoever holds it
    mapping(uint256 => mapping(uint256 => bool)) public petUsed;
    mapping(uint256 => mapping(address => Pending)) public pending;
    /// tokens a packet may hold (plain ERC-20s such as USDT; no rebasing tokens)
    mapping(address => bool) public allowedToken;
    /// lucky split: who revealed with which weight, so the leftover pool can be shared out by weight
    mapping(uint256 => address[]) private _luckyPaid;
    mapping(uint256 => uint8[]) private _luckyWeight;
    mapping(uint256 => uint256) public weightSum;
    /// top-ups owed once every share of a lucky packet is open (pull: `collect`)
    mapping(uint256 => mapping(address => uint256)) public owed;
    mapping(uint256 => bool) public settled;

    event Created(uint256 indexed id, address indexed sender, address token, uint256 total, uint16 count, bool lucky, bool petOwnersOnly, uint64 expiry);
    event Claimed(uint256 indexed id, address indexed claimer, uint256 amount, uint16 index, uint16 sealInput, uint8 sealOutput);
    event Reserved(uint256 indexed id, address indexed claimer, uint16 index, uint64 atBlock);
    event Refunded(uint256 indexed id, address indexed sender, address to, uint256 amount);
    event TokenAllowed(address indexed token, bool allowed);
    event Settled(uint256 indexed id, uint256 sharedOut);
    event Collected(uint256 indexed id, address indexed claimer, uint256 amount);

    error BadShares();
    error BadLifetime();
    error TooSmall();
    error NoKey();
    error Unknown();
    error Expired();
    error AllClaimed();
    error AlreadyClaimed();
    error BadKey();
    error SealSaysNo();
    error NotYet();
    error Empty();
    error NothingToReveal();
    error TooEarly();
    error TokenNotAllowed();
    error NotYourPet();
    error PetUsed();
    error NotSender();

    constructor(ISealProcessor processor_, uint256 sealId_, IPetMembers pets_, address owner_, address[] memory tokens) Ownable(owner_) {
        processor = processor_;
        sealId = sealId_;
        pets = pets_;
        for (uint256 i = 0; i < tokens.length; i++) {
            allowedToken[tokens[i]] = true;
            emit TokenAllowed(tokens[i], true);
        }
    }

    function setToken(address token, bool allowed) external onlyOwner {
        allowedToken[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    /// @notice Fund a red packet. `key` is the address of the one-time key the link carries.
    /// `floor` is the least any share may be (0 = total / (count × 4)); it can never be zero.
    function create(IERC20 token, uint256 total, uint16 count, uint128 floor, uint64 lifetime, address key, bool lucky, bool petOwnersOnly)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (count == 0 || count > MAX_SHARES) revert BadShares();
        if (lifetime == 0 || lifetime > MAX_LIFETIME) revert BadLifetime();
        if (key == address(0)) revert NoKey();
        if (!allowedToken[address(token)]) revert TokenNotAllowed();
        // measure what actually arrived, so fee-taking tokens cannot overstate the escrow
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        uint256 got = token.balanceOf(address(this)) - before;
        uint256 f = floor == 0 ? got / (uint256(count) * 4) : floor;
        if (f == 0 || f * count > got || got > type(uint128).max) revert TooSmall();
        id = nextId++;
        _packets[id] = Packet({
            sender: msg.sender,
            expiry: uint64(block.timestamp) + lifetime,
            count: count,
            claimed: 0,
            paid: 0,
            lucky: lucky,
            petOwnersOnly: petOwnersOnly,
            token: token,
            key: key,
            remaining: uint128(got),
            floor: uint128(f),
            extra: uint128(got - f * count)
        });
        emit Created(id, msg.sender, address(token), got, count, lucky, petOwnersOnly, uint64(block.timestamp) + lifetime);
    }

    /// @notice The message the link's key signs to let `claimer` open packet `id`.
    function claimDigest(uint256 id, address claimer) public view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode("LXRP1", block.chainid, address(this), id, claimer)));
    }

    /// @notice Open your share. `sig` is the link key's signature over `claimDigest(id, msg.sender)`.
    /// For a pet-owners-only packet, `petId` is a settled pet you own (ignored otherwise).
    /// An even split pays at once; a lucky split reserves your slot, to be revealed with `reveal`.
    function claim(uint256 id, bytes calldata sig, uint256 petId) external nonReentrant returns (uint256 amount) {
        Packet storage p = _packets[id];
        if (p.sender == address(0)) revert Unknown();
        if (block.timestamp >= p.expiry) revert Expired();
        if (p.claimed >= p.count) revert AllClaimed();
        if (tookSlot[id][msg.sender]) revert AlreadyClaimed();
        if (ECDSA.recover(claimDigest(id, msg.sender), sig) != p.key) revert BadKey();
        bool member = false;
        if (p.petOwnersOnly) {
            if (pets.ownerOf(petId) != msg.sender || !pets.isSettled(petId)) revert NotYourPet();
            if (petUsed[id][petId]) revert PetUsed();
            petUsed[id][petId] = true;
            member = true;
        }
        tookSlot[id][msg.sender] = true;
        uint16 index = p.claimed;
        p.claimed = index + 1;
        if (p.lucky) {
            // the seal checks eligibility now, before a slot is taken; the same answer holds at reveal
            _seal(p, index, 0, member);
            pending[id][msg.sender] = Pending(uint64(block.number), index, member);
            emit Reserved(id, msg.sender, index, uint64(block.number));
            return 0;
        }
        return _pay(id, p, index, 0, member);
    }

    /// @notice Reveal a reserved lucky share, at least two blocks after reserving it.
    function reveal(uint256 id) external nonReentrant returns (uint256 amount) {
        Packet storage p = _packets[id];
        Pending memory r = pending[id][msg.sender];
        if (r.atBlock == 0) revert NothingToReveal();
        if (block.number <= uint256(r.atBlock) + 1) revert TooEarly();
        if (block.timestamp >= uint256(p.expiry) + REVEAL_GRACE) revert Expired();
        delete pending[id][msg.sender];
        bytes32 h = blockhash(uint256(r.atBlock) + 1);
        // the hash is gone after 256 blocks; a late reveal gets the smallest weight (seed 0 → weight 1)
        uint8 seed = h == bytes32(0) ? 0 : uint8(uint256(keccak256(abi.encode(h, id, msg.sender, r.index))));
        return _pay(id, p, r.index, seed, r.member);
    }

    function _seal(Packet storage p, uint16 index, uint8 seed, bool member) private view returns (uint16 word, uint8 o) {
        word = uint16(index & 15) | (uint16(seed) << 4) | uint16(1 << 12) | (member ? uint16(1 << 13) : 0)
            | (p.lucky ? uint16(1 << 14) : 0) | (p.petOwnersOnly ? uint16(1 << 15) : 0);
        bytes memory out = processor.eval(sealId, abi.encodePacked(uint8(word), uint8(word >> 8)));
        o = uint8(out[0]);
        if (o & 1 == 0) revert SealSaysNo();
    }

    function _pay(uint256 id, Packet storage p, uint16 index, uint8 seed, bool member) private returns (uint256 amount) {
        (uint16 word, uint8 o) = _seal(p, index, seed, member);
        uint256 weight = (o >> 1) & 15;
        // LX-SEAL/1 never answers weight 0 on a lucky split; never trust that blindly
        if (weight == 0) weight = 1;
        amount = _share(p, weight);
        p.paid += 1;
        p.remaining -= uint128(amount);
        claimedBy[id][msg.sender] = amount;
        if (p.lucky) {
            _luckyPaid[id].push(msg.sender);
            _luckyWeight[id].push(uint8(weight));
            weightSum[id] += weight;
            // when the last lucky share opens, the rest of the pool is shared out by weight
            if (p.paid == p.count) _settle(id, p, 0);
        }
        emit Claimed(id, msg.sender, amount, index, word, o);
        p.token.safeTransfer(msg.sender, amount);
    }

    /// The share paid at once. Even split: what is left divided by the shares left
    /// (claims pay in order, so the last takes the rest). Lucky split: the floor plus
    /// `extra × weight / 15N` (weight 1..15 from the seal): the N shares together can
    /// never ask for more than the pool, so no share is ever capped and none depends
    /// on when the others reveal. What remains of the pool when every share is open
    /// is shared out by weight (`_settle`), so each claimer ends with exactly
    /// floor + extra × weight / Σweight.
    function _share(Packet storage p, uint256 weight) private view returns (uint256) {
        uint256 left = p.count - p.paid;
        uint256 rem = p.remaining;
        if (!p.lucky) return left == 1 ? rem : rem / left;
        return uint256(p.floor) + (uint256(p.extra) * weight) / (15 * uint256(p.count));
    }

    /// Shares what is left, minus `keep`, by weight as top-ups each payee collects; the
    /// last payee in the list also takes the rounding dust, so nothing stays behind.
    function _settle(uint256 id, Packet storage p, uint256 keep) private {
        settled[id] = true;
        uint256 rest = p.remaining - keep;
        uint256 sum = weightSum[id];
        address[] storage who = _luckyPaid[id];
        uint8[] storage w = _luckyWeight[id];
        uint256 given = 0;
        for (uint256 i = 0; i < who.length; i++) {
            uint256 top = i + 1 == who.length ? rest - given : (rest * w[i]) / sum;
            owed[id][who[i]] += top;
            given += top;
        }
        p.remaining = uint128(keep);
        emit Settled(id, rest);
    }

    /// @notice Collect your top-up from a settled lucky packet.
    function collect(uint256 id) external nonReentrant returns (uint256 amount) {
        return _collect(id, msg.sender);
    }

    /// @notice Collect your top-up to another address (for example if the token froze your own).
    function collectTo(uint256 id, address to) external nonReentrant returns (uint256 amount) {
        return _collect(id, to);
    }

    function _collect(uint256 id, address to) private returns (uint256 amount) {
        amount = owed[id][msg.sender];
        if (amount == 0) revert Empty();
        owed[id][msg.sender] = 0;
        claimedBy[id][msg.sender] += amount;
        emit Collected(id, msg.sender, amount);
        _packets[id].token.safeTransfer(to, amount);
    }

    /// @notice Return what nobody claimed to the sender, once the packet has expired. Anyone may call it.
    function refund(uint256 id) external nonReentrant {
        _refund(id, _packets[id].sender);
    }

    /// @notice The sender may take the rest to another address (for example if the token froze their own).
    function refundTo(uint256 id, address to) external nonReentrant {
        if (msg.sender != _packets[id].sender) revert NotSender();
        _refund(id, to);
    }

    function _refund(uint256 id, address to) private {
        Packet storage p = _packets[id];
        if (p.sender == address(0)) revert Unknown();
        // reserved lucky shares may still be revealed during the grace period
        if (block.timestamp < uint256(p.expiry) + (p.lucky ? REVEAL_GRACE : 0)) revert NotYet();
        // a lucky packet that some never opened: those who did still get the rest of the
        // pool by weight; only the floors of the unopened shares go back
        if (p.lucky && !settled[id] && p.paid > 0) _settle(id, p, uint256(p.floor) * (p.count - p.paid));
        uint256 amount = p.remaining;
        if (amount == 0) revert Empty();
        p.remaining = 0;
        emit Refunded(id, p.sender, to, amount);
        p.token.safeTransfer(to, amount);
    }

    function packet(uint256 id) external view returns (Packet memory) {
        if (_packets[id].sender == address(0)) revert Unknown();
        return _packets[id];
    }
}
