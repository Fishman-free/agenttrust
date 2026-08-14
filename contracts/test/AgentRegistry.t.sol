// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {MockPoHVerifier} from "./mocks/MockPoHVerifier.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract RejectEther is IERC721Receiver {
    receive() external payable {
        revert("no ether");
    }

    function register(AgentRegistry registry) external payable returns (uint256) {
        return registry.registerAgent{value: msg.value}("ContractAgent", "desc", "endpoint");
    }

    function withdraw(AgentRegistry registry, address payable recipient) external {
        registry.withdraw(recipient);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract AgentRegistryTest is Test {
    AgentRegistry registry;
    address alice = makeAddr("alice");

    function setUp() public {
        registry = new AgentRegistry();
        vm.deal(alice, 10 ether);
    }

    function test_registrationBindsImmutableResponsibleSubjectAndSnapshot() public {
        vm.prank(alice);
        uint256 id = registry.registerAgent("Agent", "desc", "endpoint");
        uint256 registeredBlock = block.number;

        assertEq(registry.ownerOf(id), alice);
        assertEq(registry.responsibleParty(id), alice);
        assertTrue(registry.isRegisteredSubjectAt(alice, registeredBlock));
        assertFalse(registry.isRegisteredSubjectAt(alice, registeredBlock - 1));

        vm.prank(alice);
        registry.transferFrom(alice, makeAddr("buyer"), id);
        assertEq(registry.responsibleParty(id), alice, "NFT transfer must not rewrite legal subject");
    }

    function test_overpaymentUsesPullPaymentAndCannotDosRegistration() public {
        registry.setRegistrationFee(1 ether);
        RejectEther rejector = new RejectEther();
        vm.deal(address(rejector), 2 ether);

        rejector.register{value: 2 ether}(registry);
        assertEq(registry.pendingWithdrawals(address(rejector)), 1 ether);
        assertEq(registry.accruedFees(), 1 ether);

        address recipient = makeAddr("recipient");
        rejector.withdraw(registry, payable(recipient));
        assertEq(recipient.balance, 1 ether);
    }

    function test_ownerFeesAreCreditedBeforeWithdrawal() public {
        registry.setRegistrationFee(1 ether);
        vm.prank(alice);
        registry.registerAgent{value: 1 ether}("Agent", "desc", "endpoint");

        registry.withdrawFees();
        assertEq(registry.accruedFees(), 0);
        assertEq(registry.pendingWithdrawals(address(this)), 1 ether);

        registry.withdraw(payable(alice));
        assertEq(alice.balance, 10 ether);
    }

    function test_nonexistentAgentRejected() public {
        vm.expectRevert();
        registry.responsibleParty(0);
    }

    function test_sameSubjectCannotClaimTwoCommunityIds() public {
        vm.prank(alice);
        registry.registerAgent("Agent", "desc", "endpoint");

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 主体已注册");
        registry.registerAgent("SecondIdentity", "desc", "endpoint");
    }

    function test_verifiedRegistrationBindsOneHumanToOneIdAcrossWallets() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        vm.deal(alice, 1 ether);

        // 开启人类证明后，纯质押路径必须拒绝
        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 需提供人类证明");
        registry.registerAgent("Agent", "desc", "endpoint");

        // 有效人类证明注册成功
        bytes32 aliceNullifier = keccak256("human-alice");
        vm.prank(alice);
        uint256 id = registry.registerAgentVerified("Agent", "desc", "endpoint", aliceNullifier, hex"01");
        assertEq(registry.ownerOf(id), alice);
        assertTrue(registry.usedPoHNullifiers(aliceNullifier));

        // 同一人类换钱包、复用同一 nullifier：注册表拒绝（即使预言机被绕过）
        address bob = makeAddr("bob");
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(unicode"AgentRegistry: nullifier 已使用");
        registry.registerAgentVerified("Bob", "desc", "endpoint", aliceNullifier, hex"02");

        // 同一钱包第二身份：主体已注册，拒绝
        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 主体已注册");
        registry.registerAgentVerified("Second", "desc", "endpoint", keccak256("human-alice-2"), hex"03");

        // 无效证明拒绝
        address carol = makeAddr("carol");
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        vm.expectRevert(unicode"AgentRegistry: 人类证明无效");
        registry.registerAgentVerified("Carol", "desc", "endpoint", keccak256("human-carol"), hex"");
    }

    function test_pohVerifierOnlyOwnerCanSetAndDisable() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        registry.setPoHVerifier(makeAddr("verifier"));

        registry.setPoHVerifier(makeAddr("verifier"));
        assertEq(registry.pohVerifier(), makeAddr("verifier"));

        // 可关闭恢复纯质押模式
        registry.setPoHVerifier(address(0));
        assertEq(registry.pohVerifier(), address(0));
    }
}
