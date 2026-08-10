// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

contract SchellingVotingTest is Test {
    AgentRegistry registry;
    ReputationHub hub;
    GuaranteeEscrow escrow;
    SchellingVoting voting;
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address guarantor = makeAddr("guarantor");
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
        voting = new SchellingVoting(address(escrow), address(registry));
        hub.setAuthorizedCaller(address(escrow), true);
        escrow.transferOwnership(address(voting));
        vm.deal(buyer, 2 ether);
        vm.deal(guarantor, 2 ether);
        vm.prank(buyer); buyerId = registry.registerAgent("Buyer", "", "");
        vm.prank(seller); sellerId = registry.registerAgent("Seller", "", "");
        vm.prank(guarantor); guarantorId = registry.registerAgent("Guarantor", "", "");
        for (uint256 i; i < 5; ++i) {
            jurors[i] = makeAddr(string.concat("juror", vm.toString(i)));
            vm.deal(jurors[i], 1 ether);
            vm.prank(jurors[i]); registry.registerAgent("Juror", "", "");
        }
        vm.prank(buyer); tradeId = escrow.createTrade(buyerId, sellerId, 1 ether);
        vm.prank(seller); escrow.acceptTrade(tradeId);
        vm.prank(buyer); escrow.fund{value: 1 ether}(tradeId);
        vm.prank(guarantor); escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.05 ether);
        vm.prank(seller); escrow.acceptGuarantee(tradeId);
        vm.prank(seller); escrow.deliver(tradeId);
        vm.prank(buyer); escrow.dispute(tradeId);
        caseId = voting.openCase(tradeId, STAKE, 1 days, 1 days);
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
        SchellingVoting fresh = new SchellingVoting(address(escrow), address(registry));
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 案件不存在");
        fresh.commitVote{value: STAKE}(0, bytes32(uint256(1)));
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
        assertEq(escrow.pendingWithdrawals(buyer), 2 ether);
        vm.prank(jurors[0]); voting.claim(caseId);
        assertEq(voting.pendingWithdrawals(jurors[0]), STAKE + STAKE / 2);
    }

    function test_threeOfFiveIsNotRoundedUpToTwoThirdsAndVoidsSafely() public {
        for (uint256 i; i < 5; ++i) _commit(jurors[i], i < 3 ? SchellingVoting.Side.BUYER : SchellingVoting.Side.SELLER);
        vm.warp(block.timestamp + 1 days);
        for (uint256 i; i < 5; ++i) _reveal(jurors[i], i < 3 ? SchellingVoting.Side.BUYER : SchellingVoting.Side.SELLER);
        vm.warp(block.timestamp + 1 days);
        voting.settle(caseId);

        (bool effective, SchellingVoting.Side winner) = voting.caseResult(caseId);
        assertFalse(effective);
        assertEq(uint8(winner), uint8(SchellingVoting.Side.ABSTAIN));
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.VOIDED));
        assertEq(escrow.pendingWithdrawals(buyer), 1 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1 ether);
    }

    function test_onlySubjectsRegisteredAtSnapshotCanCommitAndOneSubjectOneVote() public {
        address late = makeAddr("late");
        vm.deal(late, 1 ether);
        // Even a registration later in the same block is outside the agent-count snapshot.
        vm.prank(late); registry.registerAgent("Late", "", "");
        vm.prank(late);
        vm.expectRevert(unicode"SchellingVoting: 不在资格快照中");
        voting.commitVote{value: STAKE}(caseId, bytes32(uint256(1)));

        vm.prank(jurors[0]); registry.registerAgent("SecondIdentity", "", "");
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 主体已提交");
        voting.commitVote{value: STAKE}(caseId, bytes32(uint256(2)));
    }

    function test_unrevealedOrInsufficientCaseRemainsLiveAndRefundable() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        _commit(jurors[1], SchellingVoting.Side.BUYER);
        vm.warp(block.timestamp + 2 days);
        voting.settle(caseId);
        vm.prank(jurors[0]); voting.claim(caseId);
        assertEq(voting.pendingWithdrawals(jurors[0]), STAKE);
    }
}
