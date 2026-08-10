// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";

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

    function test_nonexistentTradeCannotBeOperated() public {
        vm.expectRevert(unicode"GuaranteeEscrow: 交易不存在");
        escrow.tradeState(999);
    }
}
