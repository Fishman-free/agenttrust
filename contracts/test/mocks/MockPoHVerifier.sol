// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentProofOfPersonhood} from "../../src/AgentRegistry.sol";

/// @notice Test oracle: any non-empty proof is valid, but each nullifier can be consumed exactly once.
contract MockPoHVerifier is IAgentProofOfPersonhood {
    mapping(bytes32 => bool) public consumed;

    function verifyAndConsume(address, bytes32 nullifier, bytes calldata proof) external returns (bool) {
        if (proof.length == 0) return false;
        if (consumed[nullifier]) return false;
        consumed[nullifier] = true;
        return true;
    }
}
