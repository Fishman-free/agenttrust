// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry, ISubjectObligationOracle} from "../src/AgentRegistry.sol";
import {MockERC8004Registry} from "./mocks/MockERC8004Registry.sol";
import {MockPoHVerifier} from "./mocks/MockPoHVerifier.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract AgentRegistryExternalIdentityTest is Test {
    AgentRegistry registry;
    MockERC8004Registry erc8004;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address guardian1 = makeAddr("guardian1");
    address guardian2 = makeAddr("guardian2");
    address verifier = makeAddr("verifier");
    uint256 agentKey = 0xA11CE;
    address agentWallet;

    function setUp() public {
        registry = new AgentRegistry();
        erc8004 = new MockERC8004Registry();
        agentWallet = vm.addr(agentKey);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        registry.setIdentityVerifier(verifier);
    }

    function _guardians() internal returns (address[] memory list) {
        list = new address[](2);
        list[0] = guardian1;
        list[1] = guardian2;
    }

    function _registerAs(address who, uint256 value) internal returns (uint256 id) {
        vm.deal(who, value);
        vm.prank(who);
        id = registry.registerAgent{value: value}("Agent", "desc", "endpoint", _guardians());
    }

    function _bind(address who, uint256 agentId, string memory platform, string memory externalId) internal {
        vm.prank(who);
        registry.bindExternalIdentity(agentId, platform, externalId);
    }

    function _signBinding(uint256 agentId, bytes32 nonce, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("AgentTrust external-agent binding: ", agentId, nonce));
        bytes32 ethSigned = MessageHashUtils.toEthSignedMessageHash(digest);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ethSigned);
        return abi.encodePacked(r, s, v);
    }

    function test_L1_bindDeclaresExternalIdentity() public {
        uint256 id = _registerAs(alice, 1 ether);
        vm.expectEmit(true, false, false, true);
        emit AgentRegistry.ExternalIdentityBound(id, alice, "dify", "app-123");
        _bind(alice, id, "dify", "app-123");

        (string memory platform, string memory externalId,,,,,,) = registry.externalIdentities(id);
        assertEq(platform, "dify");
        assertEq(externalId, "app-123");
        assertEq(uint8(registry.verificationLevelOf(id)), uint8(AgentRegistry.VerificationLevel.Declared));
        assertEq(registry.agentByDeclaredKey("dify", "app-123"), id);
    }

    function test_L1_revertOnForeignAgent() public {
        uint256 id = _registerAs(alice, 1 ether);
        vm.prank(bob);
        vm.expectRevert();
        registry.bindExternalIdentity(id, "dify", "app-123");
    }

    function test_L1_revertOnDuplicateDeclaredKey() public {
        uint256 a = _registerAs(alice, 1 ether);
        uint256 b = _registerAs(bob, 1 ether);
        _bind(alice, a, "dify", "app-123");
        vm.prank(bob);
        vm.expectRevert();
        registry.bindExternalIdentity(b, "dify", "app-123");
    }

    function test_L1_revertOnDoubleBindSameAgent() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "dify", "app-123");
        vm.prank(alice);
        vm.expectRevert();
        registry.bindExternalIdentity(id, "coze", "other-1");
    }

    function test_L1_revertOnEmptyPlatform() public {
        uint256 id = _registerAs(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        registry.bindExternalIdentity(id, "", "app-123");
    }

    function test_proofsRevertBeforeBinding() public {
        uint256 id = _registerAs(alice, 1 ether);
        bytes32 nonce = bytes32(uint256(1));
        vm.prank(alice);
        vm.expectRevert();
        registry.proveKeyControl(id, nonce, _signBinding(id, nonce, agentKey));

        vm.prank(verifier);
        vm.expectRevert();
        registry.attestIdentity(id, 1, bytes32(uint256(7)), "example.com");
    }

    function test_L2_proveKeyControlWithEIP191() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "a2a", "card-xyz");
        bytes32 nonce = bytes32(uint256(42));

        vm.expectEmit(true, false, false, true);
        emit AgentRegistry.KeyControlProved(id, agentWallet);
        vm.prank(alice);
        registry.proveKeyControl(id, nonce, _signBinding(id, nonce, agentKey));

        (,,, address controlKey,,,,) = registry.externalIdentities(id);
        assertEq(controlKey, agentWallet);
        assertEq(uint8(registry.verificationLevelOf(id)), uint8(AgentRegistry.VerificationLevel.KeyControl));
    }

    function test_L2_revertOnReplayedNonce() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "a2a", "card-xyz");
        bytes32 nonce = bytes32(uint256(42));
        vm.startPrank(alice);
        registry.proveKeyControl(id, nonce, _signBinding(id, nonce, agentKey));
        vm.expectRevert();
        registry.proveKeyControl(id, nonce, _signBinding(id, nonce, agentKey));
        vm.stopPrank();
    }

    function test_L2_revertOnForeignCaller() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "a2a", "card-xyz");
        bytes32 nonce = bytes32(uint256(42));
        vm.prank(bob);
        vm.expectRevert();
        registry.proveKeyControl(id, nonce, _signBinding(id, nonce, agentKey));
    }

    function test_L3_attestDomainControl() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "mcp", "server-1");
        bytes32 proofHash = keccak256("well-known artifact");

        vm.prank(verifier);
        registry.attestIdentity(id, 2, proofHash, "api.agent.example");

        (,, string memory domain,,,, bytes32 stored, uint64 at) = registry.externalIdentities(id);
        assertEq(domain, "api.agent.example");
        assertEq(stored, proofHash);
        assertGt(at, 0);
        assertEq(uint8(registry.verificationLevelOf(id)), uint8(AgentRegistry.VerificationLevel.DomainControl));
    }

    function test_L3_attestFromNonVerifierReverts() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "mcp", "server-1");
        vm.prank(alice);
        vm.expectRevert();
        registry.attestIdentity(id, 2, bytes32(uint256(7)), "api.agent.example");
    }

    function test_levelMonotonicNoDowngrade() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "mcp", "server-1");
        vm.prank(verifier);
        registry.attestIdentity(id, 2, bytes32(uint256(7)), "api.agent.example");
        vm.prank(verifier);
        vm.expectRevert();
        registry.attestIdentity(id, 1, bytes32(uint256(8)), "");
    }

    function test_L3_domainRequiredForDomainControl() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "mcp", "server-1");
        vm.prank(verifier);
        vm.expectRevert();
        registry.attestIdentity(id, 2, bytes32(uint256(7)), "");
    }

    function test_L3_attestUnknownLevelReverts() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "mcp", "server-1");
        vm.prank(verifier);
        vm.expectRevert();
        registry.attestIdentity(id, 3, bytes32(uint256(7)), "");
    }

    function test_L4_linkErc8004() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "erc8004", "token-5");
        erc8004.mint(alice, 5);

        vm.expectEmit(true, false, false, true);
        emit AgentRegistry.Erc8004Linked(id, address(erc8004), 5);
        vm.prank(alice);
        registry.linkErc8004(id, address(erc8004), 5);

        (,,,, address reg, uint256 extId,,) = registry.externalIdentities(id);
        assertEq(reg, address(erc8004));
        assertEq(extId, 5);
        assertEq(uint8(registry.verificationLevelOf(id)), uint8(AgentRegistry.VerificationLevel.Erc8004));
    }

    function test_L4_revertWhenCallerDoesNotOwnExternalToken() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "erc8004", "token-5");
        erc8004.mint(bob, 5);
        vm.prank(alice);
        vm.expectRevert();
        registry.linkErc8004(id, address(erc8004), 5);
    }

    function test_deregisterFreesDeclaredKey() public {
        uint256 id = _registerAs(alice, 1 ether);
        _bind(alice, id, "dify", "app-123");
        vm.prank(alice);
        registry.deregister();
        assertEq(registry.agentByDeclaredKey("dify", "app-123"), 0);

        uint256 newId = _registerAs(bob, 1 ether);
        _bind(bob, newId, "dify", "app-123");
        assertEq(registry.agentByDeclaredKey("dify", "app-123"), newId);
    }

    function test_recoveryMigrationPreservesExternalIdentity() public {
        MockPoHVerifier poh = new MockPoHVerifier();
        registry.setPoHVerifier(address(poh));
        registry.setRegistrationDeposit(1 ether);
        bytes32 nullifier = keccak256("human-alice");
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        uint256 id = registry.registerAgentVerified{value: 1 ether}(
            "Agent", "desc", "endpoint", nullifier, hex"01", _guardians()
        );

        _bind(alice, id, "a2a", "card-xyz");
        bytes32 nonce = bytes32(uint256(42));
        vm.prank(alice);
        registry.proveKeyControl(id, nonce, _signBinding(id, nonce, agentKey));

        vm.prank(bob);
        registry.requestRecovery(nullifier, hex"01", bob);
        vm.prank(guardian1);
        registry.approveRecovery(alice);
        vm.warp(block.timestamp + 24 hours);
        registry.executeRecovery(alice);

        assertEq(registry.ownerOf(id), bob, "NFT control moves");
        (string memory platform,,, address controlKey,,,,) = registry.externalIdentities(id);
        assertEq(platform, "a2a");
        assertEq(controlKey, agentWallet);
        assertEq(registry.agentByDeclaredKey("a2a", "card-xyz"), id);
        assertEq(uint8(registry.verificationLevelOf(id)), uint8(AgentRegistry.VerificationLevel.KeyControl));
    }
}
