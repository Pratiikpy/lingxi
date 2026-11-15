// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IPetRenderer, PetRegistry} from "./PetRegistry.sol";

/// @title Lingxi pet pictures and names
/// @notice Every pet's picture is drawn on chain from its saved state: the body for its
/// stage, the circuit trace (lit when it is glowing with joy) and one of sixteen
/// hand-drawn faces chosen from its meters, all assembled from pixel layers stored
/// here. Owners can also give a pet a name that no other pet holds.
/// @dev Layers are lists of 4-byte runs: x, y, length, colour role (1..16). Each egg line
/// (0 gentle, 1 bold, 2 curious) has its own bodies; a "slot" is 10 * (line + 1) + stage
/// for stages 1..4 (baby..adult) and 0 for the egg, which every line shares. Layer keys:
/// 0 egg, 100 + slot body, 200 + slot lit-trace pixels, 1000..1015 small faces and
/// 1016..1031 large faces (shared by all lines). Face positions (16 left/top pairs), face
/// size and frame are kept per slot. Palettes: 0..2 pets by line, 3..5 eggs by line. Art can be corrected until the owner freezes it; after that this contract's art
/// never changes (the registry's owner can still point the registry at another renderer).
contract PetLook is IPetRenderer, Ownable2Step {
    using Strings for uint256;

    PetRegistry public immutable registry;

    mapping(uint256 => bytes) public layer;
    mapping(uint256 => bytes) public faceAt;
    mapping(uint256 => bool) public largeFace;
    /// palette 0 for pets, 1 for the egg: 16 colours (role 1..16) of 4 bytes RGBA
    mapping(uint256 => bytes) public palette;
    /// per stage: the square of the 48x48 canvas the picture shows (x, y, size)
    mapping(uint256 => bytes) public frame;
    bool public artFrozen;

    uint256 public constant MAX_NAME_BYTES = 24;
    /// 400 runs: a full 48x48 layer needs far fewer, and it keeps every picture cheap to read
    uint256 public constant MAX_LAYER_BYTES = 1600;
    mapping(uint256 => string) private _names;
    /// lower-cased name hash → pet id + 1
    mapping(bytes32 => uint256) public nameHolder;

    event LayerSet(uint256 indexed key, uint256 runs);
    event ArtFrozen();
    event Named(uint256 indexed petId, string name);

    error ArtIsFrozen();
    error BadLayer();
    error NotPetOwner();
    error BadName();
    error NameTaken(uint256 holder);
    error NotSettled();
    error ArtIncomplete();

    constructor(PetRegistry registry_, address owner_) Ownable(owner_) {
        registry = registry_;
    }

    /* ── art ───────────────────────────────────────────────────────────── */

    modifier artOpen() {
        if (artFrozen) revert ArtIsFrozen();
        _;
    }

    function setLayers(uint256[] calldata keys, bytes[] calldata data) external onlyOwner artOpen {
        if (keys.length != data.length) revert BadLayer();
        for (uint256 i; i < keys.length; ++i) {
            bytes calldata d = data[i];
            if (d.length % 4 != 0 || d.length > MAX_LAYER_BYTES) revert BadLayer();
            for (uint256 j; j < d.length; j += 4) {
                // inside the 48×48 canvas, a real colour, never past the right edge
                if (uint8(d[j]) >= 48 || uint8(d[j + 1]) >= 48 || uint8(d[j + 2]) == 0 || uint256(uint8(d[j])) + uint8(d[j + 2]) > 48) revert BadLayer();
                if (uint8(d[j + 3]) == 0 || uint8(d[j + 3]) > 16) revert BadLayer();
            }
            layer[keys[i]] = d;
            emit LayerSet(keys[i], d.length / 4);
        }
    }

    function _validSlot(uint256 slot, bool eggAllowed) private pure returns (bool) {
        if (slot == 0) return eggAllowed;
        uint256 line = slot / 10;
        uint256 stage = slot % 10;
        return line >= 1 && line <= 3 && stage >= 1 && stage <= 4;
    }

    function setFaces(uint256 slot, bool large, bytes calldata at) external onlyOwner artOpen {
        if (!_validSlot(slot, false) || at.length != 32) revert BadLayer();
        faceAt[slot] = at;
        largeFace[slot] = large;
    }

    function setFrame(uint256 slot, uint8 x, uint8 y, uint8 size) external onlyOwner artOpen {
        if (!_validSlot(slot, true) || size < 16 || uint256(x) + size > 48 || uint256(y) + size > 48) revert BadLayer();
        frame[slot] = abi.encodePacked(x, y, size);
    }

    function setPalette(uint256 id, bytes calldata colours) external onlyOwner artOpen {
        if (id > 5 || colours.length != 64) revert BadLayer();
        palette[id] = colours;
    }

    /// @notice Make the art permanent: no layer, face position or colour can change again.
    /// Every picture must be complete first: egg and four bodies, face positions and the
    /// sixteen faces of each stage's set, and both palettes.
    function freezeArt() external onlyOwner {
        if (layer[0].length == 0) revert ArtIncomplete();
        for (uint256 line = 0; line < 3; ++line) {
            if (palette[line].length != 64 || palette[3 + line].length != 64) revert ArtIncomplete();
            for (uint256 st = 1; st <= 4; ++st) {
                uint256 slot = 10 * (line + 1) + st;
                if (layer[100 + slot].length == 0 || faceAt[slot].length != 32) revert ArtIncomplete();
            }
        }
        for (uint256 f; f < 32; ++f) {
            if (layer[1000 + f].length == 0) revert ArtIncomplete();
        }
        artFrozen = true;
        emit ArtFrozen();
    }

    /* ── names ─────────────────────────────────────────────────────────── */

    function nameOf(uint256 petId) external view returns (string memory) {
        return _names[petId];
    }

    /// @notice Name a pet (or rename it; an empty name clears it). The name stays with
    /// the pet if it changes hands. Names are unique ignoring ASCII letter case, and open
    /// to settled pets only (three days on chain, three days saved), so names can't be
    /// swept up by hatching thousands of throwaway pets.
    function setName(uint256 petId, string calldata name) external {
        address owner_ = registry.ownerOf(petId);
        if (msg.sender != owner_ && !registry.isApprovedForAll(owner_, msg.sender)) revert NotPetOwner();
        if (bytes(name).length != 0 && !registry.isSettled(petId)) revert NotSettled();
        bytes memory old = bytes(_names[petId]);
        if (old.length != 0) delete nameHolder[_nameKey(old)];
        bytes calldata b = bytes(name);
        if (b.length == 0) {
            delete _names[petId];
            emit Named(petId, "");
            return;
        }
        if (!validName(b)) revert BadName();
        bytes32 key = _nameKey(b);
        uint256 holder = nameHolder[key];
        if (holder != 0 && holder != petId + 1) revert NameTaken(holder - 1);
        nameHolder[key] = petId + 1;
        _names[petId] = name;
        emit Named(petId, name);
    }

    /// @notice Release a name that impersonates someone or is abusive (moderation only).
    function releaseName(uint256 petId) external onlyOwner {
        bytes memory old = bytes(_names[petId]);
        if (old.length == 0) return;
        delete nameHolder[_nameKey(old)];
        delete _names[petId];
        emit Named(petId, "");
    }

    /// @notice 1..24 bytes of well-formed UTF-8 with no control characters, no leading or
    /// trailing space, none of " \ < > & (so it is always safe inside JSON and SVG), and
    /// no invisible or direction-changing characters (so two names can't look the same
    /// while differing only in hidden code points).
    function validName(bytes memory b) public pure returns (bool) {
        uint256 n = b.length;
        if (n == 0 || n > MAX_NAME_BYTES || b[0] == 0x20 || b[n - 1] == 0x20) return false;
        uint256 i;
        while (i < n) {
            uint8 c = uint8(b[i]);
            uint256 more = 0;
            if (c < 0x80) {
                if (c < 0x20 || c == 0x7f || c == 0x22 || c == 0x5c || c == 0x3c || c == 0x3e || c == 0x26) return false;
            } else if (c >= 0xc2 && c <= 0xdf) {
                more = 1;
            } else if (c >= 0xe0 && c <= 0xef) {
                more = 2;
            } else if (c >= 0xf0 && c <= 0xf4) {
                more = 3;
            } else {
                return false;
            }
            if (more != 0 && i + more >= n) return false;
            for (uint256 k = 1; k <= more; ++k) {
                if (uint8(b[i + k]) & 0xc0 != 0x80) return false;
            }
            // no overlong or surrogate forms
            if (more == 2) {
                uint8 c1 = uint8(b[i + 1]);
                if ((c == 0xe0 && c1 < 0xa0) || (c == 0xed && c1 >= 0xa0)) return false;
            } else if (more == 3) {
                uint8 c1 = uint8(b[i + 1]);
                if ((c == 0xf0 && c1 < 0x90) || (c == 0xf4 && c1 >= 0x90)) return false;
            }
            if (more != 0 && _hidden(_codePoint(b, i, more))) return false;
            i += 1 + more;
        }
        return true;
    }

    function _codePoint(bytes memory b, uint256 i, uint256 more) private pure returns (uint256 cp) {
        cp = uint8(b[i]) & (more == 1 ? 0x1f : more == 2 ? 0x0f : 0x07);
        for (uint256 k = 1; k <= more; ++k) cp = (cp << 6) | (uint8(b[i + k]) & 0x3f);
    }

    /// C1 controls, no-break and odd spaces, soft hyphen, zero-width and direction marks,
    /// fillers, variation selectors, byte-order mark and tag characters.
    function _hidden(uint256 cp) private pure returns (bool) {
        return (cp >= 0x80 && cp <= 0xa0) || cp == 0xad || cp == 0x34f || cp == 0x115f || cp == 0x1160 || cp == 0x180e || (cp >= 0x2000 && cp <= 0x206f)
            || cp == 0x3000 || cp == 0x3164 || (cp >= 0xfe00 && cp <= 0xfe0f) || cp == 0xfeff || cp == 0xffa0 || (cp >= 0xfff0 && cp <= 0xfffb)
            || (cp >= 0xe0000 && cp <= 0xe0fff);
    }

    function _nameKey(bytes memory b) private pure returns (bytes32) {
        bytes memory low = new bytes(b.length);
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            low[i] = (c >= 0x41 && c <= 0x5a) ? bytes1(uint8(c) + 32) : c;
        }
        return keccak256(low);
    }

    /* ── the picture ───────────────────────────────────────────────────── */

    /// @notice Egg line (0 gentle, 1 bold, 2 curious), stage (0 egg .. 4 adult), face
    /// (index into the sixteen expressions) and whether the trace glows, from a state word.
    function lookOf(uint256 state) public pure returns (uint256 line, uint256 stage, uint256 face, bool lit) {
        line = (state >> 152) & 3;
        if (line > 2) line = 0;
        stage = (state >> 148) & 7;
        if (stage > 4) stage = 4; // elders wear the adult picture
        (face, lit) = _mood(state);
    }

    function _mood(uint256 state) private pure returns (uint256 face, bool lit) {
        uint256 food = (state >> 64) & 1023;
        uint256 joy = (state >> 74) & 1023;
        uint256 energy = (state >> 84) & 1023;
        // indices follow EXPRESSIONS in packages/art/src/faces.ts
        if ((state >> 151) & 1 == 1) return (14, false); // asleep
        if ((state >> 219) & 1 == 1) return (12, false); // dizzy (ill)
        if (food < 200) return (13, false); // sad
        if (energy < 200) return (4, false); // sleepy
        if (joy >= 750) return (2, true); // sparkly, trace lit
        if (joy >= 500) return (1, false); // happy
        if (joy < 200) return (3, false); // sulk
        return (0, false); // neutral
    }

    /// @notice The pet's picture for a state word, as an SVG document.
    function svgOf(uint256 state) public view returns (string memory) {
        (uint256 line, uint256 stage, uint256 face, bool lit) = lookOf(state);
        uint256 slot = stage == 0 ? 0 : 10 * (line + 1) + stage;
        bytes memory body = layer[stage == 0 ? 0 : 100 + slot];
        bytes memory litRuns = (stage > 0 && lit) ? layer[200 + slot] : bytes("");
        (bytes memory faceRuns, uint256 fx, uint256 fy) = _face(slot, face);
        Writer memory w = Writer(new bytes(800 + ((body.length + litRuns.length + faceRuns.length) / 4) * 64), 0);
        _put(w, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="');
        bytes memory f = frame[slot];
        if (f.length == 3) {
            _num(w, uint8(f[0]));
            _put(w, " ");
            _num(w, uint8(f[1]));
            _put(w, " ");
            _num(w, uint8(f[2]));
            _put(w, " ");
            _num(w, uint8(f[2]));
        } else {
            _put(w, "0 0 48 48");
        }
        _put(w, '" shape-rendering="crispEdges"><style>');
        _style(w, palette[stage == 0 ? 3 + line : line]);
        _put(w, '</style><rect width="48" height="48" fill="#FFF7E8"/>');
        _runs(w, body, 0, 0);
        _runs(w, litRuns, 0, 0);
        _runs(w, faceRuns, fx, fy);
        _put(w, "</svg>");
        return _done(w);
    }

    function _face(uint256 slot, uint256 face) private view returns (bytes memory runs, uint256 fx, uint256 fy) {
        if (slot == 0) return (runs, 0, 0);
        runs = layer[(largeFace[slot] ? 1016 : 1000) + face];
        bytes memory at = faceAt[slot];
        if (at.length == 32) {
            fx = uint8(at[face * 2]);
            fy = uint8(at[face * 2 + 1]);
        }
    }

    function _done(Writer memory w) private pure returns (string memory) {
        bytes memory out = w.buf;
        uint256 len = w.len;
        assembly {
            mstore(out, len)
        }
        return string(out);
    }

    /// @notice ERC-721 metadata: name, picture and the pet's facts, all from chain.
    function tokenURI(uint256 petId) external view override returns (string memory) {
        PetRegistry.Pet memory p = registry.pet(petId);
        string memory name = bytes(_names[petId]).length != 0 ? _names[petId] : string.concat("Lingxi #", petId.toString());
        string memory json = string.concat(
            '{"name":"',
            name,
            '","description":"A Lingxi pet. Its mind is a TapeOut circuit on X Layer, and this picture is drawn on chain from its saved state.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svgOf(p.state))),
            '","attributes":',
            _attributes(p),
            "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _attributes(PetRegistry.Pet memory p) private pure returns (string memory) {
        uint256 stage = (p.state >> 148) & 7;
        string[8] memory stages = ["egg", "baby", "child", "teen", "adult", "elder", "adult", "adult"];
        return string.concat(
            '[{"trait_type":"stage","value":"',
            stages[stage],
            '"},{"trait_type":"days saved","value":',
            uint256(p.day).toString(),
            '},{"trait_type":"care mistakes","value":',
            ((p.state >> 220) & 63).toString(),
            '},{"trait_type":"kinship","value":',
            ((p.state >> 226) & 255).toString(),
            '},{"trait_type":"generation","value":',
            p.parentA == 0 ? "0" : "1",
            '},{"trait_type":"brain circuit","value":',
            uint256(p.brainId).toString(),
            "}]"
        );
    }

    /* ── a small byte writer (keeps the SVG linear in size) ────────────── */

    struct Writer {
        bytes buf;
        uint256 len;
    }

    function _put(Writer memory w, bytes memory s) private pure {
        for (uint256 i; i < s.length; ++i) w.buf[w.len++] = s[i];
    }

    function _num(Writer memory w, uint256 v) private pure {
        if (v >= 10) w.buf[w.len++] = bytes1(uint8(48 + v / 10));
        w.buf[w.len++] = bytes1(uint8(48 + (v % 10)));
    }

    bytes16 private constant HEX = "0123456789ABCDEF";

    function _style(Writer memory w, bytes memory pal) private pure {
        if (pal.length != 64) return;
        for (uint256 r = 1; r <= 16; ++r) {
            _put(w, ".c");
            _num(w, r);
            _put(w, "{fill:#");
            for (uint256 k; k < 3; ++k) {
                uint8 b = uint8(pal[(r - 1) * 4 + k]);
                w.buf[w.len++] = HEX[b >> 4];
                w.buf[w.len++] = HEX[b & 15];
            }
            // see-through colours as fill-opacity: six-digit hex reads everywhere
            uint256 alpha = uint8(pal[(r - 1) * 4 + 3]);
            if (alpha != 255) {
                _put(w, ";fill-opacity:.");
                uint256 pct = (alpha * 100 + 127) / 255;
                w.buf[w.len++] = bytes1(uint8(48 + pct / 10));
                w.buf[w.len++] = bytes1(uint8(48 + (pct % 10)));
            }
            _put(w, "}");
        }
    }

    function _runs(Writer memory w, bytes memory d, uint256 dx, uint256 dy) private pure {
        for (uint256 j; j + 3 < d.length; j += 4) {
            uint256 x = uint8(d[j]) + dx;
            uint256 y = uint8(d[j + 1]) + dy;
            if (x >= 48 || y >= 48) continue;
            _put(w, '<rect x="');
            _num(w, x);
            _put(w, '" y="');
            _num(w, y);
            _put(w, '" width="');
            _num(w, uint8(d[j + 2]));
            _put(w, '" height="1" class="c');
            _num(w, uint8(d[j + 3]));
            _put(w, '"/>');
        }
    }
}
