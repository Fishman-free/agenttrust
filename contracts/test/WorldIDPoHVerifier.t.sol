// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WorldIDPoHVerifier, IWorldIDRouterV1} from "../src/WorldIDPoHVerifier.sol";

/// @notice Fake World ID Semaphore verifier: accepts only pre-configured inputs, reverts otherwise.
/// Implemented as `view` (the adapter calls it through a STATICCALL in a try/catch).
contract FakeSemaphoreVerifier {
    bool public fail;
    uint256 public expectedRoot;
    uint256 public expectedGroupId;
    uint256 public expectedSignalHash;
    uint256 public expectedNullifierHash;
    uint256 public expectedExternalNullifier;
    uint256[8] public expectedProof;

    function configure(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifier,
        uint256[8] calldata proof,
        bool fail_
    ) external {
        expectedRoot = root;
        expectedGroupId = groupId;
        expectedSignalHash = signalHash;
        expectedNullifierHash = nullifierHash;
        expectedExternalNullifier = externalNullifier;
        expectedProof = proof;
        fail = fail_;
    }

    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) external view {
        require(!fail, "fake: forced failure");
        require(
            root == expectedRoot && groupId == expectedGroupId && signalHash == expectedSignalHash
                && nullifierHash == expectedNullifierHash && externalNullifier == expectedExternalNullifier,
            "fake: input mismatch"
        );
        for (uint256 i; i < 8; ++i) {
            require(proof[i] == expectedProof[i], "fake: proof mismatch");
        }
    }
}

/// @notice Fake World ID router: consumes (externalNullifier, nullifierHash) exactly once.
contract FakeRouter is IWorldIDRouterV1 {
    uint256 public root;
    uint256 public groupId;
    mapping(uint256 => address) public verifierLookupTable;
    mapping(uint256 => mapping(uint256 => bool)) public usedNullifiers;
    uint256 public lastSignalHash;
    uint256 public lastNullifierHash;
    uint256 public lastExternalNullifier;

    function setRoot(uint256 root_) external {
        root = root_;
    }

    function setGroupId(uint256 groupId_) external {
        groupId = groupId_;
    }

    function setVerifier(uint256 groupId_, address verifier_) external {
        verifierLookupTable[groupId_] = verifier_;
    }

    function latestRoot() external view returns (uint256) {
        return root;
    }

    function verifyProof(
        uint256 root_,
        uint256 groupId_,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifier,
        bytes calldata proof
    ) external {
        require(root_ == root, "router: bad root");
        require(groupId_ == groupId, "router: bad group");
        require(proof.length != 0, "router: empty proof");
        require(!usedNullifiers[externalNullifier][nullifierHash], "router: already used");
        usedNullifiers[externalNullifier][nullifierHash] = true;
        lastSignalHash = signalHash;
        lastNullifierHash = nullifierHash;
        lastExternalNullifier = externalNullifier;
    }
}

contract WorldIDPoHVerifierTest is Test {
    FakeRouter router;
    FakeSemaphoreVerifier semaphore;
    WorldIDPoHVerifier verifier;
    uint256 constant GROUP_ID = 1;
    uint256 constant ROOT = 12345;

    function setUp() public {
        router = new FakeRouter();
        semaphore = new FakeSemaphoreVerifier();
        router.setRoot(ROOT);
        router.setGroupId(GROUP_ID);
        router.setVerifier(GROUP_ID, address(semaphore));
        verifier = new WorldIDPoHVerifier(address(router), GROUP_ID, "app_test", "agenttrust-identity");
    }

    function test_verifyAndConsumeForwardsAndConsumesOnce() public {
        bytes32 nullifier = keccak256("human");
        address subject = makeAddr("subject");
        bytes memory proof = abi.encode(uint256(1));

        assertTrue(verifier.verifyAndConsume(subject, nullifier, proof));
        assertTrue(router.usedNullifiers(verifier.externalNullifier(), uint256(nullifier)));
        assertEq(router.lastSignalHash(), uint256(keccak256(abi.encodePacked(subject))) >> 8);
        assertEq(router.lastNullifierHash(), uint256(nullifier));
        assertEq(router.lastExternalNullifier(), verifier.externalNullifier());

        // 同一 nullifier 二次消费被路由拒绝，revert 传播给调用方
        vm.expectRevert();
        verifier.verifyAndConsume(subject, nullifier, proof);
    }

    function test_verifySameIdentityAcceptsMatchingProofWithoutConsuming() public {
        bytes32 nullifier = keccak256("human");
        address newWallet = makeAddr("new-wallet");
        uint256 signalHash = uint256(keccak256(abi.encodePacked(newWallet))) >> 8;
        uint256[8] memory proof;
        proof[0] = 1;
        semaphore.configure(ROOT, GROUP_ID, signalHash, uint256(nullifier), verifier.externalNullifier(), proof, false);

        assertTrue(verifier.verifySameIdentity(nullifier, newWallet, abi.encode(proof)));
        assertFalse(
            router.usedNullifiers(verifier.externalNullifier(), uint256(nullifier)),
            "same-identity verification must not consume"
        );
    }

    function test_verifySameIdentityRejectsMismatchedOrFailingProof() public {
        bytes32 nullifier = keccak256("human");
        address newWallet = makeAddr("new-wallet");
        uint256 signalHash = uint256(keccak256(abi.encodePacked(newWallet))) >> 8;
        uint256[8] memory proof;
        proof[0] = 1;

        // 锚点不匹配（另一个 nullifierHash）→ 拒绝
        semaphore.configure(
            ROOT, GROUP_ID, signalHash, uint256(nullifier) + 1, verifier.externalNullifier(), proof, false
        );
        assertFalse(verifier.verifySameIdentity(nullifier, newWallet, abi.encode(proof)));

        // 底层验证器失败（等价于无效 ZK 证明）→ 拒绝
        semaphore.configure(ROOT, GROUP_ID, signalHash, uint256(nullifier), verifier.externalNullifier(), proof, true);
        assertFalse(verifier.verifySameIdentity(nullifier, newWallet, abi.encode(proof)));
    }

    function test_verifySameIdentityRejectsMissingVerifier() public {
        WorldIDPoHVerifier orphan = new WorldIDPoHVerifier(address(router), 99, "app_test", "agenttrust-identity");
        assertFalse(orphan.verifySameIdentity(keccak256("human"), makeAddr("wallet"), new bytes(0)));
    }

    function test_constructorValidatesInputs() public {
        vm.expectRevert(unicode"WorldIDPoHVerifier: 路由地址为零");
        new WorldIDPoHVerifier(address(0), GROUP_ID, "app", "action");

        vm.expectRevert(unicode"WorldIDPoHVerifier: 应用与动作不能为空");
        new WorldIDPoHVerifier(address(router), GROUP_ID, "", "action");
    }
}
