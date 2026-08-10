// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";

contract RejectingEscrowReceiver {
    receive() external payable {
        revert("reject ether");
    }
}

contract GuaranteeEscrowTest is Test {
    event TradeResolved(uint256 indexed tradeId, GuaranteeEscrow.Verdict verdict, uint256 buyerShareBps);

    AgentRegistry registry;
    ReputationHub hub;
    GuaranteeEscrow escrow;

    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address guarantor = makeAddr("guarantor");
    address stranger = makeAddr("stranger");
    uint256 buyerId;
    uint256 sellerId;
    uint256 guarantorId;
    uint256 tradeId;

    function setUp() public {
        registry = new AgentRegistry();
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        hub.setOutcomeWriter(address(escrow), true);
        vm.deal(buyer, 10 ether);
        vm.deal(guarantor, 10 ether);
        vm.prank(buyer);
        buyerId = registry.registerAgent("Buyer", "", "");
        vm.prank(seller);
        sellerId = registry.registerAgent("Seller", "", "");
        vm.prank(guarantor);
        guarantorId = registry.registerAgent("Guarantor", "", "");
        vm.prank(buyer);
        tradeId = escrow.createTrade(buyerId, sellerId, 1 ether, 0.1 ether);
    }

    function _acceptFundGuarantee() internal {
        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.075 ether);
        vm.prank(seller);
        escrow.acceptGuarantee(tradeId);
    }

    function _createAcceptedFunded(uint256 amount) internal returns (uint256 id) {
        vm.prank(buyer);
        id = escrow.createTrade(buyerId, sellerId, amount, amount / 10);
        vm.prank(seller);
        escrow.acceptTrade(id);
        vm.deal(buyer, amount);
        vm.prank(buyer);
        escrow.fund{value: amount}(id);
    }

    function test_zeroAmountRejected() public {
        vm.prank(buyer);
        vm.expectRevert(unicode"GuaranteeEscrow: 金额必须大于零");
        escrow.createTrade(buyerId, sellerId, 0, 0);
    }

    function test_sellerMustAcceptBeforeFundsOrDefaultExposure() public {
        vm.prank(buyer);
        vm.expectRevert(unicode"GuaranteeEscrow: 状态错误");
        escrow.fund{value: 1 ether}(tradeId);

        vm.warp(block.timestamp + escrow.ACCEPT_WINDOW() + 1);
        escrow.timeoutCancelUnaccepted(tradeId);
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.VOIDED));
        assertEq(hub.reputationScore(sellerId), 50, "unaccepted proposal cannot accuse seller");
    }

    function test_principalSnapshotsSurviveIdentityTransfer() public {
        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(seller);
        registry.transferFrom(seller, stranger, sellerId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.075 ether);
        vm.prank(seller);
        escrow.acceptGuarantee(tradeId);
        vm.prank(seller);
        escrow.deliver(tradeId);
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.DELIVERED));
    }

    function test_samePrincipalTradeAndSelfGuaranteeRejected() public {
        vm.prank(buyer);
        uint256 secondBuyerId = registry.registerAgent("AlsoBuyer", "", "");
        vm.prank(buyer);
        vm.expectRevert(unicode"GuaranteeEscrow: 买卖方主体必须不同");
        escrow.createTrade(buyerId, secondBuyerId, 1 ether, 0.1 ether);

        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);
        vm.prank(buyer);
        vm.expectRevert(unicode"GuaranteeEscrow: 交易主体不得自担保");
        escrow.guarantee{value: 1 ether}(tradeId, buyerId, 1e18, 0);

        vm.deal(seller, 1 ether);
        vm.prank(seller);
        vm.expectRevert(unicode"GuaranteeEscrow: 交易主体不得自担保");
        escrow.guarantee{value: 1 ether}(tradeId, sellerId, 1e18, 0);
    }

    function test_reputationCoveragePremiumAndRoundingBounds() public {
        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);

        GuaranteeEscrow.Trade memory snapshot = escrow.getTrade(tradeId);
        assertEq(snapshot.minCoverage, 0.75e18);
        assertEq(snapshot.referencePremium, 0.075 ether);
        assertEq(snapshot.maxPremium, 0.1 ether);

        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 覆盖率低于信誉要求");
        escrow.guarantee{value: 0.75 ether}(tradeId, guarantorId, 0.75e18 - 1, 0.075 ether);
        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 保费低于参考价");
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.075 ether - 1);
        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 保费高于买方上限");
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.1 ether + 1);
        vm.prank(guarantor);
        escrow.guarantee{value: 2 ether}(tradeId, guarantorId, 2e18, 0.1 ether);
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.GUARANTEE_OFFERED));

        vm.prank(buyer);
        uint256 tiny = escrow.createTrade(buyerId, sellerId, 1, 0);
        vm.prank(seller);
        escrow.acceptTrade(tiny);
        vm.prank(buyer);
        escrow.fund{value: 1}(tiny);
        vm.prank(guarantor);
        escrow.guarantee{value: 1}(tiny, guarantorId, 1e18, 0);
        assertEq(escrow.requiredStake(tiny, 1e18), 1, "stake rounds up and never becomes zero");
    }

    function test_quoteFormulaVectorsAndInsurability() public {
        hub.setOutcomeWriter(address(this), true);
        hub.recordOutcome(keccak256("perfect"), 1001, ReputationHub.Outcome.COMPLETED);
        hub.recordOutcome(keccak256("defaulted"), 1002, ReputationHub.Outcome.DEFAULTED);

        (uint256 coverage50, uint256 stake50, uint256 premium50, bool insurable50) =
            escrow.quoteGuaranteeTerms(sellerId, 1 ether, 0.075 ether);
        assertEq(coverage50, 0.75e18);
        assertEq(stake50, 0.75 ether);
        assertEq(premium50, 0.075 ether);
        assertTrue(insurable50);

        (uint256 coverage100,, uint256 premium100, bool insurable100) = escrow.quoteGuaranteeTerms(1001, 1 ether, 0);
        assertEq(coverage100, 0.5e18);
        assertEq(premium100, 0);
        assertTrue(insurable100);

        (uint256 coverage0,, uint256 premium0, bool insurable0) = escrow.quoteGuaranteeTerms(1002, 1 ether, 0.2 ether);
        assertEq(coverage0, 1e18);
        assertEq(premium0, 0.2 ether);
        assertTrue(insurable0);

        (,,, bool belowReference) = escrow.quoteGuaranteeTerms(sellerId, 1 ether, 0.075 ether - 1);
        (,,, bool aboveCap) = escrow.quoteGuaranteeTerms(sellerId, 1 ether, 0.2 ether + 1);
        assertFalse(belowReference);
        assertFalse(aboveCap);
    }

    function test_underwritingTermsAreSnapshottedWhileLiveQuoteChanges() public {
        GuaranteeEscrow.Trade memory beforeMutation = escrow.getTrade(tradeId);
        assertEq(beforeMutation.minCoverage, 0.75e18);
        assertEq(beforeMutation.referencePremium, 0.075 ether);

        hub.setOutcomeWriter(address(this), true);
        hub.recordOutcome(keccak256("seller-default-after-create"), sellerId, ReputationHub.Outcome.DEFAULTED);
        (uint256 liveCoverage,, uint256 livePremium,) = escrow.quoteGuaranteeTerms(sellerId, 1 ether, 0.2 ether);
        assertEq(liveCoverage, 1e18);
        assertEq(livePremium, 0.2 ether);

        GuaranteeEscrow.Trade memory afterMutation = escrow.getTrade(tradeId);
        assertEq(afterMutation.minCoverage, beforeMutation.minCoverage);
        assertEq(afterMutation.referencePremium, beforeMutation.referencePremium);

        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 0.75 ether}(tradeId, guarantorId, 0.75e18, 0.075 ether);
    }

    function test_createRejectsUninsurablePremiumBounds() public {
        vm.startPrank(buyer);
        vm.expectRevert(unicode"GuaranteeEscrow: 保费上限不可承保");
        escrow.createTrade(buyerId, sellerId, 1 ether, 0.075 ether - 1);
        vm.expectRevert(unicode"GuaranteeEscrow: 保费上限不可承保");
        escrow.createTrade(buyerId, sellerId, 1 ether, 0.2 ether + 1);
        vm.stopPrank();
    }

    function testFuzz_quoteTermsMonotonicWithRisk(uint8 rawLowScore, uint8 rawHighScore, uint96 rawAmount) public {
        uint256 lowScore = bound(uint256(rawLowScore), 0, 100);
        uint256 highScore = bound(uint256(rawHighScore), lowScore, 100);
        uint256 amount = bound(uint256(rawAmount), 1, 100 ether);
        vm.mockCall(address(hub), abi.encodeCall(hub.reputationScore, (2001)), abi.encode(lowScore));
        vm.mockCall(address(hub), abi.encodeCall(hub.reputationScore, (2002)), abi.encode(highScore));

        (uint256 lowCoverage,, uint256 lowPremium,) = escrow.quoteGuaranteeTerms(2001, amount, amount * 20 / 100);
        (uint256 highCoverage,, uint256 highPremium,) = escrow.quoteGuaranteeTerms(2002, amount, amount * 20 / 100);
        assertGe(lowCoverage, highCoverage);
        assertGe(lowPremium, highPremium);
    }

    function testFuzz_amountCoveragePremiumBoundariesAndCeilRounding(
        uint96 rawAmount,
        uint64 rawCoverage,
        uint96 rawPremium
    ) public {
        uint256 amount = bound(uint256(rawAmount), 1, 100 ether);
        uint256 coverage = bound(uint256(rawCoverage), 1e18, escrow.MAX_COVERAGE());
        uint256 referencePremium = (amount * 750) / 10000;
        uint256 maximumPremium = amount / 10;
        uint256 premium = bound(uint256(rawPremium), referencePremium, maximumPremium);
        uint256 id = _createAcceptedFunded(amount);
        uint256 expectedStake = (amount * coverage + 1e18 - 1) / 1e18;

        assertEq(escrow.requiredStake(id, coverage), expectedStake);
        vm.deal(guarantor, expectedStake);
        vm.prank(guarantor);
        escrow.guarantee{value: expectedStake}(id, guarantorId, coverage, premium);

        vm.warp(block.timestamp + escrow.GUARANTEE_ACCEPT_WINDOW() + 1);
        escrow.timeoutRejectGuarantee(id);
        assertEq(escrow.pendingWithdrawals(buyer), amount);
        assertEq(escrow.pendingWithdrawals(guarantor), expectedStake);
    }

    function testFuzz_invalidCoveragePremiumAndStakeBoundaries(uint96 rawAmount, uint64 rawCoverage) public {
        uint256 amount = bound(uint256(rawAmount), 1, 100 ether);
        uint256 maxCoverage = escrow.MAX_COVERAGE();
        uint256 id = _createAcceptedFunded(amount);
        uint256 referencePremium = amount * 750 / 10000;
        uint256 belowMinimum = bound(uint256(rawCoverage), 0, 0.75e18 - 1);

        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 覆盖率低于信誉要求");
        escrow.guarantee(id, guarantorId, belowMinimum, referencePremium);

        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 覆盖率非法");
        escrow.guarantee(id, guarantorId, maxCoverage + 1, referencePremium);

        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 保费高于买方上限");
        escrow.guarantee(id, guarantorId, 1e18, amount / 10 + 1);

        vm.deal(guarantor, amount - 1);
        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 担保质押金额不符");
        escrow.guarantee{value: amount - 1}(id, guarantorId, 1e18, referencePremium);
    }

    function test_unacceptedGuaranteeOfferCannotCreateSellerDefault() public {
        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.075 ether);
        vm.warp(block.timestamp + escrow.GUARANTEE_ACCEPT_WINDOW() + 1);
        escrow.timeoutRejectGuarantee(tradeId);
        assertEq(escrow.pendingWithdrawals(buyer), 1 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1 ether);
        assertEq(hub.reputationScore(sellerId), 50);
    }

    function test_remainingTimeoutExitsSettleExactlyOnce() public {
        vm.prank(seller);
        escrow.acceptTrade(tradeId);

        uint256 funded = _createAcceptedFunded(1 ether);
        uint256 guaranteed = _createAcceptedFunded(1 ether);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(guaranteed, guarantorId, 1e18, 0.075 ether);
        vm.prank(seller);
        escrow.acceptGuarantee(guaranteed);

        uint256 delivered = _createAcceptedFunded(1 ether);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(delivered, guarantorId, 1e18, 0.075 ether);
        vm.prank(seller);
        escrow.acceptGuarantee(delivered);
        vm.prank(seller);
        escrow.deliver(delivered);

        vm.warp(block.timestamp + 1 days + 1);
        escrow.timeoutCancelUnfunded(tradeId);
        escrow.timeoutRefund(funded);
        escrow.timeoutRefund(guaranteed);
        escrow.timeoutAutoRelease(delivered);

        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.VOIDED));
        assertEq(uint8(escrow.tradeState(funded)), uint8(GuaranteeEscrow.State.VOIDED));
        assertEq(uint8(escrow.tradeState(guaranteed)), uint8(GuaranteeEscrow.State.RESOLVED));
        assertEq(uint8(escrow.tradeState(delivered)), uint8(GuaranteeEscrow.State.RELEASED));
        assertEq(escrow.pendingWithdrawals(buyer), 3 ether);
        assertEq(escrow.pendingWithdrawals(seller), 0.925 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1.075 ether);
        (uint256 completed, uint256 defaulted,,) = hub.reputation(sellerId);
        assertEq(completed, 1);
        assertEq(defaulted, 1);

        vm.expectRevert(unicode"GuaranteeEscrow: 状态错误");
        escrow.timeoutRefund(funded);
    }

    function test_pullPaymentsMakeSettlementNonBlockingAndUnique() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.confirm(tradeId);

        assertEq(escrow.pendingWithdrawals(seller), 0.925 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1.075 ether);
        (uint256 completed,,,) = hub.reputation(sellerId);
        assertEq(completed, 1);
        vm.expectRevert(unicode"GuaranteeEscrow: 状态错误");
        vm.prank(buyer);
        escrow.confirm(tradeId);
    }

    function test_confirmSettlesWithRevokedOutcomeWriterAndPermissionlessRetryRecordsOnce() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        hub.setOutcomeWriter(address(escrow), false);

        vm.prank(buyer);
        escrow.confirm(tradeId);
        GuaranteeEscrow.Trade memory deferred = escrow.getTrade(tradeId);
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.RELEASED));
        assertEq(escrow.pendingWithdrawals(seller), 0.925 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1.075 ether);
        assertTrue(deferred.outcomePending);
        assertFalse(deferred.outcomeRecorded);
        assertEq(uint8(deferred.pendingOutcome), uint8(ReputationHub.Outcome.COMPLETED));

        hub.setOutcomeWriter(address(escrow), true);
        vm.prank(stranger);
        assertTrue(escrow.retryOutcome(tradeId));
        (uint256 completed,,,) = hub.reputation(sellerId);
        assertEq(completed, 1);
        vm.expectRevert(unicode"GuaranteeEscrow: 无待记录结果");
        escrow.retryOutcome(tradeId);
        (completed,,,) = hub.reputation(sellerId);
        assertEq(completed, 1);
    }

    function test_defaultSettlesWithRevokedOutcomeWriterAndRetryRecordsOnce() public {
        _acceptFundGuarantee();
        hub.setOutcomeWriter(address(escrow), false);
        vm.warp(block.timestamp + escrow.DELIVER_WINDOW() + 1);

        escrow.timeoutRefund(tradeId);
        GuaranteeEscrow.Trade memory deferred = escrow.getTrade(tradeId);
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.RESOLVED));
        assertEq(escrow.pendingWithdrawals(buyer), 2 ether);
        assertTrue(deferred.outcomePending);
        assertEq(uint8(deferred.pendingOutcome), uint8(ReputationHub.Outcome.DEFAULTED));

        hub.setOutcomeWriter(address(escrow), true);
        vm.prank(stranger);
        assertTrue(escrow.retryOutcome(tradeId));
        (, uint256 defaulted,,) = hub.reputation(sellerId);
        assertEq(defaulted, 1);
        vm.expectRevert(unicode"GuaranteeEscrow: 无待记录结果");
        escrow.retryOutcome(tradeId);
    }

    function test_disputeSettlesWithRevokedOutcomeWriterAndRetryRecordsOnce() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute{value: 0.02 ether}(tradeId);
        escrow.openArbitration(tradeId);
        hub.setOutcomeWriter(address(escrow), false);

        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.SELLER_WINS, 9999);
        GuaranteeEscrow.Trade memory deferred = escrow.getTrade(tradeId);
        assertEq(escrow.pendingWithdrawals(seller), 0.945 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1.075 ether);
        assertTrue(deferred.outcomePending);
        assertEq(uint8(deferred.pendingOutcome), uint8(ReputationHub.Outcome.WON));

        hub.setOutcomeWriter(address(escrow), true);
        vm.prank(stranger);
        assertTrue(escrow.retryOutcome(tradeId));
        (,, uint256 won,) = hub.reputation(sellerId);
        assertEq(won, 1);
        vm.expectRevert(unicode"GuaranteeEscrow: 无待记录结果");
        escrow.retryOutcome(tradeId);
    }

    function test_disputeWithoutCaseCanBeSafelyVoided() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute{value: 0.02 ether}(tradeId);
        vm.warp(block.timestamp + escrow.CASE_OPEN_WINDOW() + 1);
        escrow.timeoutVoidDispute(tradeId);

        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.VOIDED));
        assertEq(escrow.pendingWithdrawals(buyer), 1.02 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1 ether);
        assertEq(escrow.totalLiability(), 2.02 ether);
        assertEq(escrow.getTrade(tradeId).disputeBond, 0);
        assertEq(hub.reputationScore(sellerId), 50);
    }

    function test_disputeRequiresExactCeilBondAndTracksLiability() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        assertEq(escrow.requiredDisputeBond(tradeId), 0.02 ether);

        vm.prank(buyer);
        vm.expectRevert(unicode"GuaranteeEscrow: 争议保证金金额不符");
        escrow.dispute{value: 0.02 ether - 1}(tradeId);
        assertEq(escrow.totalLiability(), 2 ether);

        vm.prank(buyer);
        escrow.dispute{value: 0.02 ether}(tradeId);
        GuaranteeEscrow.Trade memory t = escrow.getTrade(tradeId);
        assertEq(t.disputeInitiator, buyer);
        assertEq(t.disputeBond, 0.02 ether);
        assertEq(escrow.totalLiability(), 2.02 ether);
    }

    function test_tradeCreationSnapshotsRegistryAgentCount() public {
        uint256 countAtCreation = registry.agentCount();
        assertEq(escrow.eligibilityAgentCount(tradeId), countAtCreation);
        assertEq(escrow.getTrade(tradeId).eligibilityAgentCount, countAtCreation);

        vm.prank(stranger);
        registry.registerAgent("Late Juror", "", "");
        assertEq(registry.agentCount(), countAtCreation + 1);
        assertFalse(registry.isRegisteredSubjectAtCount(stranger, escrow.eligibilityAgentCount(tradeId)));
    }

    function test_buyerWinsAllocatesSellerInitiatedBondToBuyerOnce() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.deal(seller, 0.02 ether);
        vm.prank(seller);
        escrow.dispute{value: 0.02 ether}(tradeId);
        escrow.openArbitration(tradeId);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit TradeResolved(tradeId, GuaranteeEscrow.Verdict.BUYER_WINS, 10000);
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.BUYER_WINS, 0);

        assertEq(escrow.pendingWithdrawals(buyer), 2.02 ether);
        assertEq(escrow.getTrade(tradeId).disputeBond, 0);
        vm.expectRevert(unicode"GuaranteeEscrow: 仅活动案件可裁决");
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.BUYER_WINS, 0);
    }

    function test_sellerWinsAllocatesBuyerInitiatedBondToSeller() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute{value: 0.02 ether}(tradeId);
        escrow.openArbitration(tradeId);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit TradeResolved(tradeId, GuaranteeEscrow.Verdict.SELLER_WINS, 0);
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.SELLER_WINS, 7777);

        assertEq(escrow.pendingWithdrawals(seller), 0.945 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1.075 ether);
    }

    function test_partialReturnsBondToInitiatorAndVoidReturnsBond() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.deal(seller, 0.02 ether);
        vm.prank(seller);
        escrow.dispute{value: 0.02 ether}(tradeId);
        escrow.openArbitration(tradeId);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit TradeResolved(tradeId, GuaranteeEscrow.Verdict.PARTIAL_BUYER, 4000);
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.PARTIAL_BUYER, 4000);

        assertEq(escrow.pendingWithdrawals(buyer), 0.8 ether);
        assertEq(escrow.pendingWithdrawals(seller), 0.62 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 0.6 ether);
        assertEq(escrow.totalLiability(), 2.02 ether);
        assertEq(escrow.getTrade(tradeId).disputeBond, 0);
    }

    function test_partialRejectsZeroAndFullBuyerShares() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute{value: 0.02 ether}(tradeId);
        escrow.openArbitration(tradeId);

        vm.expectRevert(unicode"GuaranteeEscrow: 部分裁决比例非法");
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.PARTIAL_BUYER, 0);
        vm.expectRevert(unicode"GuaranteeEscrow: 部分裁决比例非法");
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.PARTIAL_BUYER, 10000);
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.DISPUTED));
    }

    function testFuzz_partialStakeRoundsDownAndRemainderPreservesLiability(uint16 rawShare) public {
        uint256 share = bound(uint256(rawShare), 1, 9999);
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute{value: 0.02 ether}(tradeId);
        escrow.openArbitration(tradeId);
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.PARTIAL_BUYER, share);

        uint256 buyerPrincipal = 1 ether * share / 10000;
        uint256 buyerStake = 1 ether * share / 10000;
        assertEq(escrow.pendingWithdrawals(buyer), buyerPrincipal + buyerStake + 0.02 ether);
        assertEq(escrow.pendingWithdrawals(seller), 1 ether - buyerPrincipal);
        assertEq(escrow.pendingWithdrawals(guarantor), 1 ether - buyerStake);
        assertEq(
            escrow.pendingWithdrawals(buyer) + escrow.pendingWithdrawals(seller) + escrow.pendingWithdrawals(guarantor),
            escrow.totalLiability()
        );
    }

    function test_voidOpenedDisputeReturnsBondToInitiator() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.deal(seller, 0.02 ether);
        vm.prank(seller);
        escrow.dispute{value: 0.02 ether}(tradeId);
        escrow.openArbitration(tradeId);
        escrow.voidDispute(tradeId);

        assertEq(escrow.pendingWithdrawals(buyer), 1 ether);
        assertEq(escrow.pendingWithdrawals(seller), 0.02 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1 ether);
    }

    function testFuzz_disputeBondAlwaysRoundsUp(uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, 100 ether);
        uint256 id = _createAcceptedFunded(amount);
        assertEq(escrow.requiredDisputeBond(id), (amount * 200 + 9999) / 10000);
    }

    function test_failedWithdrawalPreservesCreditAndCanRecover() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.confirm(tradeId);

        RejectingEscrowReceiver rejecting = new RejectingEscrowReceiver();
        vm.prank(seller);
        vm.expectRevert(unicode"GuaranteeEscrow: 提取失败");
        escrow.withdraw(payable(address(rejecting)));
        assertEq(escrow.pendingWithdrawals(seller), 0.925 ether);

        uint256 beforeBalance = seller.balance;
        vm.prank(seller);
        escrow.withdraw(payable(seller));
        assertEq(seller.balance - beforeBalance, 0.925 ether);
        assertEq(escrow.pendingWithdrawals(seller), 0);

        vm.prank(seller);
        vm.expectRevert(unicode"GuaranteeEscrow: 无可提取余额");
        escrow.withdraw(payable(seller));
    }

    function test_nonexistentTradeCannotBeOperated() public {
        vm.expectRevert(unicode"GuaranteeEscrow: 交易不存在");
        escrow.tradeState(999);
    }

    function testFuzz_nonexistentTradeRejectsEveryMutation(uint128 rawId, uint8 rawOperation) public {
        uint256 missingId = bound(uint256(rawId), escrow.nextTradeId(), type(uint128).max);
        uint256 operation = bound(uint256(rawOperation), 0, 15);
        bytes memory callData;
        if (operation == 0) {
            callData = abi.encodeCall(escrow.acceptTrade, (missingId));
        } else if (operation == 1) {
            callData = abi.encodeCall(escrow.fund, (missingId));
        } else if (operation == 2) {
            callData = abi.encodeCall(escrow.guarantee, (missingId, guarantorId, 1e18, 0));
        } else if (operation == 3) {
            callData = abi.encodeCall(escrow.acceptGuarantee, (missingId));
        } else if (operation == 4) {
            callData = abi.encodeCall(escrow.deliver, (missingId));
        } else if (operation == 5) {
            callData = abi.encodeCall(escrow.confirm, (missingId));
        } else if (operation == 6) {
            callData = abi.encodeCall(escrow.dispute, (missingId));
        } else if (operation == 7) {
            callData = abi.encodeCall(escrow.openArbitration, (missingId));
        } else if (operation == 8) {
            callData = abi.encodeCall(escrow.resolveDispute, (missingId, GuaranteeEscrow.Verdict.BUYER_WINS, 10000));
        } else if (operation == 9) {
            callData = abi.encodeCall(escrow.voidDispute, (missingId));
        } else if (operation == 10) {
            callData = abi.encodeCall(escrow.timeoutAutoRelease, (missingId));
        } else if (operation == 11) {
            callData = abi.encodeCall(escrow.timeoutCancelUnaccepted, (missingId));
        } else if (operation == 12) {
            callData = abi.encodeCall(escrow.timeoutCancelUnfunded, (missingId));
        } else if (operation == 13) {
            callData = abi.encodeCall(escrow.timeoutRejectGuarantee, (missingId));
        } else if (operation == 14) {
            callData = abi.encodeCall(escrow.timeoutRefund, (missingId));
        } else {
            callData = abi.encodeCall(escrow.timeoutVoidDispute, (missingId));
        }

        (bool ok,) = address(escrow).call(callData);
        assertFalse(ok);
    }
}
