// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReputationHub} from "../src/ReputationHub.sol";

contract ReputationHubTest is Test {
    ReputationHub hub;
    address writer = makeAddr("writer");

    function setUp() public {
        hub = new ReputationHub();
        hub.setAuthorizedCaller(writer, true);
    }

    function test_uniqueOutcomeCannotBeRecordedTwice() public {
        bytes32 outcomeId = keccak256("trade-1");
        vm.prank(writer);
        hub.recordOutcome(outcomeId, 7, ReputationHub.Outcome.COMPLETED);

        vm.prank(writer);
        vm.expectRevert(unicode"ReputationHub: 结果已记录");
        hub.recordOutcome(outcomeId, 7, ReputationHub.Outcome.DEFAULTED);

        (uint256 completed, uint256 defaulted,,) = hub.reputation(7);
        assertEq(completed, 1);
        assertEq(defaulted, 0);
    }

    function test_reputationScoreDrivesRealRiskBands() public {
        assertEq(hub.reputationScore(7), 50);

        vm.startPrank(writer);
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

        vm.startPrank(writer);
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

    function test_unauthorizedWriterRejected() public {
        vm.expectRevert(unicode"ReputationHub: 未授权调用方");
        hub.recordOutcome(keccak256("x"), 1, ReputationHub.Outcome.WON);
    }
}
