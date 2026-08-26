// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WorldIDV4AttestationVerifier} from "../src/WorldIDV4AttestationVerifier.sol";

contract WorldIDV4AttestationVerifierTest is Test {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("AgentTrust WorldID v4");
    bytes32 private constant VERSION_HASH = keccak256("1");

    uint256 private attesterKey;
    address private attester;
    address private registry;
    address private subject;
    bytes32 private actionHash;
    WorldIDV4AttestationVerifier private verifier;

    function setUp() public {
        vm.chainId(84532);
        (attester, attesterKey) = makeAddrAndKey("world-id-v4-attester");
        registry = makeAddr("registry");
        subject = makeAddr("subject");
        actionHash = keccak256("agenttrust-enrollment");
        verifier = new WorldIDV4AttestationVerifier(registry, attester, actionHash);
        vm.warp(1_000_000);
    }

    function test_validAttestationConsumesNullifierAndNonce() public {
        bytes32 nullifier = keccak256("nullifier-1");
        bytes32 nonce = keccak256("nonce-1");
        uint256 expiry = block.timestamp + 5 minutes;
        bytes memory proof = _proof(verifier, attesterKey, subject, nullifier, actionHash, expiry, nonce);

        vm.prank(registry);
        assertTrue(verifier.verifyAndConsume(subject, nullifier, proof));
        assertTrue(verifier.usedNullifiers(nullifier));
        assertTrue(verifier.usedNonces(nonce));
    }

    function test_rejectsWrongSigner() public {
        (, uint256 wrongKey) = makeAddrAndKey("wrong-attester");
        bytes32 nullifier = keccak256("nullifier");
        bytes32 nonce = keccak256("nonce");
        bytes memory proof =
            _proof(verifier, wrongKey, subject, nullifier, actionHash, block.timestamp + 5 minutes, nonce);

        vm.prank(registry);
        vm.expectRevert(WorldIDV4AttestationVerifier.InvalidSignature.selector);
        verifier.verifyAndConsume(subject, nullifier, proof);
    }

    function test_rejectsWrongSubject() public {
        bytes32 nullifier = keccak256("nullifier");
        bytes32 nonce = keccak256("nonce");
        bytes memory proof =
            _proof(verifier, attesterKey, subject, nullifier, actionHash, block.timestamp + 5 minutes, nonce);

        vm.prank(registry);
        vm.expectRevert(WorldIDV4AttestationVerifier.InvalidSignature.selector);
        verifier.verifyAndConsume(makeAddr("other-subject"), nullifier, proof);
    }

    function test_rejectsWrongNullifier() public {
        bytes32 signedNullifier = keccak256("signed-nullifier");
        bytes32 nonce = keccak256("nonce");
        bytes memory proof =
            _proof(verifier, attesterKey, subject, signedNullifier, actionHash, block.timestamp + 5 minutes, nonce);

        vm.prank(registry);
        vm.expectRevert(WorldIDV4AttestationVerifier.InvalidSignature.selector);
        verifier.verifyAndConsume(subject, keccak256("other-nullifier"), proof);
    }

    function test_rejectsWrongAction() public {
        bytes32 nullifier = keccak256("nullifier");
        bytes32 nonce = keccak256("nonce");
        bytes32 wrongAction = keccak256("other-action");
        bytes memory proof =
            _proof(verifier, attesterKey, subject, nullifier, wrongAction, block.timestamp + 5 minutes, nonce);

        vm.prank(registry);
        vm.expectRevert(WorldIDV4AttestationVerifier.InvalidActionHash.selector);
        verifier.verifyAndConsume(subject, nullifier, proof);
    }

    function test_rejectsExpiredAttestation() public {
        bytes32 nullifier = keccak256("nullifier");
        bytes32 nonce = keccak256("nonce");
        uint256 expiry = block.timestamp - 1;
        bytes memory proof = _proof(verifier, attesterKey, subject, nullifier, actionHash, expiry, nonce);

        vm.prank(registry);
        vm.expectRevert(WorldIDV4AttestationVerifier.AttestationExpired.selector);
        verifier.verifyAndConsume(subject, nullifier, proof);
    }

    function test_rejectsAttestationBeyondShortLifetime() public {
        bytes32 nullifier = keccak256("nullifier");
        bytes32 nonce = keccak256("nonce");
        uint256 expiry = block.timestamp + verifier.MAX_ATTESTATION_TTL() + 1;
        bytes memory proof = _proof(verifier, attesterKey, subject, nullifier, actionHash, expiry, nonce);

        vm.prank(registry);
        vm.expectRevert(WorldIDV4AttestationVerifier.AttestationTooLongLived.selector);
        verifier.verifyAndConsume(subject, nullifier, proof);
    }

    function test_rejectsReplayedNullifier() public {
        bytes32 nullifier = keccak256("nullifier");
        uint256 expiry = block.timestamp + 5 minutes;
        bytes memory first = _proof(verifier, attesterKey, subject, nullifier, actionHash, expiry, keccak256("nonce-1"));
        bytes memory replay =
            _proof(verifier, attesterKey, subject, nullifier, actionHash, expiry, keccak256("nonce-2"));

        vm.startPrank(registry);
        verifier.verifyAndConsume(subject, nullifier, first);
        vm.expectRevert(WorldIDV4AttestationVerifier.NullifierAlreadyUsed.selector);
        verifier.verifyAndConsume(subject, nullifier, replay);
        vm.stopPrank();
    }

    function test_rejectsReplayedNonce() public {
        bytes32 nonce = keccak256("nonce");
        uint256 expiry = block.timestamp + 5 minutes;
        bytes32 firstNullifier = keccak256("nullifier-1");
        bytes32 secondNullifier = keccak256("nullifier-2");
        bytes memory first = _proof(verifier, attesterKey, subject, firstNullifier, actionHash, expiry, nonce);
        bytes memory replay = _proof(verifier, attesterKey, subject, secondNullifier, actionHash, expiry, nonce);

        vm.startPrank(registry);
        verifier.verifyAndConsume(subject, firstNullifier, first);
        vm.expectRevert(WorldIDV4AttestationVerifier.NonceAlreadyUsed.selector);
        verifier.verifyAndConsume(subject, secondNullifier, replay);
        vm.stopPrank();
    }

    function test_rejectsNonRegistryCaller() public {
        bytes32 nullifier = keccak256("nullifier");
        bytes32 nonce = keccak256("nonce");
        bytes memory proof =
            _proof(verifier, attesterKey, subject, nullifier, actionHash, block.timestamp + 5 minutes, nonce);

        vm.expectRevert(WorldIDV4AttestationVerifier.OnlyRegistry.selector);
        verifier.verifyAndConsume(subject, nullifier, proof);

        vm.expectRevert(WorldIDV4AttestationVerifier.OnlyRegistry.selector);
        verifier.verifySameIdentity(nullifier, makeAddr("new-wallet"), "");
    }

    function test_verifySameIdentityHonestlyReturnsFalseForRegistry() public {
        vm.prank(registry);
        assertFalse(verifier.verifySameIdentity(keccak256("nullifier"), makeAddr("new-wallet"), hex"1234"));
    }

    function test_signatureIsBoundToChainAndVerifier() public {
        bytes32 nullifier = keccak256("nullifier");
        bytes32 nonce = keccak256("nonce");
        uint256 expiry = block.timestamp + 5 minutes;
        bytes memory proof = _proof(verifier, attesterKey, subject, nullifier, actionHash, expiry, nonce);

        vm.chainId(84533);
        vm.prank(registry);
        vm.expectRevert(WorldIDV4AttestationVerifier.InvalidSignature.selector);
        verifier.verifyAndConsume(subject, nullifier, proof);

        vm.chainId(84532);
        WorldIDV4AttestationVerifier otherVerifier = new WorldIDV4AttestationVerifier(registry, attester, actionHash);
        vm.prank(registry);
        vm.expectRevert(WorldIDV4AttestationVerifier.InvalidSignature.selector);
        otherVerifier.verifyAndConsume(subject, nullifier, proof);
    }

    function test_constructorRejectsInvalidConfiguration() public {
        vm.expectRevert(WorldIDV4AttestationVerifier.ZeroAddress.selector);
        new WorldIDV4AttestationVerifier(address(0), attester, actionHash);

        vm.expectRevert(WorldIDV4AttestationVerifier.ZeroAddress.selector);
        new WorldIDV4AttestationVerifier(registry, address(0), actionHash);

        vm.expectRevert(WorldIDV4AttestationVerifier.InvalidActionHash.selector);
        new WorldIDV4AttestationVerifier(registry, attester, bytes32(0));
    }

    function _proof(
        WorldIDV4AttestationVerifier target,
        uint256 signerKey,
        address attestedSubject,
        bytes32 nullifier,
        bytes32 attestedActionHash,
        uint256 expiry,
        bytes32 nonce
    ) private returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                target.ENROLLMENT_ATTESTATION_TYPEHASH(), attestedSubject, nullifier, attestedActionHash, expiry, nonce
            )
        );
        bytes32 domainSeparator =
            keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(target)));
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encode(attestedActionHash, expiry, nonce, abi.encodePacked(r, s, v));
    }
}
