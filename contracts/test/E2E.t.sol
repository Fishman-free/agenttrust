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
            vm.deal(jurors[i], 0.2 ether);
            vm.prank(jurors[i]);
            registry.registerAgentVerified(
                "Juror", "", "", keccak256(abi.encode("human-juror", i)), hex"01", _guardians()
            );
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

        vm.prank(makeAddr("case opener"));
        uint256 caseId = voting.openCase(tradeId);
        bytes32 salt = keccak256("e2e");
        for (uint256 i; i < 3; ++i) {
            SchellingVoting.Side side = i < 2 ? SchellingVoting.Side.BUYER : SchellingVoting.Side.SELLER;
            bytes32 commitment = voting.voteCommitment(caseId, jurors[i], side, salt);
            vm.prank(jurors[i]);
            voting.commitVote{value: 0.1 ether}(caseId, commitment);
        }
        vm.warp(block.timestamp + 1 days);
        for (uint256 i; i < 3; ++i) {
            SchellingVoting.Side side = i < 2 ? SchellingVoting.Side.BUYER : SchellingVoting.Side.SELLER;
            vm.prank(jurors[i]);
            voting.revealVote(caseId, side, salt);
        }
        vm.warp(block.timestamp + 1 days);
        voting.settle(caseId);

        for (uint256 i; i < 3; ++i) {
            voting.finalizeJurorMetrics(caseId, jurors[i]);
            bytes32 jurorCaseId =
                keccak256(abi.encode("AGENTTRUST_JUROR_CASE_V1", address(voting), block.chainid, caseId, jurors[i]));
            assertTrue(hub.recordedJurorCases(jurorCaseId));
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
