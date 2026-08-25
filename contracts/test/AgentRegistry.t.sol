// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry, ISubjectObligationOracle} from "../src/AgentRegistry.sol";
import {MockPoHVerifier} from "./mocks/MockPoHVerifier.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract RejectEther is IERC721Receiver {
    receive() external payable {
        revert("no ether");
    }

    function register(AgentRegistry registry, address[] calldata guardians) external payable returns (uint256) {
        return registry.registerAgent{value: msg.value}("ContractAgent", "desc", "endpoint", guardians);
    }

    function withdraw(AgentRegistry registry, address payable recipient) external {
        registry.withdraw(recipient);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract MockObligationOracle is ISubjectObligationOracle {
    mapping(address => bool) public blocked;

    function setBlocked(address subject, bool value) external {
        blocked[subject] = value;
    }

    function subjectHasOpenObligations(address subject) external view returns (bool) {
        return blocked[subject];
    }
}

contract AgentRegistryTest is Test {
    AgentRegistry registry;
    address alice = makeAddr("alice");
    address guardian1 = makeAddr("guardian1");
    address guardian2 = makeAddr("guardian2");
    address bob = makeAddr("bob");

    function setUp() public {
        registry = new AgentRegistry();
        vm.deal(alice, 10 ether);
    }

    function _guardians() internal returns (address[] memory list) {
        list = new address[](2);
        list[0] = guardian1;
        list[1] = guardian2;
    }

    function _guardiansOf(address first, address second) internal pure returns (address[] memory list) {
        list = new address[](2);
        list[0] = first;
        list[1] = second;
    }

    function _registerAs(address who, uint256 value) internal returns (uint256 id) {
        vm.deal(who, value);
        vm.prank(who);
        id = registry.registerAgent{value: value}("Agent", "desc", "endpoint", _guardians());
    }

    function _registerVerifiedAs(address who, uint256 value, bytes32 nullifier) internal returns (uint256 id) {
        vm.deal(who, value);
        vm.prank(who);
        id = registry.registerAgentVerified{value: value}("Agent", "desc", "endpoint", nullifier, hex"01", _guardians());
    }

    function test_registrationBindsImmutableResponsibleSubjectAndSnapshot() public {
        uint256 id = _registerAs(alice, 0);
        uint256 registeredBlock = block.number;

        assertEq(registry.ownerOf(id), alice);
        assertEq(registry.responsibleParty(id), alice);
        assertTrue(registry.activeSubjects(alice));
        assertTrue(registry.isRegisteredSubjectAt(alice, registeredBlock));
        assertFalse(registry.isRegisteredSubjectAt(alice, registeredBlock - 1));

        vm.prank(alice);
        registry.transferFrom(alice, makeAddr("buyer"), id);
        assertEq(registry.responsibleParty(id), alice, "NFT transfer must not rewrite legal subject");
    }

    function test_registrationLocksExactDepositAndCreditsOverpayment() public {
        registry.setRegistrationDeposit(1 ether);
        RejectEther rejector = new RejectEther();
        vm.deal(address(rejector), 2 ether);

        rejector.register{value: 2 ether}(registry, _guardians());
        assertEq(registry.deposits(address(rejector)), 1 ether);
        assertEq(registry.pendingWithdrawals(address(rejector)), 1 ether);

        address recipient = makeAddr("recipient");
        rejector.withdraw(registry, payable(recipient));
        assertEq(recipient.balance, 1 ether);
    }

    function test_sameSubjectCannotClaimTwoCommunityIds() public {
        _registerAs(alice, 0);

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 主体已注册");
        registry.registerAgent("SecondIdentity", "desc", "endpoint", _guardians());
    }

    function test_guardianValidation() public {
        address[] memory one = new address[](1);
        one[0] = guardian1;
        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 守护人数量必须为 2-3");
        registry.registerAgent("A", "", "", one);

        address[] memory four = new address[](4);
        four[0] = guardian1;
        four[1] = guardian2;
        four[2] = bob;
        four[3] = makeAddr("g4");
        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 守护人数量必须为 2-3");
        registry.registerAgent("A", "", "", four);

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 守护人为零");
        registry.registerAgent("A", "", "", _guardiansOf(guardian1, address(0)));

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 不能自任守护人");
        registry.registerAgent("A", "", "", _guardiansOf(alice, guardian2));

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 守护人重复");
        registry.registerAgent("A", "", "", _guardiansOf(guardian1, guardian1));
    }

    function test_deregisterRefundsDepositAndRetiresIdentity() public {
        registry.setRegistrationDeposit(1 ether);
        uint256 id = _registerAs(alice, 1 ether);
        assertEq(registry.agentCount(), 1);

        vm.prank(alice);
        registry.deregister();

        assertEq(registry.pendingWithdrawals(alice), 1 ether, "deposit refunded via pull payment");
        assertEq(registry.deposits(alice), 0);
        assertTrue(registry.deregistered(alice));
        assertFalse(registry.activeSubjects(alice));
        assertTrue(registry.registeredSubjects(alice), "permanent tombstone stays");
        assertEq(registry.agentCount(), 1, "agentCount must not shrink");
        assertFalse(registry.isRegisteredSubjectAt(alice, block.number), "no longer voting-eligible");

        assertEq(registry.balanceOf(alice), 0, "NFT burned");
        assertEq(registry.responsibleParty(id), alice, "profile stays readable by ID");

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 主体已注册");
        registry.registerAgent{value: 1 ether}("Second", "", "", _guardians());

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 主体未激活");
        registry.deregister();
    }

    function test_deregisterBlockedByObligations() public {
        _registerAs(alice, 0);
        MockObligationOracle escrow = new MockObligationOracle();
        registry.setObligationOracles(address(escrow), address(0));
        escrow.setBlocked(alice, true);

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 存在未结义务");
        registry.deregister();

        escrow.setBlocked(alice, false);
        vm.prank(alice);
        registry.deregister();
        assertTrue(registry.deregistered(alice));
    }

    function test_deregisterRequiresTokenHolder() public {
        uint256 id = _registerAs(alice, 0);
        vm.prank(alice);
        registry.transferFrom(alice, bob, id);

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: NFT 已转让");
        registry.deregister();
    }

    function test_verifiedRegistrationBindsOneHumanToOneIdAcrossWallets() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 需提供人类证明");
        registry.registerAgent("Agent", "desc", "endpoint", _guardians());

        bytes32 nullifier = keccak256("human-alice");
        uint256 id = _registerVerifiedAs(alice, 0, nullifier);
        assertEq(registry.ownerOf(id), alice);
        assertTrue(registry.usedPoHNullifiers(nullifier));
        assertEq(registry.nullifierSubject(nullifier), alice);
        assertEq(registry.subjectNullifier(alice), nullifier);

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(unicode"AgentRegistry: nullifier 已使用");
        registry.registerAgentVerified("Bob", "desc", "endpoint", nullifier, hex"02", _guardians());

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 主体已注册");
        registry.registerAgentVerified("Second", "desc", "endpoint", keccak256("human-alice-2"), hex"03", _guardians());

        address carol = makeAddr("carol");
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        vm.expectRevert(unicode"AgentRegistry: 人类证明无效");
        registry.registerAgentVerified("Carol", "desc", "endpoint", keccak256("human-carol"), hex"", _guardians());
    }

    function test_pohVerifierOnlyOwnerCanSetAndDisable() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        registry.setPoHVerifier(makeAddr("verifier"));

        registry.setPoHVerifier(makeAddr("verifier"));
        assertEq(registry.pohVerifier(), makeAddr("verifier"));

        registry.setPoHVerifier(address(0));
        assertEq(registry.pohVerifier(), address(0));
    }

    function test_recoveryRequiresPoHAnchorAndNewWalletRules() public {
        // 纯质押身份没有 nullifier 锚点，无法找回
        _registerAs(alice, 0);
        vm.prank(bob);
        vm.expectRevert(unicode"AgentRegistry: 未知 nullifier");
        registry.requestRecovery(keccak256("n"), hex"01", bob);

        // 找回请求必须由新钱包自己发起
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        address carol = makeAddr("carol");
        bytes32 nullifier = keccak256("human-carol");
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        registry.registerAgentVerified("C", "", "", nullifier, hex"01", _guardians());

        vm.prank(carol);
        vm.expectRevert(unicode"AgentRegistry: 新钱包必须发起");
        registry.requestRecovery(nullifier, hex"01", bob);

        // 新钱包不能已注册
        address dave = makeAddr("dave");
        vm.deal(dave, 1 ether);
        vm.prank(dave);
        registry.registerAgentVerified("D", "", "", keccak256("human-dave"), hex"01", _guardians());
        vm.prank(dave);
        vm.expectRevert(unicode"AgentRegistry: 新钱包已注册");
        registry.requestRecovery(nullifier, hex"01", dave);

        // 新钱包不能是守护人
        address erin = makeAddr("erin");
        bytes32 n2 = keccak256("human-erin");
        vm.deal(erin, 1 ether);
        vm.prank(erin);
        registry.registerAgentVerified("E", "", "", n2, hex"01", _guardiansOf(bob, guardian1));
        vm.prank(bob);
        vm.expectRevert(unicode"AgentRegistry: 新钱包不能是守护人");
        registry.requestRecovery(n2, hex"01", bob);
    }

    function test_recoveryFullFlowMovesIdentityToNewWallet() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        registry.setRegistrationDeposit(1 ether);
        bytes32 nullifier = keccak256("human-alice");
        uint256 id = _registerVerifiedAs(alice, 1 ether, nullifier);
        uint256 snapshotCount = registry.agentCount();
        uint256 registeredBlock = block.number;

        vm.prank(bob);
        registry.requestRecovery(nullifier, hex"01", bob);

        (address newWallet, bytes32 reqNullifier, uint256 executeAfter,,,,) = registry.recoveryRequests(alice);
        assertEq(newWallet, bob);
        assertEq(reqNullifier, nullifier);
        assertEq(executeAfter, block.timestamp + 24 hours);

        vm.prank(guardian1);
        registry.approveRecovery(alice);

        vm.warp(block.timestamp + 24 hours);
        registry.executeRecovery(alice);

        assertEq(registry.ownerOf(id), bob, "NFT control moves");
        assertEq(registry.responsibleParty(id), bob, "responsibility moves");
        assertEq(registry.deposits(bob), 1 ether, "deposit moves");
        assertEq(registry.deposits(alice), 0);
        assertFalse(registry.activeSubjects(alice), "old wallet deactivated");
        assertTrue(registry.registeredSubjects(alice), "old wallet permanently barred");
        assertTrue(registry.activeSubjects(bob));
        assertEq(registry.firstAgentIdPlusOne(bob), id + 1);
        assertEq(registry.registeredAtBlock(bob), registeredBlock);
        assertTrue(registry.isRegisteredSubjectAt(bob, snapshotCount), "new wallet inherits snapshot eligibility");
        assertTrue(registry.isGuardian(bob, guardian1), "guardians move");
        assertTrue(registry.isGuardian(bob, guardian2));
        assertFalse(registry.isGuardian(alice, guardian1), "old guardian mapping cleared");
        assertEq(registry.nullifierSubject(nullifier), bob);
        assertEq(registry.subjectNullifier(bob), nullifier);
        assertEq(registry.subjectNullifier(alice), bytes32(0));
        assertFalse(registry.isRegisteredSubjectAt(alice, snapshotCount), "old wallet loses voting eligibility");
    }

    function test_recoveryVetoWithinWindowBlocksExecution() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        bytes32 nullifier = keccak256("human-alice");
        _registerVerifiedAs(alice, 0, nullifier);

        vm.prank(bob);
        registry.requestRecovery(nullifier, hex"01", bob);
        vm.prank(guardian1);
        registry.approveRecovery(alice);

        vm.expectRevert(unicode"AgentRegistry: 否决窗口未结束");
        registry.executeRecovery(alice);

        vm.prank(alice);
        registry.vetoRecovery(alice);

        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(unicode"AgentRegistry: 无找回请求");
        registry.executeRecovery(alice);
    }

    function test_recoveryApprovalNonceDoesNotLeakAcrossRequests() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        bytes32 nullifier = keccak256("human-alice");
        _registerVerifiedAs(alice, 0, nullifier);

        vm.prank(bob);
        registry.requestRecovery(nullifier, hex"01", bob);
        vm.prank(guardian1);
        registry.approveRecovery(alice);
        vm.prank(alice);
        registry.vetoRecovery(alice);

        // 新请求：nonce 递增，同一守护人可以再次批准
        vm.prank(bob);
        registry.requestRecovery(nullifier, hex"01", bob);
        vm.prank(guardian1);
        registry.approveRecovery(alice);
        vm.warp(block.timestamp + 24 hours);
        registry.executeRecovery(alice);
        assertTrue(registry.activeSubjects(bob));
    }

    function test_recoveryExpiryAndDuplicateGuardianApproval() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        bytes32 nullifier = keccak256("human-alice");
        _registerVerifiedAs(alice, 0, nullifier);

        vm.prank(bob);
        registry.requestRecovery(nullifier, hex"01", bob);
        vm.prank(guardian1);
        registry.approveRecovery(alice);
        vm.prank(guardian1);
        vm.expectRevert(unicode"AgentRegistry: 守护人已批准");
        registry.approveRecovery(alice);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(unicode"AgentRegistry: 非守护人");
        registry.approveRecovery(alice);

        // 未批准不能执行；过期后批准与执行都被拒绝
        vm.warp(block.timestamp + 24 hours + 7 days + 1);
        vm.prank(guardian2);
        vm.expectRevert(unicode"AgentRegistry: 找回请求已过期");
        registry.approveRecovery(alice);
        vm.expectRevert(unicode"AgentRegistry: 找回请求已过期");
        registry.executeRecovery(alice);
    }

    function test_recoveryRequiresGuardianApproval() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        bytes32 nullifier = keccak256("human-alice");
        _registerVerifiedAs(alice, 0, nullifier);

        vm.prank(bob);
        registry.requestRecovery(nullifier, hex"01", bob);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(unicode"AgentRegistry: 缺少守护人批准");
        registry.executeRecovery(alice);
    }

    function test_recoveryBlockedByObligationsCanRetryAfterClear() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        MockObligationOracle voting = new MockObligationOracle();
        registry.setObligationOracles(address(0), address(voting));
        bytes32 nullifier = keccak256("human-alice");
        _registerVerifiedAs(alice, 0, nullifier);

        vm.prank(bob);
        registry.requestRecovery(nullifier, hex"01", bob);
        vm.prank(guardian1);
        registry.approveRecovery(alice);
        vm.warp(block.timestamp + 24 hours);

        voting.setBlocked(alice, true);
        vm.expectRevert(unicode"AgentRegistry: 存在未结义务");
        registry.executeRecovery(alice);

        voting.setBlocked(alice, false);
        registry.executeRecovery(alice);
        assertTrue(registry.activeSubjects(bob));
    }

    function test_recoveryBlockedWhileDeregistered() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        bytes32 nullifier = keccak256("human-alice");
        _registerVerifiedAs(alice, 0, nullifier);

        vm.prank(alice);
        registry.deregister();
        vm.prank(bob);
        vm.expectRevert(unicode"AgentRegistry: 身份未激活");
        registry.requestRecovery(nullifier, hex"01", bob);
    }

    function test_deregisterBlockedByLiveRecovery() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        bytes32 nullifier = keccak256("human-alice");
        _registerVerifiedAs(alice, 0, nullifier);

        vm.prank(bob);
        registry.requestRecovery(nullifier, hex"01", bob);
        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 找回处理中");
        registry.deregister();
    }

    function test_secondRecoveryWorksAfterFirst() public {
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        bytes32 nullifier = keccak256("human-alice");
        uint256 id = _registerVerifiedAs(alice, 0, nullifier);

        vm.prank(bob);
        registry.requestRecovery(nullifier, hex"01", bob);
        vm.prank(guardian1);
        registry.approveRecovery(alice);
        vm.warp(block.timestamp + 24 hours);
        registry.executeRecovery(alice);

        address carol = makeAddr("carol");
        vm.prank(carol);
        registry.requestRecovery(nullifier, hex"01", carol);
        vm.prank(guardian1);
        registry.approveRecovery(bob);
        vm.warp(block.timestamp + 24 hours);
        registry.executeRecovery(bob);

        assertEq(registry.ownerOf(id), carol);
        assertEq(registry.responsibleParty(id), carol);
        assertTrue(registry.activeSubjects(carol));
    }

    function test_slashDepositAclAndAccounting() public {
        registry.setRegistrationDeposit(1 ether);
        _registerAs(alice, 1 ether);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        registry.setSlashSource(makeAddr("attacker"), true);

        vm.prank(makeAddr("evil"));
        vm.expectRevert(unicode"AgentRegistry: 未授权罚没来源");
        registry.slashDeposit(alice, makeAddr("victim"), 0.5 ether);

        registry.setSlashSource(makeAddr("attacker"), true);
        address victim = makeAddr("victim");
        vm.prank(makeAddr("attacker"));
        registry.slashDeposit(alice, victim, 0.5 ether);
        assertEq(registry.deposits(alice), 0.5 ether);
        assertEq(registry.pendingWithdrawals(victim), 0.5 ether);

        vm.prank(makeAddr("attacker"));
        vm.expectRevert(unicode"AgentRegistry: 罚没金额无效");
        registry.slashDeposit(alice, victim, 0.6 ether);

        vm.prank(makeAddr("attacker"));
        vm.expectRevert(unicode"AgentRegistry: 罚没收款人为零");
        registry.slashDeposit(alice, address(0), 0.1 ether);
    }

    function test_withdrawPullPaymentAfterDeregister() public {
        registry.setRegistrationDeposit(1 ether);
        _registerAs(alice, 1 ether);
        uint256 before = registry.totalLiability();

        vm.prank(alice);
        registry.deregister();
        address recipient = makeAddr("recipient");
        vm.prank(alice);
        registry.withdraw(payable(recipient));
        assertEq(recipient.balance, 1 ether);
        assertEq(registry.totalLiability(), before - 1 ether);
    }
}
