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

    function test_unauthorizedWriterRejected() public {
        vm.expectRevert(unicode"ReputationHub: 未授权调用方");
        hub.recordOutcome(keccak256("x"), 1, ReputationHub.Outcome.WON);
    }
}
