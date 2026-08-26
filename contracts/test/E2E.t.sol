// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";
import {MockPoHVerifier} from "./mocks/MockPoHVerifier.sol";

contract E2ETest is Test {
    function _guardians() internal returns (address[] memory list) {
        list = new address[](2);
        list[0] = makeAddr("guardian-a");
        list[1] = makeAddr("guardian-b");
    }

    function _registerJuror(AgentRegistry registry, address who, bytes32 nullifier) internal returns (uint256 id) {
        vm.deal(who, 0.2 ether);
        vm.prank(who);
        id = registry.registerAgentVerified("Juror", "", "", nullifier, hex"01", _guardians());
    }

    function _commitVote(SchellingVoting voting, uint256 caseId, address juror, SchellingVoting.Side side, bytes32 salt)
        internal
    {
        bytes32 commitment = voting.voteCommitment(caseId, juror, side, salt);
        vm.prank(juror);
        voting.commitVote{value: 0.1 ether}(caseId, commitment);
    }

    function _revealVote(SchellingVoting voting, uint256 caseId, address juror, SchellingVoting.Side side, bytes32 salt)
        internal
    {
        vm.prank(juror);
        voting.revealVote(caseId, side, salt);
    }

    function _finalizeJuror(ReputationHub hub, SchellingVoting voting, uint256 caseId, address juror) internal {
        voting.finalizeJurorMetrics(caseId, juror);
        bytes32 jurorCaseId =
            keccak256(abi.encode("AGENTTRUST_JUROR_CASE_V1", address(voting), block.chainid, caseId, juror));
        assertTrue(hub.recordedJurorCases(jurorCaseId));
    }

    function test_fullAcceptedTradeCommitRevealAndPullSettlement() public {
        AgentRegistry registry = new AgentRegistry();
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        ReputationHub hub = new ReputationHub();
        GuaranteeEscrow escrow = new GuaranteeEscrow(address(registry), address(hub));
        SchellingVoting voting =
            new SchellingVoting(address(escrow), address(registry), address(hub), 0.1 ether, 1 days, 1 days);
        hub.setOutcomeWriter(address(escrow), true);
        hub.setJurorMetricWriter(address(voting), true);
        escrow.transferOwnership(address(voting));
        registry.setObligationOracles(address(escrow), address(voting));

        address buyer = makeAddr("buyer");
        address seller = makeAddr("seller");
        address guarantor = makeAddr("guarantor");
        address[3] memory jurors = [makeAddr("j1"), makeAddr("j2"), makeAddr("j3")];
        vm.deal(buyer, 3 ether);
        vm.deal(seller, 1 ether);
        vm.deal(guarantor, 2 ether);
        vm.prank(buyer);
        uint256 buyerId = registry.registerAgent("Buyer", "", "", _guardians());
        vm.prank(seller);
        uint256 sellerId = registry.registerAgent("Seller", "", "", _guardians());
        vm.prank(guarantor);
        uint256 guarantorId =
            registry.registerAgentVerified("Guarantor", "", "", keccak256("human-guarantor"), hex"01", _guardians());
        for (uint256 i; i < 3; ++i) {
            _registerJuror(registry, jurors[i], keccak256(abi.encode("human-juror", i)));
        }

        vm.prank(buyer);
        uint256 tradeId = escrow.createTrade(buyerId, sellerId, 1 ether, 0.2 ether);
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

        vm.warp(block.timestamp + escrow.EVIDENCE_WINDOW() + 1);
        vm.prank(makeAddr("case opener"));
        uint256 caseId = voting.openCase(tradeId);
        bytes32 salt = keccak256("e2e");
        for (uint256 i; i < 3; ++i) {
            _commitVote(
                voting, caseId, jurors[i], i < 2 ? SchellingVoting.Side.BUYER : SchellingVoting.Side.SELLER, salt
            );
        }
        vm.warp(block.timestamp + 1 days);
        for (uint256 i; i < 3; ++i) {
            _revealVote(
                voting, caseId, jurors[i], i < 2 ? SchellingVoting.Side.BUYER : SchellingVoting.Side.SELLER, salt
            );
        }
        vm.warp(block.timestamp + 1 days);
        voting.settle(caseId);

        for (uint256 i; i < 3; ++i) {
            _finalizeJuror(hub, voting, caseId, jurors[i]);
        }
        vm.expectRevert(unicode"ReputationHub: 陪审记录已存在");
        voting.finalizeJurorMetrics(caseId, jurors[0]);

        uint256 buyerCredit = escrow.pendingWithdrawals(buyer);
        assertEq(buyerCredit, 2.02 ether);
        (,,, uint256 lost) = hub.reputation(sellerId);
        assertEq(lost, 1);
        uint256 balanceBefore = buyer.balance;
        vm.prank(buyer);
        escrow.withdraw(payable(buyer));
        assertEq(buyer.balance - balanceBefore, buyerCredit);
    }
}
