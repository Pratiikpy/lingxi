// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface ISealProcessor {
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
}

interface IPetCount {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title Lingxi red packets
/// @notice A pet carries a red packet to friends: tokens held here in escrow, opened
/// by whoever has the link, with each claim decided by a TapeOut seal circuit
/// (LX-SEAL/1) that anyone can re-run with the processor's free `eval`.
///
/// The link carries a one-time key. Claiming needs that key's signature over the
/// claimer's own address, so a claim seen in the mempool cannot be taken over by
/// anyone else. Unclaimed tokens go back to the sender after expiry; anyone may
/// trigger that refund, and it can only ever pay the sender.
///
/// A lucky split is decided in two steps so nobody can pick a good moment to claim:
/// `claim` reserves a slot and records the block; `reveal` (at least two blocks
/// later) draws the seed from the hash of the block right after the reservation,
/// which did not exist when the claimer committed. Revealing more than 256 blocks
/// late, when that hash is gone, earns the smallest weight. X Layer's sequencer
/// could in principle steer a block hash; that trust assumption is stated on the
/// proof page. An even split needs no randomness and pays at once.
contract RedPacket is ReentrancyGuard {
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
    }

    ISealProcessor public immutable processor;
    uint256 public immutable sealId;
    IPetCount public immutable pets;

    uint256 public nextId = 1;
    mapping(uint256 => Packet) private _packets;
    mapping(uint256 => mapping(address => uint256)) public claimedBy;
    struct Pending {
        uint64 atBlock;
        uint16 index;
    }
    mapping(uint256 => mapping(address => Pending)) public pending;

    event Created(uint256 indexed id, address indexed sender, address token, uint256 total, uint16 count, bool lucky, bool petOwnersOnly, uint64 expiry);
    event Claimed(uint256 indexed id, address indexed claimer, uint256 amount, uint16 index, uint16 sealInput, uint8 sealOutput);
    event Reserved(uint256 indexed id, address indexed claimer, uint16 index, uint64 atBlock);
    event Refunded(uint256 indexed id, address indexed sender, uint256 amount);

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

    constructor(ISealProcessor processor_, uint256 sealId_, IPetCount pets_) {
        processor = processor_;
        sealId = sealId_;
        pets = pets_;
    }

    /// @notice Fund a red packet. `key` is the address of the one-time key the link carries.
    /// `floor` is the least any share may be (0 = total / (count × 4)).
    function create(IERC20 token, uint256 total, uint16 count, uint128 floor, uint64 lifetime, address key, bool lucky, bool petOwnersOnly)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (count == 0 || count > MAX_SHARES) revert BadShares();
        if (lifetime == 0 || lifetime > MAX_LIFETIME) revert BadLifetime();
        if (key == address(0)) revert NoKey();
        // measure what actually arrived, so fee-taking tokens cannot overstate the escrow
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        uint256 got = token.balanceOf(address(this)) - before;
        uint256 f = floor == 0 ? got / (uint256(count) * 4) : floor;
        if (got == 0 || f * count > got || got > type(uint128).max) revert TooSmall();
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
            floor: uint128(f)
        });
        emit Created(id, msg.sender, address(token), got, count, lucky, petOwnersOnly, uint64(block.timestamp) + lifetime);
    }

    /// @notice The message the link's key signs to let `claimer` open packet `id`.
    function claimDigest(uint256 id, address claimer) public view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode("LXRP1", block.chainid, address(this), id, claimer)));
    }

    /// @notice Open your share. `sig` is the link key's signature over `claimDigest(id, msg.sender)`.
    /// An even split pays at once; a lucky split reserves your slot, to be revealed with `reveal`.
    function claim(uint256 id, bytes calldata sig) external nonReentrant returns (uint256 amount) {
        Packet storage p = _packets[id];
        if (p.sender == address(0)) revert Unknown();
        if (block.timestamp >= p.expiry) revert Expired();
        if (p.claimed >= p.count) revert AllClaimed();
        if (claimedBy[id][msg.sender] != 0 || pending[id][msg.sender].atBlock != 0) revert AlreadyClaimed();
        if (ECDSA.recover(claimDigest(id, msg.sender), sig) != p.key) revert BadKey();
        uint16 index = p.claimed;
        p.claimed = index + 1;
        if (p.lucky) {
            // the seal still checks eligibility now, before a slot is taken
            _seal(p, index, 0);
            pending[id][msg.sender] = Pending(uint64(block.number), index);
            emit Reserved(id, msg.sender, index, uint64(block.number));
            return 0;
        }
        return _pay(id, p, index, 0);
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
        // the hash is gone after 256 blocks; a late reveal gets the smallest weight (seed 0)
        uint8 seed = h == bytes32(0) ? 0 : uint8(uint256(keccak256(abi.encode(h, id, msg.sender, r.index))));
        return _pay(id, p, r.index, seed);
    }

    function _seal(Packet storage p, uint16 index, uint8 seed) private view returns (uint16 word, uint8 o) {
        bool member = pets.balanceOf(msg.sender) > 0;
        word = uint16(index & 15) | (uint16(seed) << 4) | uint16(1 << 12) | (member ? uint16(1 << 13) : 0)
            | (p.lucky ? uint16(1 << 14) : 0) | (p.petOwnersOnly ? uint16(1 << 15) : 0);
        bytes memory out = processor.eval(sealId, abi.encodePacked(uint8(word), uint8(word >> 8)));
        o = uint8(out[0]);
        if (o & 1 == 0) revert SealSaysNo();
    }

    function _pay(uint256 id, Packet storage p, uint16 index, uint8 seed) private returns (uint256 amount) {
        (uint16 word, uint8 o) = _seal(p, index, seed);
        amount = _share(p, (o >> 1) & 15);
        p.paid += 1;
        p.remaining -= uint128(amount);
        claimedBy[id][msg.sender] = amount;
        emit Claimed(id, msg.sender, amount, index, word, o);
        p.token.safeTransfer(msg.sender, amount);
    }

    /// The share for this claim: the last payee takes what is left; an even split
    /// divides what is left equally; a lucky split draws between the floor and twice
    /// the average, by the seal's weight, always leaving every later share its floor.
    function _share(Packet storage p, uint256 weight) private view returns (uint256) {
        uint256 left = p.count - p.paid;
        uint256 rem = p.remaining;
        if (left == 1) return rem;
        if (!p.lucky) return rem / left;
        uint256 f = p.floor;
        uint256 twiceAvg = (2 * rem) / left;
        uint256 s = twiceAvg > f ? f + ((twiceAvg - f) * weight) / 16 : f;
        uint256 cap = rem - f * (left - 1);
        return s > cap ? cap : (s < f ? f : s);
    }

    /// @notice Return what nobody claimed to the sender, once the packet has expired.
    function refund(uint256 id) external nonReentrant {
        Packet storage p = _packets[id];
        if (p.sender == address(0)) revert Unknown();
        // reserved lucky shares may still be revealed during the grace period
        if (block.timestamp < uint256(p.expiry) + (p.lucky ? REVEAL_GRACE : 0)) revert NotYet();
        uint256 amount = p.remaining;
        if (amount == 0) revert Empty();
        p.remaining = 0;
        emit Refunded(id, p.sender, amount);
        p.token.safeTransfer(p.sender, amount);
    }

    function packet(uint256 id) external view returns (Packet memory) {
        if (_packets[id].sender == address(0)) revert Unknown();
        return _packets[id];
    }
}
