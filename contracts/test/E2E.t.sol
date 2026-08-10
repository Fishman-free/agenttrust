// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

contract E2ETest is Test {
    function test_fullAcceptedTradeCommitRevealAndPullSettlement() public {
        AgentRegistry registry = new AgentRegistry();
        ReputationHub hub = new ReputationHub();
        GuaranteeEscrow escrow = new GuaranteeEscrow(address(registry), address(hub));
        SchellingVoting voting = new SchellingVoting(address(escrow), address(registry));
        hub.setAuthorizedCaller(address(escrow), true);
        escrow.transferOwnership(address(voting));

        address buyer = makeAddr("buyer");
        address seller = makeAddr("seller");
        address guarantor = makeAddr("guarantor");
        address[3] memory jurors = [makeAddr("j1"), makeAddr("j2"), makeAddr("j3")];
        vm.deal(buyer, 1 ether);
        vm.deal(guarantor, 1 ether);
        vm.prank(buyer);
        uint256 buyerId = registry.registerAgent("Buyer", "", "");
        vm.prank(seller);
        uint256 sellerId = registry.registerAgent("Seller", "", "");
        vm.prank(guarantor);
        uint256 guarantorId = registry.registerAgent("Guarantor", "", "");
        for (uint256 i; i < 3; ++i) {
            vm.deal(jurors[i], 0.1 ether);
            vm.prank(jurors[i]);
            registry.registerAgent("Juror", "", "");
        }

        vm.prank(buyer);
        uint256 tradeId = escrow.createTrade(buyerId, sellerId, 1 ether);
        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0);
        vm.prank(seller);
        escrow.acceptGuarantee(tradeId);
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute(tradeId);

        uint256 caseId = voting.openCase(tradeId, 0.1 ether, 1 days, 1 days);
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

        assertEq(escrow.pendingWithdrawals(buyer), 2 ether);
        (,,, uint256 lost) = hub.reputation(sellerId);
        assertEq(lost, 1);
        vm.prank(buyer);
        escrow.withdraw(payable(buyer));
        assertEq(buyer.balance, 2 ether);
    }
}
