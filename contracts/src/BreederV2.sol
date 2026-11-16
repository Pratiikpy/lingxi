// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {PetRegistry} from "./PetRegistry.sol";

interface INetlist {
    function netlist(uint256 id) external view returns (bytes memory);
}

/// @title Lingxi breeding, with a BEM fee that is burned
/// @notice Two adult pets have a child whose brain is a TapeOut circuit that REFs both parents' brains plus a
/// fixed piece of glue (LX-CHILD/1): the child answers like parent A by morning and day, like parent B by evening
/// and night, with A's mood and B's habits, and carries both parents' memories. Before the child hatches, this
/// contract reads the child circuit's bytes from the processor and checks they are exactly that composition of
/// these two parents, so a child can never claim a lineage its brain does not have.
/// The caller pays a breeding fee in BEM, moved straight from their wallet to the dead address: this contract
/// never holds BEM. Each pet can have at most four children, so supply stays bounded.
contract BreederV2 is Ownable2Step {
    using SafeERC20 for IERC20;

    PetRegistry public immutable registry;
    IERC20 public immutable bem;

    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant COOLDOWN = 3 days;
    /// a parent must have lived on chain this long (the game's adult stage begins on day 8)
    uint256 public constant ADULT_AGE = 7 days;
    /// children per pet, for life
    uint8 public constant MAX_CHILDREN = 4;
    /// the fee stays between 0.01 and 1 BEM whatever the owner sets
    uint256 public constant MIN_FEE = 1_000_000;
    uint256 public constant MAX_FEE = 100_000_000;
    /// keccak256 of the glue that follows the two REF records in every LX-CHILD/1 circuit
    bytes32 public constant GLUE_HASH = 0x3a5406aff810e8b14a7594060b8f96a78986cd98f64b3f820a284b74969b76fb;
    uint256 private constant REF_LEN = 79; // 1 opcode + 20 cpu + 8 id + 1 nIns + 1 nOuts + 16 × 3 ins
    uint256 private constant CHILD_LEN = 2 * REF_LEN + 30 * 7;

    uint256 public breedFee = 10_000_000; // 0.1 BEM
    uint256 public totalBurned;
    mapping(uint256 => uint64) public lastBred;
    mapping(uint256 => uint8) public children;
    /// pet => partner owner => who gave consent, and during which ownership of the pet
    /// (valid only while that same ownership lasts; used up by one child)
    struct Grant {
        address by;
        uint256 ownership;
    }
    mapping(uint256 => mapping(address => Grant)) public consentBy;

    event Consent(uint256 indexed petId, address indexed partnerOwner, bool allowed);
    event Born(uint256 indexed child, uint256 indexed parentA, uint256 indexed parentB, address processor, uint64 brainId);
    event Burned(address indexed payer, uint256 amount);
    event FeeChanged(uint256 fee);

    error NotYours();
    error NoConsent();
    error SamePet();
    error TooSoon(uint256 petId);
    error NotAdult(uint256 petId);
    error NotAChildOf(uint256 parentA, uint256 parentB);
    /// A pet born of two parents cannot have children: its mind is already two minds,
    /// and composing it again would leave its inner ancestors with no say at all.
    error NotFirstGeneration(uint256 petId);
    /// A parent's brain must be a plain circuit (NAND and LATCH only), not a composition.
    error ComposedBrain(uint256 petId);
    error TooManyChildren(uint256 petId);
    error FeeMoved(uint256 fee);
    error BadFee();
    error PaymentShort();

    constructor(PetRegistry registry_, IERC20 bem_, address owner_) Ownable(owner_) {
        registry = registry_;
        bem = bem_;
    }

    /// @notice Let a partner's owner breed with your pet.
    function allowPartner(uint256 petId, address partnerOwner, bool allowed) external {
        if (registry.ownerOf(petId) != msg.sender) revert NotYours();
        if (allowed) consentBy[petId][partnerOwner] = Grant(msg.sender, registry.transferCount(petId));
        else delete consentBy[petId][partnerOwner];
        emit Consent(petId, partnerOwner, allowed);
    }

    /// @notice True while the consent stands: given by the pet's current owner and not yet used.
    function consent(uint256 petId, address partnerOwner) public view returns (bool) {
        Grant memory g = consentBy[petId][partnerOwner];
        // a sale ends it, and buying the pet back does not revive it
        return g.by != address(0) && g.by == registry.ownerOf(petId) && g.ownership == registry.transferCount(petId);
    }

    /// @notice Hatch the child of two adult pets, paying the breeding fee in BEM (burned). The caller owns parent
    /// A; parent B is theirs too, or its owner has given consent. The child goes to the caller. `maxFee` guards
    /// against a fee change in flight.
    function breed(uint256 a, uint256 b, address childProcessor, uint64 childBrainId, uint8 line, uint256 maxFee) external returns (uint256 child) {
        if (a == b) revert SamePet();
        uint256 fee = breedFee;
        if (fee > maxFee) revert FeeMoved(fee);
        if (registry.ownerOf(a) != msg.sender) revert NotYours();
        if (registry.ownerOf(b) != msg.sender) {
            if (!consent(b, msg.sender)) revert NoConsent();
            // one consent, one child
            delete consentBy[b][msg.sender];
        }
        if (children[a] >= MAX_CHILDREN) revert TooManyChildren(a);
        if (children[b] >= MAX_CHILDREN) revert TooManyChildren(b);
        uint256 initial = _checkAndMix(a, b, childProcessor, childBrainId);
        lastBred[a] = uint64(block.timestamp);
        lastBred[b] = uint64(block.timestamp);
        children[a] += 1;
        children[b] += 1;
        _burnFrom(msg.sender, fee);
        child = registry.hatchChild(msg.sender, line, childProcessor, childBrainId, initial, uint128(a), uint128(b));
        emit Born(child, a, b, childProcessor, childBrainId);
    }

    /// @notice The fee can change between 0.01 and 1 BEM; it is always burned.
    function setFee(uint256 fee) external onlyOwner {
        if (fee < MIN_FEE || fee > MAX_FEE) revert BadFee();
        breedFee = fee;
        emit FeeChanged(fee);
    }

    /// Moves the fee from the payer straight to the dead address and checks it arrived in full.
    function _burnFrom(address payer, uint256 fee) private {
        uint256 before = bem.balanceOf(BURN);
        bem.safeTransferFrom(payer, BURN, fee);
        if (bem.balanceOf(BURN) - before != fee) revert PaymentShort();
        totalBurned += fee;
        emit Burned(payer, fee);
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
        // age is read from the chain's own hatch time, never from the self-reported state
        if (block.timestamp < uint256(p.born) + ADULT_AGE) revert NotAdult(id);
        if (_hasRef(INetlist(p.processor).netlist(p.brainId))) revert ComposedBrain(id);
    }

    /// Walks a TAP-02 netlist: NAND (7 bytes) and LATCH (4 bytes) are plain; a REF or
    /// anything unknown means the brain is not a plain circuit.
    function _hasRef(bytes memory nl) private pure returns (bool) {
        uint256 i = 0;
        while (i < nl.length) {
            uint8 op = uint8(nl[i]);
            if (op == 0x00) i += 7;
            else if (op == 0x01) i += 4;
            else return true;
        }
        return i != nl.length;
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
