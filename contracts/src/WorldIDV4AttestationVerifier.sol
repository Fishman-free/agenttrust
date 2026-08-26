// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IAgentProofOfPersonhood} from "./interfaces/IAgentProofOfPersonhood.sol";

/// @notice Verifies short-lived enrollment attestations produced by a trusted World ID v4 backend.
/// @dev The backend must verify the World ID proof before signing. EIP-712 binds every signature to
/// this verifier and chain. This adapter deliberately provides no same-identity recovery proof.
contract WorldIDV4AttestationVerifier is IAgentProofOfPersonhood, EIP712 {
    bytes32 public constant ENROLLMENT_ATTESTATION_TYPEHASH = keccak256(
        "EnrollmentAttestation(address subject,bytes32 nullifier,bytes32 actionHash,uint256 expiry,bytes32 nonce)"
    );
    uint256 public constant MAX_ATTESTATION_TTL = 15 minutes;

    address public immutable registry;
    address public immutable trustedAttester;
    bytes32 public immutable actionHash;

    mapping(bytes32 => bool) public usedNullifiers;
    mapping(bytes32 => bool) public usedNonces;

    error OnlyRegistry();
    error ZeroAddress();
    error InvalidActionHash();
    error InvalidNullifier();
    error AttestationExpired();
    error AttestationTooLongLived();
    error NullifierAlreadyUsed();
    error NonceAlreadyUsed();
    error InvalidSignature();

    constructor(address registry_, address trustedAttester_, bytes32 actionHash_) EIP712("AgentTrust WorldID v4", "1") {
        if (registry_ == address(0) || trustedAttester_ == address(0)) revert ZeroAddress();
        if (actionHash_ == bytes32(0)) revert InvalidActionHash();
        registry = registry_;
        trustedAttester = trustedAttester_;
        actionHash = actionHash_;
    }

    modifier onlyRegistry() {
        if (msg.sender != registry) revert OnlyRegistry();
        _;
    }

    /// @param proof ABI encoding of (bytes32 attestedActionHash, uint256 expiry,
    /// bytes32 nonce, bytes signature).
    function verifyAndConsume(address subject, bytes32 nullifier, bytes calldata proof)
        external
        onlyRegistry
        returns (bool)
    {
        (bytes32 attestedActionHash, uint256 expiry, bytes32 nonce, bytes memory signature) =
            abi.decode(proof, (bytes32, uint256, bytes32, bytes));

        if (nullifier == bytes32(0)) revert InvalidNullifier();
        if (attestedActionHash != actionHash) revert InvalidActionHash();
        if (expiry < block.timestamp) revert AttestationExpired();
        if (expiry > block.timestamp + MAX_ATTESTATION_TTL) revert AttestationTooLongLived();
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed();
        if (usedNonces[nonce]) revert NonceAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(ENROLLMENT_ATTESTATION_TYPEHASH, subject, nullifier, attestedActionHash, expiry, nonce)
        );
        (address recovered, ECDSA.RecoverError recoverError,) =
            ECDSA.tryRecover(_hashTypedDataV4(structHash), signature);
        if (recoverError != ECDSA.RecoverError.NoError || recovered != trustedAttester) revert InvalidSignature();

        usedNullifiers[nullifier] = true;
        usedNonces[nonce] = true;
        return true;
    }

    /// @dev Backend enrollment attestations cannot prove continuity with a lost wallet.
    /// Returning false forces AgentRegistry onto its all-guardian recovery path.
    function verifySameIdentity(bytes32, address, bytes calldata) external view onlyRegistry returns (bool) {
        return false;
    }
}
