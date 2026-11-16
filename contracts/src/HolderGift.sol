// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface IGiftMarket {
    function mintTo(uint256 id, address to, uint32 quantity) external;
}

interface IOwnerOf {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title Lingxi holder gift
/// @notice A free outfit for people who hold TapeOut-ecosystem assets on X Layer. A wallet claims once.
/// NFT holders (TapeCode-Test1, TapeOut Rig) claim through a token they own, and each token gives the gift only
/// once ever, so passing an NFT around cannot multiply gifts. BEM and FAB holders claim from a snapshot of
/// balances at a fixed block, committed to as a Merkle root that anyone can rebuild from the tokens' Transfer
/// events (packages/chain/scripts/holder-snapshot.ts); a live balance would let one stake be passed between
/// wallets to claim again and again. Gas is the only cost. The market caps how many gifts this contract may mint.
contract HolderGift {
    IGiftMarket public immutable market;
    uint256 public immutable outfit;
    address public immutable test1;
    address public immutable rig;
    /// Root of the OpenZeppelin standard Merkle tree of (wallet, BEM, FAB) at `snapshotBlock`.
    bytes32 public immutable snapshotRoot;
    uint256 public immutable snapshotBlock;
    uint256 public immutable bemMin;
    uint256 public immutable fabMin;

    mapping(address => bool) public claimed;
    mapping(address => mapping(uint256 => bool)) public tokenUsed;
    uint256 public total;

    event Claimed(address indexed wallet, address indexed via, uint256 tokenId);

    error AlreadyClaimed();
    error TokenUsed();
    error NotHolder();
    error UnknownCollection();
    error BadSetup();

    constructor(IGiftMarket market_, uint256 outfit_, address test1_, address rig_, bytes32 snapshotRoot_, uint256 snapshotBlock_, uint256 bemMin_, uint256 fabMin_) {
        if (address(market_) == address(0) || test1_ == address(0) || rig_ == address(0) || snapshotRoot_ == bytes32(0) || snapshotBlock_ == 0 || bemMin_ == 0 || fabMin_ == 0) {
            revert BadSetup();
        }
        market = market_;
        outfit = outfit_;
        test1 = test1_;
        rig = rig_;
        snapshotRoot = snapshotRoot_;
        snapshotBlock = snapshotBlock_;
        bemMin = bemMin_;
        fabMin = fabMin_;
    }

    /// @notice Claim through an NFT you own: a TapeCode-Test1 or a TapeOut Rig.
    function claimWithNft(address collection, uint256 tokenId) external {
        if (collection != test1 && collection != rig) revert UnknownCollection();
        if (IOwnerOf(collection).ownerOf(tokenId) != msg.sender) revert NotHolder();
        if (tokenUsed[collection][tokenId]) revert TokenUsed();
        tokenUsed[collection][tokenId] = true;
        _give(collection, tokenId);
    }

    /// @notice Claim as a BEM or FAB holder at the snapshot block, with your entry's proof.
    function claimWithSnapshot(uint256 bemAtSnapshot, uint256 fabAtSnapshot, bytes32[] calldata proof) external {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, bemAtSnapshot, fabAtSnapshot))));
        if (!MerkleProof.verifyCalldata(proof, snapshotRoot, leaf)) revert NotHolder();
        if (bemAtSnapshot < bemMin && fabAtSnapshot < fabMin) revert NotHolder();
        _give(address(0), 0);
    }

    function _give(address via, uint256 tokenId) private {
        if (claimed[msg.sender]) revert AlreadyClaimed();
        claimed[msg.sender] = true;
        total += 1;
        emit Claimed(msg.sender, via, tokenId);
        market.mintTo(outfit, msg.sender, 1);
    }
}
