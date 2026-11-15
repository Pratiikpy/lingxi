// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PetRegistry} from "./PetRegistry.sol";

interface INetlist {
    function netlist(uint256 id) external view returns (bytes memory);
}

/// @title Lingxi breeding
/// @notice Two adult pets have a child whose brain is a TapeOut circuit that REFs both
/// parents' brains plus a fixed piece of glue (LX-CHILD/1): the child answers like
/// parent A by morning and day, like parent B by evening and night, with A's mood
/// and B's habits, and carries both parents' memories. Before the child hatches,
/// this contract reads the child circuit's bytes from the processor and checks they
/// are exactly that composition of these two parents, so a child can never claim a
/// lineage its brain does not have.
contract Breeder {
    PetRegistry public immutable registry;

    uint256 public constant COOLDOWN = 3 days;
    uint256 public constant ADULT_STAGE = 4;
    /// keccak256 of the glue that follows the two REF records in every LX-CHILD/1 circuit
    bytes32 public constant GLUE_HASH = 0x3a5406aff810e8b14a7594060b8f96a78986cd98f64b3f820a284b74969b76fb;
    uint256 private constant REF_LEN = 79; // 1 opcode + 20 cpu + 8 id + 1 nIns + 1 nOuts + 16 × 3 ins
    uint256 private constant CHILD_LEN = 2 * REF_LEN + 30 * 7;

    mapping(uint256 => uint64) public lastBred;
    /// pet => partner owner => allowed to breed with this pet
    mapping(uint256 => mapping(address => bool)) public consent;

    event Consent(uint256 indexed petId, address indexed partnerOwner, bool allowed);
    event Born(uint256 indexed child, uint256 indexed parentA, uint256 indexed parentB, address processor, uint64 brainId);

    error NotYours();
    error NoConsent();
    error SamePet();
    error TooSoon(uint256 petId);
    error NotAdult(uint256 petId);
    error NotAChildOf(uint256 parentA, uint256 parentB);
    /// A pet born of two parents cannot have children: its mind is already two minds,
    /// and composing it again would leave its inner ancestors with no say at all.
    error NotFirstGeneration(uint256 petId);

    constructor(PetRegistry registry_) {
        registry = registry_;
    }

    /// @notice Let a partner's owner breed with your pet.
    function allowPartner(uint256 petId, address partnerOwner, bool allowed) external {
        if (registry.ownerOf(petId) != msg.sender) revert NotYours();
        consent[petId][partnerOwner] = allowed;
        emit Consent(petId, partnerOwner, allowed);
    }

    /// @notice Hatch the child of two adult pets. The caller owns parent A; parent B is
    /// theirs too, or its owner has given consent. The child goes to the caller.
    function breed(uint256 a, uint256 b, address childProcessor, uint64 childBrainId, uint8 line) external returns (uint256 child) {
        if (a == b) revert SamePet();
        if (registry.ownerOf(a) != msg.sender) revert NotYours();
        if (registry.ownerOf(b) != msg.sender && !consent[b][msg.sender]) revert NoConsent();
        uint256 initial = _checkAndMix(a, b, childProcessor, childBrainId);
        lastBred[a] = uint64(block.timestamp);
        lastBred[b] = uint64(block.timestamp);
        child = registry.hatchChild(msg.sender, line, childProcessor, childBrainId, initial, uint128(a), uint128(b));
        emit Born(child, a, b, childProcessor, childBrainId);
    }

    /// Checks both parents and the child circuit; returns the child's starting memory
    /// (A's block first, then B's).
    function _checkAndMix(uint256 a, uint256 b, address childProcessor, uint64 childBrainId) private view returns (uint256) {
        PetRegistry.Pet memory pa = registry.pet(a);
        PetRegistry.Pet memory pb = registry.pet(b);
        _checkReady(a, pa);
        _checkReady(b, pb);
        if (!isChildCircuit(childProcessor, childBrainId, pa, pb)) revert NotAChildOf(a, b);
        uint256 maskA = (uint256(1) << pa.brainBits) - 1;
        uint256 maskB = (uint256(1) << pb.brainBits) - 1;
        return (pa.state & maskA) | ((pb.state & maskB) << pa.brainBits);
    }

    function _checkReady(uint256 id, PetRegistry.Pet memory p) private view {
        if (p.parentA != 0) revert NotFirstGeneration(id);
        if (block.timestamp < uint256(lastBred[id]) + COOLDOWN && lastBred[id] != 0) revert TooSoon(id);
        if (((p.state >> 148) & 7) < ADULT_STAGE) revert NotAdult(id);
    }

    /// @notice True when the circuit is exactly LX-CHILD/1 composed of these parents' brains.
    function isChildCircuit(address processor, uint256 brainId, PetRegistry.Pet memory pa, PetRegistry.Pet memory pb) public view returns (bool) {
        bytes memory nl = INetlist(processor).netlist(brainId);
        if (nl.length != CHILD_LEN) return false;
        if (!_isRef(nl, 0, pa.processor, pa.brainId)) return false;
        if (!_isRef(nl, REF_LEN, pb.processor, pb.brainId)) return false;
        bytes32 glue;
        assembly {
            glue := keccak256(add(add(nl, 32), mul(2, REF_LEN)), mul(30, 7))
        }
        return glue == GLUE_HASH;
    }

    /// A REF record at `at` naming (cpu, id), taking the 16 input pins in order and giving 8 outputs.
    function _isRef(bytes memory nl, uint256 at, address cpu, uint64 id) private pure returns (bool) {
        if (uint8(nl[at]) != 0x02) return false;
        uint160 c = 0;
        for (uint256 i = 0; i < 20; i++) c = (c << 8) | uint160(uint8(nl[at + 1 + i]));
        if (address(c) != cpu) return false;
        uint64 x = 0;
        for (uint256 i = 0; i < 8; i++) x = (x << 8) | uint64(uint8(nl[at + 21 + i]));
        if (x != id) return false;
        if (uint8(nl[at + 29]) != 16 || uint8(nl[at + 30]) != 8) return false;
        for (uint256 k = 0; k < 16; k++) {
            uint256 o = at + 31 + 3 * k;
            uint256 s = (uint256(uint8(nl[o])) << 16) | (uint256(uint8(nl[o + 1])) << 8) | uint256(uint8(nl[o + 2]));
            if (s != 2 + k) return false;
        }
        return true;
    }
}
