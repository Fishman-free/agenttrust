// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentProofOfPersonhood} from "./interfaces/IAgentProofOfPersonhood.sol";

/// @notice Minimal surface of the official World ID router (V1 deployments, e.g. Base Sepolia).
/// Pinned against the deployed `WorldIDRouterImplV1` ABI; verify at integration time.
interface IWorldIDRouterV1 {
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifier,
        bytes calldata proof
    ) external;

    function latestRoot() external view returns (uint256);

    function verifierLookupTable(uint256 groupId) external view returns (address);
}

/// @notice Minimal surface of the official World ID Semaphore verifier (V1).
/// Declared without a return value so `try/catch` works regardless of the deployed ABI;
/// the verifier reverts on invalid proofs.
interface IWorldIDSemaphoreVerifierV1 {
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) external view;
}

/// @notice World ID adapter implementing the registry's PoH surface.
///
/// Registration and upgrade proofs (`verifyAndConsume`) go through the official router,
/// which enforces one consumption per (externalNullifier, nullifierHash).
///
/// Recovery proofs (`verifySameIdentity`) are verified NON-consuming: the underlying
/// Semaphore verifier is called directly with the official latest root, and the ZK proof
/// itself binds nullifierHash (must equal the registered anchor) and signalHash (must be
/// the new wallet). Nothing is marked consumed, so replays are possible but harmless —
/// the registry gates state transitions with nonces, expiry and one-shot execution.
///
/// Hashing scheme (must match the frontend proof generator):
///   signalHash        = uint256(keccak256(abi.encodePacked(wallet))) >> 8
///   externalNullifier = uint256(keccak256(abi.encodePacked(appId, action))) >> 8
/// Registration and recovery MUST use the same World ID action so the same device yields
/// the same nullifierHash for both flows (anchor equality is what proves "same human").
contract WorldIDPoHVerifier is IAgentProofOfPersonhood {
    IWorldIDRouterV1 public immutable router;
    uint256 public immutable groupId;
    uint256 public immutable externalNullifier;

    constructor(address router_, uint256 groupId_, string memory appId, string memory action) {
        require(router_ != address(0), unicode"WorldIDPoHVerifier: 路由地址为零");
        require(
            bytes(appId).length != 0 && bytes(action).length != 0,
            unicode"WorldIDPoHVerifier: 应用与动作不能为空"
        );
        router = IWorldIDRouterV1(router_);
        groupId = groupId_;
        externalNullifier = uint256(keccak256(abi.encodePacked(appId, action))) >> 8;
    }

    function verifyAndConsume(address subject, bytes32 nullifier, bytes calldata proof) external returns (bool) {
        router.verifyProof(
            router.latestRoot(), groupId, _signalHash(subject), uint256(nullifier), externalNullifier, proof
        );
        return true;
    }

    function verifySameIdentity(bytes32 nullifier, address newWallet, bytes calldata proof) external returns (bool) {
        address verifier = router.verifierLookupTable(groupId);
        if (verifier == address(0)) return false;
        try IWorldIDSemaphoreVerifierV1(verifier)
            .verifyProof(
                router.latestRoot(),
                groupId,
                _signalHash(newWallet),
                uint256(nullifier),
                externalNullifier,
                abi.decode(proof, (uint256[8]))
            ) {
            return true;
        } catch {
            return false;
        }
    }

    function _signalHash(address wallet) private pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(wallet))) >> 8;
    }
}
