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
        hub.setAuthorizedCaller(address(escrow), true);
        vm.deal(buyer, 10 ether);
        vm.deal(guarantor, 10 ether);
        vm.prank(buyer);
        buyerId = registry.registerAgent("Buyer", "", "");
        vm.prank(seller);
        sellerId = registry.registerAgent("Seller", "", "");
        vm.prank(guarantor);
        guarantorId = registry.registerAgent("Guarantor", "", "");
        vm.prank(buyer);
        tradeId = escrow.createTrade(buyerId, sellerId, 1 ether);
    }

    function _acceptFundGuarantee() internal {
        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.05 ether);
        vm.prank(seller);
        escrow.acceptGuarantee(tradeId);
    }

    function _createAcceptedFunded(uint256 amount) internal returns (uint256 id) {
        vm.prank(buyer);
        id = escrow.createTrade(buyerId, sellerId, amount);
        vm.prank(seller);
        escrow.acceptTrade(id);
        vm.deal(buyer, amount);
        vm.prank(buyer);
        escrow.fund{value: amount}(id);
    }

    function test_zeroAmountRejected() public {
        vm.prank(buyer);
        vm.expectRevert(unicode"GuaranteeEscrow: 金额必须大于零");
        escrow.createTrade(buyerId, sellerId, 0);
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
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0);
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
        escrow.createTrade(buyerId, secondBuyerId, 1 ether);

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

        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 覆盖率低于信誉要求");
        escrow.guarantee{value: 0.75 ether}(tradeId, guarantorId, 0.75e18, 0);
        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 保费过高");
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.21 ether);
        vm.prank(guarantor);
        escrow.guarantee{value: 2 ether}(tradeId, guarantorId, 2e18, 0.2 ether);
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.GUARANTEE_OFFERED));

        vm.prank(buyer);
        uint256 tiny = escrow.createTrade(buyerId, sellerId, 1);
        vm.prank(seller);
        escrow.acceptTrade(tiny);
        vm.prank(buyer);
        escrow.fund{value: 1}(tiny);
        vm.prank(guarantor);
        escrow.guarantee{value: 1}(tiny, guarantorId, 1e18, 0);
        assertEq(escrow.requiredStake(tiny, 1e18), 1, "stake rounds up and never becomes zero");
    }

    function testFuzz_amountCoveragePremiumBoundariesAndCeilRounding(
        uint96 rawAmount,
        uint64 rawCoverage,
        uint96 rawPremium
    ) public {
        uint256 amount = bound(uint256(rawAmount), 1, 100 ether);
        uint256 coverage = bound(uint256(rawCoverage), 1e18, escrow.MAX_COVERAGE());
        uint256 maximumPremium = (amount * escrow.MAX_PREMIUM_BPS()) / 10000;
        uint256 premium = bound(uint256(rawPremium), 0, maximumPremium);
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
        uint256 maxPremiumBps = escrow.MAX_PREMIUM_BPS();
        uint256 id = _createAcceptedFunded(amount);
        uint256 belowMinimum = bound(uint256(rawCoverage), 0, 1e18 - 1);

        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 覆盖率低于信誉要求");
        escrow.guarantee(id, guarantorId, belowMinimum, 0);

        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 覆盖率非法");
        escrow.guarantee(id, guarantorId, maxCoverage + 1, 0);

        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 保费过高");
        escrow.guarantee(id, guarantorId, 1e18, (amount * maxPremiumBps) / 10000 + 1);

        vm.deal(guarantor, amount - 1);
        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 担保质押金额不符");
        escrow.guarantee{value: amount - 1}(id, guarantorId, 1e18, 0);
    }

    function test_unacceptedGuaranteeOfferCannotCreateSellerDefault() public {
        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.05 ether);
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
        escrow.guarantee{value: 1 ether}(guaranteed, guarantorId, 1e18, 0);
        vm.prank(seller);
        escrow.acceptGuarantee(guaranteed);

        uint256 delivered = _createAcceptedFunded(1 ether);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(delivered, guarantorId, 1e18, 0);
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
        assertEq(escrow.pendingWithdrawals(seller), 1 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1 ether);
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

        assertEq(escrow.pendingWithdrawals(seller), 0.95 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1.05 ether);
        (uint256 completed,,,) = hub.reputation(sellerId);
        assertEq(completed, 1);
        vm.expectRevert(unicode"GuaranteeEscrow: 状态错误");
        vm.prank(buyer);
        escrow.confirm(tradeId);
    }

    function test_disputeWithoutCaseCanBeSafelyVoided() public {
        _acceptFundGuarantee();
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute(tradeId);
        vm.warp(block.timestamp + escrow.CASE_OPEN_WINDOW() + 1);
        escrow.timeoutVoidDispute(tradeId);

        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.VOIDED));
        assertEq(escrow.pendingWithdrawals(buyer), 1 ether);
        assertEq(escrow.pendingWithdrawals(guarantor), 1 ether);
        assertEq(hub.reputationScore(sellerId), 50);
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
        assertEq(escrow.pendingWithdrawals(seller), 0.95 ether);

        uint256 beforeBalance = seller.balance;
        vm.prank(seller);
        escrow.withdraw(payable(seller));
        assertEq(seller.balance - beforeBalance, 0.95 ether);
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
