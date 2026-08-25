// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal proof-of-personhood verifier surface consumed by AgentRegistry.
/// Implementations: MockPoHVerifier (tests), WorldIDPoHVerifier (World ID on supported chains).
interface IAgentProofOfPersonhood {
    /// @notice One-shot human verification bound to `subject`; each nullifier can be consumed once.
    function verifyAndConsume(address subject, bytes32 nullifier, bytes calldata proof) external returns (bool);

    /// @notice Non-consuming re-verification that the human bound to `nullifier` authorizes `newWallet`.
    /// The proof must bind the recovery signal to newWallet. Replays are harmless by design:
    /// the registry gates state transitions with request nonces, expiry and one-shot execution.
    function verifySameIdentity(bytes32 nullifier, address newWallet, bytes calldata proof) external returns (bool);
}
