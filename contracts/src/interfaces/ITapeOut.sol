// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The parts of a TapeOut processor Lingxi calls. Names and selectors were
/// checked against the deployed contracts on X Layer.
interface ITapeOutProcessor {
    function circuitInfo(uint256 id)
        external
        view
        returns (uint256 nIn, uint256 nOut, uint256 nState, uint256 gateCount);

    function step(uint256 id, bytes calldata state, bytes calldata inputs)
        external
        view
        returns (bytes memory newState, bytes memory outputs);

    function ownerOf(uint256 id) external view returns (address);
}

interface ITapeOutFactory {
    function isCPU(address cpu) external view returns (bool);
}
