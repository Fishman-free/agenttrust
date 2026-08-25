// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentProofOfPersonhood} from "../../src/interfaces/IAgentProofOfPersonhood.sol";

/// @notice Test oracle: any non-empty proof is valid; each nullifier can be consumed exactly once.
/// Recovery verification is non-consuming and records the last verified pair for assertions.
/// Per-wallet failure can be forced to exercise the GUARDIANS recovery path.
contract MockPoHVerifier is IAgentProofOfPersonhood {
    mapping(bytes32 => bool) public consumed;
    mapping(address => bool) public sameIdentityFailures;
    bytes32 public lastVerifiedNullifier;
    address public lastVerifiedWallet;

    function setSameIdentityFailure(address wallet, bool fail) external {
        sameIdentityFailures[wallet] = fail;
    }

    function verifyAndConsume(address, bytes32 nullifier, bytes calldata proof) external returns (bool) {
        if (proof.length == 0) return false;
        if (consumed[nullifier]) return false;
        consumed[nullifier] = true;
        return true;
    }

    function verifySameIdentity(bytes32 nullifier, address newWallet, bytes calldata proof) external returns (bool) {
        if (proof.length == 0) return false;
        lastVerifiedNullifier = nullifier;
        lastVerifiedWallet = newWallet;
        return !sameIdentityFailures[newWallet];
    }
}
