// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

contract RejectingVotingReceiver {
    receive() external payable {
        revert("reject ether");
    }
}

contract SchellingVotingTest is Test {
    AgentRegistry registry;
    ReputationHub hub;
    GuaranteeEscrow escrow;
    SchellingVoting voting;
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address guarantor = makeAddr("guarantor");
    address opener = makeAddr("permissionless opener");
    address postCreationJuror = makeAddr("post-dispute juror");
    address[5] jurors;
    uint256 buyerId;
    uint256 sellerId;
    uint256 guarantorId;
    uint256 tradeId;
    uint256 caseId;
    uint256 constant STAKE = 0.1 ether;
    bytes32 constant SALT = keccak256("salt");

    function setUp() public {
        registry = new AgentRegistry();
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        voting = new SchellingVoting(address(escrow), address(registry), address(hub), STAKE, 1 days, 1 days);
        hub.setOutcomeWriter(address(escrow), true);
        hub.setJurorMetricWriter(address(voting), true);
        escrow.transferOwnership(address(voting));
        vm.deal(buyer, 3 ether);
        vm.deal(seller, 1 ether);
        vm.deal(guarantor, 2 ether);
        vm.prank(buyer);
        buyerId = registry.registerAgent("Buyer", "", "");
        vm.prank(seller);
        sellerId = registry.registerAgent("Seller", "", "");
        vm.prank(guarantor);
        guarantorId = registry.registerAgent("Guarantor", "", "");
        for (uint256 i; i < 5; ++i) {
            jurors[i] = makeAddr(string.concat("juror", vm.toString(i)));
            vm.deal(jurors[i], 1 ether);
            vm.prank(jurors[i]);
            registry.registerAgent("Juror", "", "");
        }
        vm.prank(buyer);
        tradeId = escrow.createTrade(buyerId, sellerId, 1 ether, 0.2 ether);
        vm.deal(postCreationJuror, 1 ether);
        vm.prank(postCreationJuror);
        registry.registerAgent("Post-creation Juror", "", "");
        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.1 ether);
        vm.prank(seller);
        escrow.acceptGuarantee(tradeId);
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute{value: 0.02 ether}(tradeId);
        vm.prank(opener);
        caseId = voting.openCase(tradeId);
    }

    function _commit(address juror, SchellingVoting.Side side) internal {
        bytes32 commitment = voting.voteCommitment(caseId, juror, side, SALT);
        vm.prank(juror);
        voting.commitVote{value: STAKE}(caseId, commitment);
    }

    function _reveal(address juror, SchellingVoting.Side side) internal {
        vm.prank(juror);
        voting.revealVote(caseId, side, SALT);
    }

    function test_nonexistentCaseRejectedIncludingDefaultCaseZero() public {
        SchellingVoting fresh =
            new SchellingVoting(address(escrow), address(registry), address(hub), STAKE, 1 days, 1 days);
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 案件不存在");
        fresh.commitVote{value: STAKE}(0, bytes32(uint256(1)));
    }

    function test_duplicateCaseRejected() public {
        vm.expectRevert(unicode"SchellingVoting: 该交易已有案件");
        voting.openCase(tradeId);
    }

    function test_tradeCaseIndexMapsToCaseZeroWithoutSentinelAmbiguity() public view {
        assertEq(voting.tradeCaseIdPlusOne(tradeId), caseId + 1);
        assertEq(voting.caseIdForTrade(tradeId), caseId);
    }

    function test_caseIdForTradeRejectsMissingTradeCase() public {
        uint256 tradeWithoutCase = tradeId + 1;
        assertEq(voting.tradeCaseIdPlusOne(tradeWithoutCase), 0);
        vm.expectRevert(unicode"SchellingVoting: 交易无案件");
        voting.caseIdForTrade(tradeWithoutCase);
    }

    function test_caseDetailsTracksConfigurationCountsAndResult() public {
        (
            uint256 indexedTradeId,
            uint256 stake,
            uint256 commitDeadline,
            uint256 revealDeadline,
            uint256 eligibilityAgentCount,,,,,,,
        ) = voting.caseDetails(caseId);
        assertEq(indexedTradeId, tradeId);
        assertEq(stake, STAKE);
        assertEq(commitDeadline, block.timestamp + 1 days);
        assertEq(revealDeadline, block.timestamp + 2 days);
        assertEq(eligibilityAgentCount, escrow.eligibilityAgentCount(tradeId));

        _commit(jurors[0], SchellingVoting.Side.BUYER);
        _commit(jurors[1], SchellingVoting.Side.BUYER);
        _commit(jurors[2], SchellingVoting.Side.BUYER);
        vm.warp(block.timestamp + 1 days);
        _reveal(jurors[0], SchellingVoting.Side.BUYER);
        _reveal(jurors[1], SchellingVoting.Side.BUYER);
        _reveal(jurors[2], SchellingVoting.Side.BUYER);
        vm.warp(block.timestamp + 1 days);
        voting.settle(caseId);

        (
            ,,,,,
            uint256 committedCount,
            uint256 buyerVotes,
            uint256 sellerVotes,
            uint256 abstentions,
            bool settled,
            bool effective,
            SchellingVoting.Side winner
        ) = voting.caseDetails(caseId);
        assertEq(committedCount, 3);
        assertEq(buyerVotes, 3);
        assertEq(sellerVotes, 0);
        assertEq(abstentions, 0);
        assertTrue(settled);
        assertTrue(effective);
        assertEq(uint8(winner), uint8(SchellingVoting.Side.BUYER));
    }

    function test_jurorStatusTracksCommitRevealAndClaimLifecycle() public {
        (bool committed, bool revealed, SchellingVoting.Side side, bool claimed) = voting.jurorStatus(caseId, jurors[0]);
        assertFalse(committed);
        assertFalse(revealed);
        assertEq(uint8(side), uint8(SchellingVoting.Side.BUYER));
        assertFalse(claimed);

        _commit(jurors[0], SchellingVoting.Side.SELLER);
        (committed, revealed, side, claimed) = voting.jurorStatus(caseId, jurors[0]);
        assertTrue(committed);
        assertFalse(revealed);
        assertEq(uint8(side), uint8(SchellingVoting.Side.BUYER));
        assertFalse(claimed);

        vm.warp(block.timestamp + 1 days);
        _reveal(jurors[0], SchellingVoting.Side.SELLER);
        (committed, revealed, side, claimed) = voting.jurorStatus(caseId, jurors[0]);
        assertTrue(committed);
        assertTrue(revealed);
        assertEq(uint8(side), uint8(SchellingVoting.Side.SELLER));
        assertFalse(claimed);

        vm.warp(block.timestamp + 1 days);
        voting.settle(caseId);
        vm.prank(jurors[0]);
        voting.claim(caseId);
        (committed, revealed, side, claimed) = voting.jurorStatus(caseId, jurors[0]);
        assertTrue(committed);
        assertTrue(revealed);
        assertEq(uint8(side), uint8(SchellingVoting.Side.SELLER));
        assertTrue(claimed);
    }

    function test_commitRevealDeadlinesAndWrongSalt() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        _commit(jurors[1], SchellingVoting.Side.BUYER);

        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 不在揭示窗口");
        voting.revealVote(caseId, SchellingVoting.Side.BUYER, SALT);

        vm.warp(block.timestamp + 1 days);
        vm.prank(jurors[2]);
        vm.expectRevert(unicode"SchellingVoting: 提交窗口已结束");
        voting.commitVote{value: STAKE}(caseId, bytes32(uint256(1)));
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 承诺不匹配");
        voting.revealVote(caseId, SchellingVoting.Side.BUYER, bytes32(uint256(SALT) + 1));
        _reveal(jurors[0], SchellingVoting.Side.BUYER);

        vm.warp(block.timestamp + 1 days);
        vm.prank(jurors[1]);
        vm.expectRevert(unicode"SchellingVoting: 不在揭示窗口");
        voting.revealVote(caseId, SchellingVoting.Side.BUYER, SALT);
        voting.settle(caseId);
        (bool effective, SchellingVoting.Side winner) = voting.caseResult(caseId);
        assertFalse(effective);
        assertEq(uint8(winner), uint8(SchellingVoting.Side.ABSTAIN));
    }

    function test_commitRevealExactTwoThirdsIsEffective() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        _commit(jurors[1], SchellingVoting.Side.BUYER);
        _commit(jurors[2], SchellingVoting.Side.SELLER);
        vm.warp(block.timestamp + 1 days);
        _reveal(jurors[0], SchellingVoting.Side.BUYER);
        _reveal(jurors[1], SchellingVoting.Side.BUYER);
        _reveal(jurors[2], SchellingVoting.Side.SELLER);
        vm.warp(block.timestamp + 1 days);
        voting.settle(caseId);

        (bool effective, SchellingVoting.Side winner) = voting.caseResult(caseId);
        assertTrue(effective);
        assertEq(uint8(winner), uint8(SchellingVoting.Side.BUYER));
        assertEq(escrow.pendingWithdrawals(buyer), 2.02 ether);

        vm.expectRevert(unicode"SchellingVoting: 已结算");
        voting.settle(caseId);
        vm.prank(jurors[0]);
        voting.claim(caseId);
        assertEq(voting.pendingWithdrawals(jurors[0]), STAKE + STAKE / 2);
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 已领取");
        voting.claim(caseId);

        RejectingVotingReceiver rejecting = new RejectingVotingReceiver();
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 提取失败");
        voting.withdraw(payable(address(rejecting)));
        assertEq(voting.pendingWithdrawals(jurors[0]), STAKE + STAKE / 2);

        uint256 balanceBefore = jurors[0].balance;
        vm.prank(jurors[0]);
        voting.withdraw(payable(jurors[0]));
        assertEq(jurors[0].balance - balanceBefore, STAKE + STAKE / 2);
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 无可提取余额");
        voting.withdraw(payable(jurors[0]));
    }

    function test_threeOfFiveIsNotRoundedUpToTwoThirdsAndVoidsSafely() public {
        for (uint256 i; i < 5; ++i) {
            _commit(jurors[i], i < 3 ? SchellingVoting.Side.BUYER : SchellingVoting.Side.SELLER);
        }
        vm.warp(block.timestamp + 1 days);
        for (uint256 i; i < 5; ++i) {
            _reveal(jurors[i], i < 3 ? SchellingVoting.Side.BUYER : SchellingVoting.Side.SELLER);
        }
        vm.warp(block.timestamp + 1 days);
        voting.settle(caseId);

        (bool effective, SchellingVoting.Side winner) = voting.caseResult(caseId);
        assertFalse(effective);
        assertEq(uint8(winner), uint8(SchellingVoting.Side.ABSTAIN));
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.VOIDED));
        assertEq(escrow.pendingWithdrawals(buyer), 1.02 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1 ether);
    }

    function test_tradeCreationSnapshotExcludesLaterIdentity() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);

        bytes32 lateCommitment = voting.voteCommitment(caseId, postCreationJuror, SchellingVoting.Side.BUYER, SALT);
        vm.prank(postCreationJuror);
        vm.expectRevert(unicode"SchellingVoting: 不在资格快照中");
        voting.commitVote{value: STAKE}(caseId, lateCommitment);
    }

    function test_onlySubjectsRegisteredAtSnapshotCanCommitAndOneSubjectOneVote() public {
        address late = makeAddr("late");
        vm.deal(late, 1 ether);
        // Even a registration later in the same block is outside the agent-count snapshot.
        vm.prank(late);
        registry.registerAgent("Late", "", "");
        vm.prank(late);
        vm.expectRevert(unicode"SchellingVoting: 不在资格快照中");
        voting.commitVote{value: STAKE}(caseId, bytes32(uint256(1)));

        vm.prank(jurors[0]);
        registry.registerAgent("SecondIdentity", "", "");
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 主体已提交");
        voting.commitVote{value: STAKE}(caseId, bytes32(uint256(2)));
    }

    function test_unrevealedVotesAreExcludedFromThresholdAndSlashed() public {
        for (uint256 i; i < 5; ++i) {
            _commit(jurors[i], SchellingVoting.Side.BUYER);
        }
        vm.warp(block.timestamp + 1 days);
        for (uint256 i; i < 3; ++i) {
            _reveal(jurors[i], SchellingVoting.Side.BUYER);
        }
        vm.warp(block.timestamp + 1 days);
        voting.settle(caseId);

        (bool effective, SchellingVoting.Side winner) = voting.caseResult(caseId);
        assertTrue(effective);
        assertEq(uint8(winner), uint8(SchellingVoting.Side.BUYER));
        vm.prank(jurors[0]);
        voting.claim(caseId);
        assertEq(voting.pendingWithdrawals(jurors[0]), STAKE + (STAKE * 2) / 3);
        vm.prank(jurors[3]);
        vm.expectRevert(unicode"SchellingVoting: 质押已罚没");
        voting.claim(caseId);
    }

    function test_unrevealedOrInsufficientCaseIsVoidedAndRefundable() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        _commit(jurors[1], SchellingVoting.Side.BUYER);
        vm.warp(block.timestamp + 2 days);
        voting.settle(caseId);
        vm.prank(jurors[0]);
        voting.claim(caseId);
        assertEq(voting.pendingWithdrawals(jurors[0]), STAKE);
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.VOIDED));
        assertEq(hub.reputationScore(sellerId), 50);
    }

    function test_constructorAndPermissionlessOpeningUseDeploymentFixedConfiguration() public view {
        assertEq(address(voting.escrow()), address(escrow));
        assertEq(address(voting.registry()), address(registry));
        assertEq(address(voting.hub()), address(hub));
        assertEq(voting.caseStake(), STAKE);
        assertEq(voting.commitWindow(), 1 days);
        assertEq(voting.revealWindow(), 1 days);
        assertTrue(opener != voting.owner());
        assertTrue(voting.tradeHasCase(tradeId));
    }

    function test_constructorRejectsInvalidFixedConfiguration() public {
        vm.expectRevert(unicode"SchellingVoting: 依赖地址为零");
        new SchellingVoting(address(0), address(registry), address(hub), STAKE, 1 days, 1 days);
        vm.expectRevert(unicode"SchellingVoting: 质押必须大于零");
        new SchellingVoting(address(escrow), address(registry), address(hub), 0, 1 days, 1 days);
        vm.expectRevert(unicode"SchellingVoting: 窗口必须大于零");
        new SchellingVoting(address(escrow), address(registry), address(hub), STAKE, 0, 1 days);
        vm.expectRevert(unicode"SchellingVoting: 窗口过长");
        new SchellingVoting(address(escrow), address(registry), address(hub), STAKE, 7 days + 1, 1 days);
    }

    function test_commitRequiresCurrentHubEligibility() public {
        vm.mockCall(address(hub), abi.encodeCall(hub.isJurorEligible, (jurors[0])), abi.encode(false));
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 陪审员信誉不合格");
        voting.commitVote{value: STAKE}(caseId, bytes32(uint256(1)));
    }

    function test_finalizeJurorMetricsIsPermissionlessAndDomainSeparated() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        _commit(jurors[1], SchellingVoting.Side.BUYER);
        _commit(jurors[2], SchellingVoting.Side.SELLER);
        vm.warp(block.timestamp + 1 days);
        _reveal(jurors[0], SchellingVoting.Side.BUYER);
        _reveal(jurors[1], SchellingVoting.Side.BUYER);
        _reveal(jurors[2], SchellingVoting.Side.SELLER);
        vm.warp(block.timestamp + 1 days);
        voting.settle(caseId);

        bytes32 jurorCaseId =
            keccak256(abi.encode("AGENTTRUST_JUROR_CASE_V1", address(voting), block.chainid, caseId, jurors[0]));
        vm.prank(makeAddr("metrics finalizer"));
        voting.finalizeJurorMetrics(caseId, jurors[0]);
        assertTrue(hub.recordedJurorCases(jurorCaseId));
        (uint256 casesFinalized, uint256 votesRevealed, uint256 abstentions, uint256 aligned, uint256 opposed) =
            hub.jurorReputation(jurors[0]);
        assertEq(casesFinalized, 1);
        assertEq(votesRevealed, 1);
        assertEq(abstentions, 0);
        assertEq(aligned, 1);
        assertEq(opposed, 0);

        voting.finalizeJurorMetrics(caseId, jurors[2]);
        (,,,, opposed) = hub.jurorReputation(jurors[2]);
        assertEq(opposed, 1);

        vm.expectRevert();
        voting.finalizeJurorMetrics(caseId, jurors[0]);
    }

    function test_jurorMetricAclCannotBlockSettlement() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        _commit(jurors[1], SchellingVoting.Side.BUYER);
        _commit(jurors[2], SchellingVoting.Side.BUYER);
        hub.setJurorMetricWriter(address(voting), false);
        vm.warp(block.timestamp + 1 days);
        _reveal(jurors[0], SchellingVoting.Side.BUYER);
        _reveal(jurors[1], SchellingVoting.Side.BUYER);
        _reveal(jurors[2], SchellingVoting.Side.BUYER);
        vm.warp(block.timestamp + 1 days);
        voting.settle(caseId);

        (bool effective,) = voting.caseResult(caseId);
        assertTrue(effective);
        vm.expectRevert();
        voting.finalizeJurorMetrics(caseId, jurors[0]);
    }

    function test_finalizeJurorMetricsRequiresSettledCaseAndCommittedSubject() public {
        _commit(jurors[0], SchellingVoting.Side.ABSTAIN);
        vm.expectRevert(unicode"SchellingVoting: 未结算");
        voting.finalizeJurorMetrics(caseId, jurors[0]);
        vm.warp(block.timestamp + 2 days);
        voting.settle(caseId);
        vm.expectRevert(unicode"SchellingVoting: 主体未提交");
        voting.finalizeJurorMetrics(caseId, jurors[1]);
    }

    function testFuzz_nonexistentCaseRejectsEveryOperation(uint128 rawId, uint8 rawOperation) public {
        uint256 missingId = bound(uint256(rawId), voting.nextCaseId(), type(uint128).max);
        uint256 operation = bound(uint256(rawOperation), 0, 7);
        bytes memory callData;
        if (operation == 0) {
            callData = abi.encodeCall(voting.commitVote, (missingId, bytes32(uint256(1))));
        } else if (operation == 1) {
            callData = abi.encodeCall(voting.revealVote, (missingId, SchellingVoting.Side.BUYER, SALT));
        } else if (operation == 2) {
            callData = abi.encodeCall(voting.settle, (missingId));
        } else if (operation == 3) {
            callData = abi.encodeCall(voting.claim, (missingId));
        } else if (operation == 4) {
            callData = abi.encodeCall(voting.caseResult, (missingId));
        } else if (operation == 5) {
            callData = abi.encodeCall(voting.finalizeJurorMetrics, (missingId, jurors[0]));
        } else if (operation == 6) {
            callData = abi.encodeCall(voting.caseDetails, (missingId));
        } else {
            callData = abi.encodeCall(voting.jurorStatus, (missingId, jurors[0]));
        }

        (bool ok,) = address(voting).call(callData);
        assertFalse(ok);
    }
}
