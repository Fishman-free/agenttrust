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

    uint256 buyerAgentId;
    uint256 sellerAgentId;
    uint256 tradeId;

    uint256 constant AMOUNT = 1 ether;
    uint256 constant COVERAGE = 1e18; // 100%

    function setUp() public {
        registry = new AgentRegistry();
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        hub.setAuthorizedCaller(address(escrow), true);

        // makeAddr 地址初始余额为 0：买家需 ≥1 ETH 付款、担保人需 ≥1.05 ETH 质押
        vm.deal(buyer, 1 ether);
        vm.deal(guarantor, 1.05 ether);

        vm.prank(buyer);
        buyerAgentId = registry.registerAgent("BuyerAgent", unicode"买家", "x");
        vm.prank(seller);
        sellerAgentId = registry.registerAgent("SellerAgent", unicode"卖家", "x");

        vm.prank(buyer);
        tradeId = escrow.createTrade(buyerAgentId, sellerAgentId, AMOUNT);
    }

    // 公开 mapping getter 返回 12 元组，需解构后读取 state
    function stateOf(uint256 tradeId_) internal view returns (GuaranteeEscrow.State) {
        (,,,,,,, GuaranteeEscrow.State st,,,,) = escrow.trades(tradeId_);
        return st;
    }

    function test_fullHappyPath() public {
        // 买家付款
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.FUNDED));

        // 担保人质押（100% 覆盖率 + 5% 保费）
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);
        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.GUARANTEED));

        // 卖家交付声明
        vm.prank(seller);
        escrow.deliver(tradeId);
        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.DELIVERED));

        // 买家确认 → 释放：卖家得 AMOUNT，担保人拿回本金+保费
        uint256 sellerBefore = seller.balance;
        uint256 guarantorBefore = guarantor.balance;
        vm.prank(buyer);
        escrow.confirm(tradeId);

        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.RELEASED));
        assertEq(seller.balance - sellerBefore, AMOUNT, unicode"卖家应收到交易金额");
        assertEq(guarantor.balance - guarantorBefore, 1.05 ether, unicode"担保人应拿回本金+保费");
    }

    function test_buyerDispute_guarantorPenalty() public {
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);
        vm.prank(seller);
        escrow.deliver(tradeId);

        // 买家发起争议
        vm.prank(buyer);
        escrow.dispute(tradeId);
        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.DISPUTED));

        // 平台仲裁：买家胜诉 → 全额退款 + 担保金罚没补偿买家
        uint256 buyerBefore = buyer.balance;
        vm.prank(escrow.owner());
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.BUYER_WINS, 10000);

        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.RESOLVED));
        assertEq(buyer.balance - buyerBefore, AMOUNT + AMOUNT, unicode"买家拿回本金+全额罚没担保金");
        // 信誉记录：卖家争议败诉（第四位 disputesLost）
        (,,, uint256 lost) = hub.reputation(sellerAgentId);
        assertEq(lost, 1);
    }

    function test_sellerTimeout_autoRelease() public {
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);
        vm.prank(seller);
        escrow.deliver(tradeId);

        // 买家超时未确认 → 自动释放给卖家
        vm.warp(block.timestamp + escrow.CONFIRM_WINDOW() + 1);
        vm.prank(stranger); // 任何人可触发超时
        escrow.timeoutAutoRelease(tradeId);

        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.RELEASED));
        assertEq(seller.balance, AMOUNT);
    }

    function test_fundDeadline_refund() public {
        // 买家付款后不担保，fund 截止时间到 → 退款
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);

        vm.warp(block.timestamp + escrow.FUND_WINDOW() + 1);
        uint256 buyerBefore = buyer.balance;
        vm.prank(stranger);
        escrow.timeoutRefund(tradeId);

        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.RESOLVED));
        assertEq(buyer.balance - buyerBefore, AMOUNT, unicode"买家应收回付款");
    }

    function test_sellerDefault_timeoutRefund() public {
        // 卖家 GUARANTEED 后不交付，交付超时 → 退款 + 担保金罚没 + 违约记录
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);

        vm.warp(block.timestamp + escrow.DELIVER_WINDOW() + 1);
        vm.prank(stranger);
        escrow.timeoutRefund(tradeId);

        assertEq(buyer.balance, AMOUNT + AMOUNT, unicode"退款+罚没担保金");
        (, uint256 defaulted,,) = hub.reputation(sellerAgentId);
        assertEq(defaulted, 1);
    }

    function test_permissions() public {
        // 非卖家 owner 不能交付
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);

        vm.prank(stranger);
        vm.expectRevert(unicode"GuaranteeEscrow: 仅卖家负责人可交付");
        escrow.deliver(tradeId);
    }

    function test_guarantee_requiresEnoughStake() public {
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);

        vm.prank(guarantor);
        vm.expectRevert(unicode"GuaranteeEscrow: 担保质押金额不符");
        escrow.guarantee{value: 0.5 ether}(tradeId, COVERAGE, 0.05 ether);
    }

    function test_partialVerdict() public {
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute(tradeId);

        // 部分胜诉：买家拿 70%
        uint256 buyerBefore = buyer.balance;
        uint256 sellerBefore = seller.balance;
        vm.prank(escrow.owner());
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.PARTIAL_BUYER, 7000);

        assertEq(buyer.balance - buyerBefore, (AMOUNT * 70) / 100 + AMOUNT, unicode"70% 退款 + 全额罚没");
        assertEq(seller.balance - sellerBefore, (AMOUNT * 30) / 100, unicode"卖家得 30%");
    }
}
