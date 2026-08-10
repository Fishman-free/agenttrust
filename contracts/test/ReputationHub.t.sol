// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReputationHub} from "../src/ReputationHub.sol";

contract ReputationHubTest is Test {
    ReputationHub hub;
    address outcomeWriter = makeAddr("outcomeWriter");
    address jurorMetricWriter = makeAddr("jurorMetricWriter");
    address juror = makeAddr("juror");

    function setUp() public {
        hub = new ReputationHub();
        hub.setOutcomeWriter(outcomeWriter, true);
        hub.setJurorMetricWriter(jurorMetricWriter, true);
    }

    function test_ownerCanConfigureAndRevokeSplitWriters() public {
        assertTrue(hub.outcomeWriters(outcomeWriter));
        assertTrue(hub.jurorMetricWriters(jurorMetricWriter));

        hub.setOutcomeWriter(outcomeWriter, false);
        hub.setJurorMetricWriter(jurorMetricWriter, false);

        assertFalse(hub.outcomeWriters(outcomeWriter));
        assertFalse(hub.jurorMetricWriters(jurorMetricWriter));
    }

    function test_nonOwnerCannotConfigureWriters() public {
        address stranger = makeAddr("stranger");
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger));
        hub.setOutcomeWriter(stranger, true);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger));
        hub.setJurorMetricWriter(stranger, true);
        vm.stopPrank();
    }

    function test_writerSettersRejectZeroAddress() public {
        vm.expectRevert(unicode"ReputationHub: 调用方为零地址");
        hub.setOutcomeWriter(address(0), true);
        vm.expectRevert(unicode"ReputationHub: 调用方为零地址");
        hub.setJurorMetricWriter(address(0), true);
    }

    function test_splitAclEnforcesLeastPrivilege() public {
        vm.prank(outcomeWriter);
        hub.recordOutcome(keccak256("outcome"), 7, ReputationHub.Outcome.COMPLETED);

        vm.prank(outcomeWriter);
        vm.expectRevert(unicode"ReputationHub: 未授权陪审指标写入方");
        hub.recordJurorCase(keccak256("juror-by-outcome-writer"), juror, true, false, true, true);

        vm.prank(jurorMetricWriter);
        hub.recordJurorCase(keccak256("juror"), juror, true, false, true, true);

        vm.prank(jurorMetricWriter);
        vm.expectRevert(unicode"ReputationHub: 未授权结果写入方");
        hub.recordOutcome(keccak256("outcome-by-juror-writer"), 7, ReputationHub.Outcome.WON);
    }

    function test_unauthorizedCallersRejectedByBothWritePaths() public {
        vm.expectRevert(unicode"ReputationHub: 未授权结果写入方");
        hub.recordOutcome(keccak256("x"), 1, ReputationHub.Outcome.WON);

        vm.expectRevert(unicode"ReputationHub: 未授权陪审指标写入方");
        hub.recordJurorCase(keccak256("y"), juror, true, false, true, true);
    }

    function test_uniqueOutcomeCannotBeRecordedTwice() public {
        bytes32 outcomeId = keccak256("trade-1");
        vm.prank(outcomeWriter);
        hub.recordOutcome(outcomeId, 7, ReputationHub.Outcome.COMPLETED);

        vm.prank(outcomeWriter);
        vm.expectRevert(unicode"ReputationHub: 结果已记录");
        hub.recordOutcome(outcomeId, 7, ReputationHub.Outcome.DEFAULTED);

        (uint256 completed, uint256 defaulted,,) = hub.reputation(7);
        assertEq(completed, 1);
        assertEq(defaulted, 0);
    }

    function test_outcomeAndJurorCaseUseSeparateReplayDomains() public {
        bytes32 sharedId = keccak256("shared-id");
        vm.prank(outcomeWriter);
        hub.recordOutcome(sharedId, 7, ReputationHub.Outcome.COMPLETED);
        vm.prank(jurorMetricWriter);
        hub.recordJurorCase(sharedId, juror, true, false, true, true);

        assertTrue(hub.recordedOutcomes(sharedId));
        assertTrue(hub.recordedJurorCases(sharedId));
    }

    function test_jurorCaseCannotBeRecordedTwice() public {
        bytes32 recordId = keccak256("case-1:juror");
        vm.prank(jurorMetricWriter);
        hub.recordJurorCase(recordId, juror, true, false, true, false);

        vm.prank(jurorMetricWriter);
        vm.expectRevert(unicode"ReputationHub: 陪审记录已存在");
        hub.recordJurorCase(recordId, juror, true, false, true, true);

        (uint256 finalized, uint256 revealed, uint256 abstentions, uint256 aligned, uint256 opposed) =
            hub.jurorReputation(juror);
        assertEq(finalized, 1);
        assertEq(revealed, 1);
        assertEq(abstentions, 0);
        assertEq(aligned, 0);
        assertEq(opposed, 1);
    }

    function test_recordJurorCaseValidatesSubjectAndAbstention() public {
        vm.startPrank(jurorMetricWriter);
        vm.expectRevert(unicode"ReputationHub: 陪审员为零地址");
        hub.recordJurorCase(keccak256("zero-subject"), address(0), true, false, true, true);
        vm.expectRevert(unicode"ReputationHub: 弃权必须已揭示");
        hub.recordJurorCase(keccak256("hidden-abstention"), juror, false, true, false, false);
        vm.stopPrank();
    }

    function test_jurorCaseClassificationsAreAccountedSeparately() public {
        vm.startPrank(jurorMetricWriter);
        hub.recordJurorCase(keccak256("not-revealed"), juror, false, false, true, true);
        hub.recordJurorCase(keccak256("abstained"), juror, true, true, true, true);
        hub.recordJurorCase(keccak256("ineffective-directional"), juror, true, false, false, true);
        hub.recordJurorCase(keccak256("aligned"), juror, true, false, true, true);
        hub.recordJurorCase(keccak256("opposed"), juror, true, false, true, false);
        vm.stopPrank();

        (uint256 finalized, uint256 revealed, uint256 abstentions, uint256 aligned, uint256 opposed) =
            hub.jurorReputation(juror);
        assertEq(finalized, 5);
        assertEq(revealed, 4);
        assertEq(abstentions, 1);
        assertEq(aligned, 1);
        assertEq(opposed, 1);
    }

    function test_jurorMetricsDoNotChangeBusinessReputationScore() public {
        assertEq(hub.reputationScore(7), 50);
        vm.prank(jurorMetricWriter);
        hub.recordJurorCase(keccak256("isolated-juror-case"), juror, true, false, true, false);

        assertEq(hub.reputationScore(7), 50);
        (uint256 completed, uint256 defaulted, uint256 won, uint256 lost) = hub.reputation(7);
        assertEq(completed + defaulted + won + lost, 0);

        vm.prank(outcomeWriter);
        hub.recordOutcome(keccak256("isolated-outcome"), 7, ReputationHub.Outcome.DEFAULTED);
        (uint256 finalized, uint256 revealed, uint256 abstentions, uint256 aligned, uint256 opposed) =
            hub.jurorReputation(juror);
        assertEq(finalized, 1);
        assertEq(revealed, 1);
        assertEq(abstentions, 0);
        assertEq(aligned, 0);
        assertEq(opposed, 1);
    }

    function test_jurorEligibilityAllowsColdStartBeforeThreeFinalizedCases() public {
        assertTrue(hub.isJurorEligible(juror));
        vm.startPrank(jurorMetricWriter);
        hub.recordJurorCase(keccak256("cold-1"), juror, false, false, false, false);
        hub.recordJurorCase(keccak256("cold-2"), juror, false, false, false, false);
        vm.stopPrank();
        assertTrue(hub.isJurorEligible(juror));

        vm.prank(jurorMetricWriter);
        hub.recordJurorCase(keccak256("cold-3"), juror, true, false, false, false);
        assertFalse(hub.isJurorEligible(juror));
    }

    function test_jurorEligibilityUsesInclusiveEightyPercentBoundary() public {
        address atBoundary = makeAddr("atBoundary");
        address belowBoundary = makeAddr("belowBoundary");
        _recordCases(atBoundary, 5, 4, true);
        _recordCases(belowBoundary, 5, 3, true);

        assertTrue(hub.isJurorEligible(atBoundary));
        assertFalse(hub.isJurorEligible(belowBoundary));
    }

    function test_consensusAlignmentDoesNotAffectEligibility() public {
        address alignedJuror = makeAddr("alignedJuror");
        address opposedJuror = makeAddr("opposedJuror");
        _recordCases(alignedJuror, 5, 4, true);
        _recordCases(opposedJuror, 5, 4, false);

        (,,, uint256 alignedCount, uint256 alignedOpposed) = hub.jurorReputation(alignedJuror);
        (,,, uint256 opposedAligned, uint256 opposedCount) = hub.jurorReputation(opposedJuror);
        assertEq(alignedCount, 4);
        assertEq(alignedOpposed, 0);
        assertEq(opposedAligned, 0);
        assertEq(opposedCount, 4);
        assertEq(hub.isJurorEligible(alignedJuror), hub.isJurorEligible(opposedJuror));
        assertTrue(hub.isJurorEligible(alignedJuror));
    }

    function test_reputationScoreDrivesRealRiskBands() public {
        assertEq(hub.reputationScore(7), 50);

        vm.startPrank(outcomeWriter);
        hub.recordOutcome(keccak256("1"), 7, ReputationHub.Outcome.COMPLETED);
        hub.recordOutcome(keccak256("2"), 7, ReputationHub.Outcome.COMPLETED);
        hub.recordOutcome(keccak256("3"), 7, ReputationHub.Outcome.DEFAULTED);
        vm.stopPrank();

        assertEq(hub.reputationScore(7), 67);
    }

    function testFuzz_reputationAccountingAndIntegerRounding(
        uint8 rawCompleted,
        uint8 rawDefaulted,
        uint8 rawWon,
        uint8 rawLost
    ) public {
        uint256 completed = bound(uint256(rawCompleted), 0, 4);
        uint256 defaulted = bound(uint256(rawDefaulted), 0, 4);
        uint256 won = bound(uint256(rawWon), 0, 4);
        uint256 lost = bound(uint256(rawLost), 0, 4);

        vm.startPrank(outcomeWriter);
        for (uint256 i; i < completed; ++i) {
            hub.recordOutcome(keccak256(abi.encode("completed", i)), 7, ReputationHub.Outcome.COMPLETED);
        }
        for (uint256 i; i < defaulted; ++i) {
            hub.recordOutcome(keccak256(abi.encode("defaulted", i)), 7, ReputationHub.Outcome.DEFAULTED);
        }
        for (uint256 i; i < won; ++i) {
            hub.recordOutcome(keccak256(abi.encode("won", i)), 7, ReputationHub.Outcome.WON);
        }
        for (uint256 i; i < lost; ++i) {
            hub.recordOutcome(keccak256(abi.encode("lost", i)), 7, ReputationHub.Outcome.LOST);
        }
        vm.stopPrank();

        (uint256 actualCompleted, uint256 actualDefaulted, uint256 actualWon, uint256 actualLost) = hub.reputation(7);
        assertEq(actualCompleted, completed);
        assertEq(actualDefaulted, defaulted);
        assertEq(actualWon, won);
        assertEq(actualLost, lost);

        uint256 total = completed + defaulted + won + lost;
        uint256 expectedScore = 50;
        if (total != 0) {
            uint256 penalty = (100 * defaulted + 50 * lost) / total;
            expectedScore = penalty >= 100 ? 0 : 100 - penalty;
        }
        assertEq(hub.reputationScore(7), expectedScore);
    }

    function _recordCases(address subject, uint256 total, uint256 revealed, bool aligned) internal {
        vm.startPrank(jurorMetricWriter);
        for (uint256 i; i < total; ++i) {
            bool didReveal = i < revealed;
            hub.recordJurorCase(
                keccak256(abi.encode("eligibility", subject, i)), subject, didReveal, false, didReveal, aligned
            );
        }
        vm.stopPrank();
    }
}
