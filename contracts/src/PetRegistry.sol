// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {ITapeOutProcessor, ITapeOutFactory} from "./interfaces/ITapeOut.sol";

interface IPetRenderer {
    function tokenURI(uint256 petId) external view returns (string memory);
}

/// @title Lingxi pets
/// @notice Each pet is an ERC-721 whose mind is a TapeOut circuit (16 inputs, 8 outputs,
/// LATCH memory) on a registered processor. The pet's whole state lives here in one
/// 256-bit word: its low 64 bits are the brain's LATCH state, the rest are the game
/// fields defined in the client (meters, traits, growth). Owners write a daily
/// checkpoint of that word together with a hash of the day's inputs. Anyone can
/// re-run any single beat of the brain through the processor's own `step`, so every
/// thought the pet claims to have had can be checked on chain.
contract PetRegistry is ERC721, Ownable2Step {
    uint256 public constant N_IN = 16;
    uint256 public constant N_OUT = 8;
    uint256 public constant MAX_BRAIN_STATE = 64;
    uint256 private constant BRAIN_MASK = (1 << 64) - 1;

    struct Pet {
        address processor; // where the brain circuit lives
        uint64 brainId; // circuit id on that processor
        uint8 line; // egg line the pet hatched from
        uint8 brainBits; // LATCH bits the brain uses (<= 64)
        uint32 day; // last checkpointed day (0 = never)
        uint40 born; // block timestamp of hatching
        uint40 checkedAt; // block timestamp of the last checkpoint
        bytes32 logHash; // hash chain of every input word since hatching
        uint256 state; // the pet's whole state
        uint128 parentA; // 0 for hatched pets
        uint128 parentB;
    }

    struct Sitter {
        address who;
        uint64 until;
        address grantedBy; // the owner who granted it; a sitter never outlives a transfer
    }

    ITapeOutFactory public immutable factory;
    IPetRenderer public renderer;

    uint256 public nextPetId = 1;
    mapping(uint256 => Pet) private _pets;
    mapping(uint256 => Sitter) public sitters;
    /// processor => circuit id => approved as a free starter brain
    mapping(address => mapping(uint256 => bool)) public starterBrain;
    /// contracts allowed to hatch pets with a stated lineage (breeding, gifts)
    mapping(address => bool) public breeders;
    /// how many times each pet has changed hands (lets others tie a permission to one ownership)
    mapping(uint256 => uint256) public transferCount;
    /// a pet must be this old on chain, with this many saved days, to count as "settled"
    uint256 public constant SETTLED_AGE = 3 days;
    uint32 public constant SETTLED_DAYS = 3;

    event Hatched(uint256 indexed petId, address indexed to, uint8 line, address processor, uint64 brainId, uint256 state);
    event Bred(uint256 indexed petId, uint128 indexed parentA, uint128 indexed parentB);
    event BrainChanged(uint256 indexed petId, address processor, uint64 brainId, uint8 brainBits);
    event Checkpoint(uint256 indexed petId, uint32 indexed day, uint256 state, bytes32 logHash);
    event SitterSet(uint256 indexed petId, address indexed sitter, uint64 until);
    event StarterBrainSet(address indexed processor, uint256 indexed brainId, bool approved);
    event BreederSet(address indexed breeder, bool allowed);
    event RendererSet(address indexed renderer);

    error NotKeeper();
    error NotStarter();
    error NotBreeder();
    error UnknownPet();
    error NotACpu(address processor);
    error WrongPins(uint256 nIn, uint256 nOut);
    error BrainTooBig(uint256 nState);
    error DayNotAfter(uint32 last, uint32 day);
    error DayInFuture(uint32 day, uint32 today);
    error BadOutput(uint256 len);
    error SittingTooLong();

    constructor(ITapeOutFactory factory_, address owner_) ERC721("Lingxi Pet", "LINGXI") Ownable(owner_) {
        factory = factory_;
    }

    /* ── admin ─────────────────────────────────────────────────────────── */

    function setStarterBrain(address processor, uint256 brainId, bool approved) external onlyOwner {
        if (approved) _checkBrain(processor, brainId);
        starterBrain[processor][brainId] = approved;
        emit StarterBrainSet(processor, brainId, approved);
    }

    function setBreeder(address breeder, bool allowed) external onlyOwner {
        breeders[breeder] = allowed;
        emit BreederSet(breeder, allowed);
    }

    function setRenderer(IPetRenderer r) external onlyOwner {
        renderer = r;
        emit RendererSet(address(r));
    }

    /* ── hatching ──────────────────────────────────────────────────────── */

    /// @notice Hatch a pet with an approved starter brain. Free apart from gas.
    function hatch(address to, uint8 line, address processor, uint64 brainId, uint256 initialState)
        external
        returns (uint256 petId)
    {
        if (!starterBrain[processor][brainId]) revert NotStarter();
        petId = _create(to, line, processor, brainId, initialState, 0, 0);
    }

    /// @notice Hatch a child with a stated lineage. Only for approved breeder contracts,
    /// which check the parents and compose the child brain (REF to both parents).
    function hatchChild(
        address to,
        uint8 line,
        address processor,
        uint64 brainId,
        uint256 initialState,
        uint128 parentA,
        uint128 parentB
    ) external returns (uint256 petId) {
        if (!breeders[msg.sender]) revert NotBreeder();
        if (_pets[parentA].born == 0 || _pets[parentB].born == 0) revert UnknownPet();
        petId = _create(to, line, processor, brainId, initialState, parentA, parentB);
        emit Bred(petId, parentA, parentB);
    }

    function _create(
        address to,
        uint8 line,
        address processor,
        uint64 brainId,
        uint256 initialState,
        uint128 parentA,
        uint128 parentB
    ) private returns (uint256 petId) {
        uint8 bits = _checkBrain(processor, brainId);
        petId = nextPetId++;
        _pets[petId] = Pet({
            processor: processor,
            brainId: brainId,
            line: line,
            brainBits: bits,
            day: 0,
            born: uint40(block.timestamp),
            checkedAt: uint40(block.timestamp),
            logHash: bytes32(0),
            state: _maskBrain(initialState, bits),
            parentA: parentA,
            parentB: parentB
        });
        _safeMint(to, petId);
        emit Hatched(petId, to, line, processor, brainId, _pets[petId].state);
    }

    /* ── keeping a pet ─────────────────────────────────────────────────── */

    /// @notice Owner, approved operator, or the current sitter.
    function isKeeper(uint256 petId, address who) public view returns (bool) {
        address o = _ownerOf(petId);
        if (o == address(0)) return false;
        if (who == o || isApprovedForAll(o, who) || getApproved(petId) == who) return true;
        Sitter memory s = sitters[petId];
        return s.who == who && s.grantedBy == o && block.timestamp <= s.until;
    }

    modifier onlyKeeper(uint256 petId) {
        if (!isKeeper(petId, msg.sender)) revert NotKeeper();
        _;
    }

    /// @notice Write the day's checkpoint: the whole state after the day's beats and the
    /// hash chain of every input word so far. Days only move forward and never past today.
    function checkpoint(uint256 petId, uint32 day, uint256 state, bytes32 logHash) external onlyKeeper(petId) {
        Pet storage p = _pets[petId];
        if (day <= p.day) revert DayNotAfter(p.day, day);
        uint32 today = uint32((block.timestamp - p.born) / 1 days) + 1;
        if (day > today) revert DayInFuture(day, today);
        p.day = day;
        p.state = _maskBrain(state, p.brainBits);
        p.logHash = logHash;
        p.checkedAt = uint40(block.timestamp);
        emit Checkpoint(petId, day, p.state, logHash);
    }

    /// @notice Give the pet a new brain (a lesson was taught and taped out).
    /// The memory the new brain shares with the old one is kept bit for bit.
    function setBrain(uint256 petId, address processor, uint64 brainId) external {
        if (_ownerOf(petId) != msg.sender && !isApprovedForAll(_ownerOf(petId), msg.sender)) revert NotKeeper();
        uint8 bits = _checkBrain(processor, brainId);
        Pet storage p = _pets[petId];
        p.processor = processor;
        p.brainId = brainId;
        p.brainBits = bits;
        p.state = _maskBrain(p.state, bits);
        emit BrainChanged(petId, processor, brainId, bits);
    }

    uint256 public constant MAX_SITTING = 30 days;

    /// @notice Let a friend look after the pet until a given time (at most 30 days ahead).
    /// Ownership never moves, and the sitting ends if the pet changes hands.
    function setSitter(uint256 petId, address who, uint64 until) external {
        if (_ownerOf(petId) != msg.sender) revert NotKeeper();
        if (until > block.timestamp + MAX_SITTING) revert SittingTooLong();
        sitters[petId] = Sitter(who, until, msg.sender);
        emit SitterSet(petId, who, until);
    }

    /* ── checking a thought ────────────────────────────────────────────── */

    /// @notice Run one beat of the pet's brain through the processor's own `step`.
    /// @param brainState LATCH state before the beat (bit i = latch i)
    /// @param inputs the 16 input pins (bit i = pin i)
    /// @return next LATCH state after the beat
    /// @return outputs the 8 output pins
    function replayStep(uint256 petId, uint64 brainState, uint16 inputs) public view returns (uint64 next, uint8 outputs) {
        Pet storage p = _pets[petId];
        if (p.born == 0) revert UnknownPet();
        (bytes memory ns, bytes memory out) =
            ITapeOutProcessor(p.processor).step(p.brainId, _packBits(brainState, p.brainBits), _packBits(inputs, N_IN));
        if (out.length != 1) revert BadOutput(out.length);
        outputs = uint8(out[0]);
        for (uint256 i = 0; i < ns.length && i < 8; i++) {
            next |= uint64(uint8(ns[i])) << uint64(8 * i);
        }
    }

    /// @notice True when the brain, in `fromState` and given `inputs`, moves to `toState`
    /// and answers `outputs`.
    function verifyBeat(uint256 petId, uint64 fromState, uint16 inputs, uint64 toState, uint8 outputs)
        external
        view
        returns (bool)
    {
        (uint64 n, uint8 o) = replayStep(petId, fromState, inputs);
        return n == toState && o == outputs;
    }

    /// @notice The hash chain a checkpoint commits to: h' = keccak256(h, word).
    function chainLog(bytes32 h, uint16 word) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(h, word));
    }

    function pet(uint256 petId) external view returns (Pet memory) {
        if (_pets[petId].born == 0) revert UnknownPet();
        return _pets[petId];
    }

    /// @notice A pet that has lived on chain at least three days and saved at least its
    /// third day: what "pet owners only" red packets accept. It raises the cost of
    /// farming pets for packets; it does not make a pet a proof of personhood.
    function isSettled(uint256 petId) external view returns (bool) {
        Pet storage p = _pets[petId];
        return p.born != 0 && p.day >= SETTLED_DAYS && block.timestamp >= uint256(p.born) + SETTLED_AGE;
    }

    /// @notice Metadata from the renderer; until one is set, plain JSON with the pet's
    /// facts, so wallets and marketplaces never see a revert.
    function tokenURI(uint256 petId) public view override returns (string memory) {
        _requireOwned(petId);
        if (address(renderer) != address(0)) return renderer.tokenURI(petId);
        Pet storage p = _pets[petId];
        string memory json = string.concat(
            "{\"name\":\"Lingxi Pet #",
            Strings.toString(petId),
            "\",\"description\":\"A pet whose mind is a TapeOut circuit with LATCH memory on X Layer.\",\"attributes\":[{\"trait_type\":\"line\",\"value\":",
            Strings.toString(p.line),
            "},{\"trait_type\":\"brain circuit\",\"value\":",
            Strings.toString(p.brainId),
            "},{\"trait_type\":\"days saved\",\"value\":",
            Strings.toString(p.day),
            "},{\"trait_type\":\"generation\",\"value\":",
            p.parentA == 0 ? "0" : "1",
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// A sitting ends whenever the pet changes hands, and is not revived if it comes back.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && from != to) {
            transferCount[tokenId] += 1;
            if (sitters[tokenId].who != address(0)) {
                delete sitters[tokenId];
                emit SitterSet(tokenId, address(0), 0);
            }
        }
    }

    /* ── internals ─────────────────────────────────────────────────────── */

    function _checkBrain(address processor, uint256 brainId) private view returns (uint8) {
        if (!factory.isCPU(processor)) revert NotACpu(processor);
        (uint256 nIn, uint256 nOut, uint256 nState,) = ITapeOutProcessor(processor).circuitInfo(brainId);
        if (nIn != N_IN || nOut != N_OUT) revert WrongPins(nIn, nOut);
        if (nState > MAX_BRAIN_STATE) revert BrainTooBig(nState);
        return uint8(nState);
    }

    /// Clears brain bits above the brain's width so stale memory never leaks into a new brain.
    function _maskBrain(uint256 state, uint8 bits) private pure returns (uint256) {
        uint256 keep = bits == 64 ? BRAIN_MASK : (uint256(1) << bits) - 1;
        return (state & ~BRAIN_MASK) | (state & keep);
    }

    /// Packs the low `n` bits of `v`, least significant first, as TapeOut reads them.
    function _packBits(uint256 v, uint256 n) private pure returns (bytes memory b) {
        b = new bytes((n + 7) / 8);
        for (uint256 i = 0; i < b.length; i++) {
            uint256 byteVal = (v >> (8 * i)) & 0xff;
            uint256 left = n - 8 * i;
            if (left < 8) byteVal &= (uint256(1) << left) - 1;
            b[i] = bytes1(uint8(byteVal));
        }
    }
}
