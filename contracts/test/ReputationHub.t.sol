// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReputationHub} from "../src/ReputationHub.sol";

contract ReputationHubTest is Test {
    ReputationHub hub;
    address escrow = makeAddr("escrow");
    address voting = makeAddr("voting");
    address stranger = makeAddr("stranger");

    function setUp() public {
        hub = new ReputationHub();
        hub.setAuthorizedCaller(escrow, true);
        hub.setAuthorizedCaller(voting, true);
    }

    function test_recordOutcome_updatesStats() public {
        vm.startPrank(escrow);
        hub.recordOutcome(1, ReputationHub.Outcome.COMPLETED);
        hub.recordOutcome(1, ReputationHub.Outcome.DEFAULTED);
        hub.recordOutcome(2, ReputationHub.Outcome.WON);
        vm.stopPrank();

        (uint256 completed, uint256 defaulted, uint256 disputesWon, uint256 disputesLost) =
            hub.reputation(1);
        assertEq(completed, 1);
        assertEq(defaulted, 1);
        assertEq(disputesWon, 0);

        (uint256 c2, uint256 d2, uint256 w2,) = hub.reputation(2);
        assertEq(c2, 0);
        assertEq(d2, 0);
        assertEq(w2, 1);
    }

    function test_recordOutcome_lostBranch() public {
        vm.prank(escrow);
        hub.recordOutcome(1, ReputationHub.Outcome.LOST);

        (, , , uint256 disputesLost) = hub.reputation(1);
        assertEq(disputesLost, 1);
    }

    function test_recordOutcome_rejectsUnauthorized() public {
        vm.prank(stranger);
        vm.expectRevert(unicode"ReputationHub: 未授权调用方");
        hub.recordOutcome(1, ReputationHub.Outcome.COMPLETED);
    }

    function test_setAuthorizedCaller_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        hub.setAuthorizedCaller(escrow, true);
    }

    function test_revokeCaller_rejectsWrite() public {
        hub.setAuthorizedCaller(escrow, false);

        vm.prank(escrow);
        vm.expectRevert(unicode"ReputationHub: 未授权调用方");
        hub.recordOutcome(1, ReputationHub.Outcome.COMPLETED);
    }

    function test_events_emitted() public {
        vm.expectEmit();
        emit ReputationHub.OutcomeRecorded(1, ReputationHub.Outcome.COMPLETED);
        vm.prank(escrow);
        hub.recordOutcome(1, ReputationHub.Outcome.COMPLETED);
    }

    function test_callerAuthorized_event() public {
        vm.expectEmit();
        emit ReputationHub.CallerAuthorized(voting, false);
        hub.setAuthorizedCaller(voting, false);
    }

    function test_reputationScore_boundaries() public {
        // 无记录的新智能体默认 50
        assertEq(hub.reputationScore(1), 50);

        vm.startPrank(escrow);
        hub.recordOutcome(1, ReputationHub.Outcome.COMPLETED);
        assertEq(hub.reputationScore(1), 100);

        hub.recordOutcome(1, ReputationHub.Outcome.DEFAULTED);
        vm.stopPrank();
        assertEq(hub.reputationScore(1), 50);
    }
}
