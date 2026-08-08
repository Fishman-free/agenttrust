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
    address juror1 = makeAddr("juror1");
    address juror2 = makeAddr("juror2");
    address juror3 = makeAddr("juror3");
    address juror4 = makeAddr("juror4");
    address juror5 = makeAddr("juror5");

    uint256 buyerAgentId;
    uint256 sellerAgentId;
    uint256 tradeId;
    uint256 caseId;

    uint256 constant AMOUNT = 1 ether;
    uint256 constant STAKE = 0.1 ether;
    uint256 constant WINDOW = 1 days;

    function _setUpTradeAndDispute() internal {
        registry = new AgentRegistry();
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        voting = new SchellingVoting(address(escrow));
        hub.setAuthorizedCaller(address(escrow), true);
        escrow.transferOwnership(address(voting)); // 论文版：Voting 代平台行使裁决权

        // makeAddr 初始余额为 0：deal 金额恰好覆盖支出，使绝对余额断言 = 净额
        // （买家付款 1 → 拿回 2；担保人质押 1 → 拿回 1.05；陪审员质押 0.1 → 奖/退 0.1~0.15）
        vm.deal(buyer, AMOUNT);
        vm.deal(guarantor, AMOUNT);
        vm.deal(juror1, STAKE);
        vm.deal(juror2, STAKE);
        vm.deal(juror3, STAKE);
        vm.deal(juror4, STAKE);
        vm.deal(juror5, STAKE);

        vm.prank(buyer);
        buyerAgentId = registry.registerAgent("BuyerAgent", unicode"买家", "x");
        vm.prank(seller);
        sellerAgentId = registry.registerAgent("SellerAgent", unicode"卖家", "x");

        vm.prank(buyer);
        tradeId = escrow.createTrade(buyerAgentId, sellerAgentId, AMOUNT);
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT}(tradeId, 1e18, 0.05 ether);
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute(tradeId);

        // openCase 是 Voting 的 onlyOwner：部署者即 Test 合约（this），无需 prank
        caseId = voting.openCase(tradeId, buyerAgentId, sellerAgentId, STAKE, WINDOW);
    }

    // 公开 mapping getter 返回 12 元组，需解构后读取 state
    function stateOf(uint256 tradeId_) internal view returns (GuaranteeEscrow.State) {
        (,,,,,,, GuaranteeEscrow.State st,,,,) = escrow.trades(tradeId_);
        return st;
    }

    function setUp() public {
        _setUpTradeAndDispute();
    }

    function test_openCase() public view {
        assertEq(voting.nextCaseId(), 1);
        // Case 含 3 个 mapping：公开 getter 返回非 mapping 成员 10 元组，需解构
        (uint256 tradeId_, , , uint256 stake_, , , , bool settled_, , ) = voting.cases(caseId);
        assertEq(tradeId_, tradeId);
        assertEq(stake_, STAKE);
        assertEq(settled_, false);
    }

    function test_vote_majority2of3_buyerWins() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        // 买家胜：退款+罚没担保金（由 escrow 执行）
        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.RESOLVED));
        assertEq(buyer.balance, AMOUNT + AMOUNT, unicode"买家拿回本金+罚没担保金");
        // 多数派领取：拿回质押 + 均分少数派罚没（1 票罚没 / 2 票均分）
        vm.prank(juror1);
        voting.claimReward(caseId);
        vm.prank(juror2);
        voting.claimReward(caseId);
        assertEq(juror1.balance, STAKE + STAKE / 2, unicode"juror1 拿回质押+罚没奖金");
        assertEq(juror2.balance, STAKE + STAKE / 2);
        assertEq(juror3.balance, 0, unicode"juror3 少数派质押被罚没，不可领取");
        // 信誉记录：卖方争议败诉 +1（第四位 disputesLost）
        (,,, uint256 lost) = hub.reputation(sellerAgentId);
        assertEq(lost, 1);
    }

    function test_vote_insufficientQuorum_refundAll() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        // 有效票 2 < 3 → 作废：质押全部退还（claimRefund），escrow 保守默认买家胜
        vm.prank(juror1);
        voting.claimRefund(caseId);
        vm.prank(juror2);
        voting.claimRefund(caseId);
        assertEq(juror1.balance, STAKE);
        assertEq(juror2.balance, STAKE);
        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.RESOLVED));
        assertEq(buyer.balance, AMOUNT + AMOUNT);
    }

    function test_vote_majorityBelow2of3_refundAndDefault() public {
        // 4 票：2 BUYER / 2 SELLER → 未达 2/3，作废退款，escrow 默认买家胜
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);
        vm.prank(juror4);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        vm.prank(juror1);
        voting.claimRefund(caseId);
        vm.prank(juror3);
        voting.claimRefund(caseId);
        assertEq(juror1.balance, STAKE);
        assertEq(juror3.balance, STAKE);
        assertEq(buyer.balance, AMOUNT + AMOUNT);
    }

    function test_vote_sellerWins() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.RESOLVED));
        assertEq(seller.balance, AMOUNT - 0.05 ether, unicode"卖家得全额扣保费");
        assertEq(guarantor.balance, 1.05 ether, unicode"担保人拿回本金+保费");
        vm.prank(juror1);
        voting.claimReward(caseId);
        vm.prank(juror2);
        voting.claimReward(caseId);
        assertEq(juror1.balance, STAKE + STAKE / 2, unicode"多数派拿回质押+奖金");
        assertEq(juror3.balance, 0, unicode"少数派被罚没，不可领取");
        (,, uint256 won,) = hub.reputation(sellerAgentId); // 第三位 disputesWon
        assertEq(won, 1);
    }

    function test_vote_permissions() public {
        // 本测试无余额断言：补足余额使各 require 语义可触发（否则 OutOfFunds 先于 require）
        vm.deal(juror1, 1 ether);
        vm.deal(juror2, 1 ether);
        vm.deal(juror3, 1 ether);

        // 一地址只能投一票
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror1);
        vm.expectRevert(unicode"SchellingVoting: 已投票");
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);

        // 质押金额不符
        vm.prank(juror2);
        vm.expectRevert(unicode"SchellingVoting: 质押金额不符");
        voting.vote{value: STAKE - 1}(caseId, SchellingVoting.Side.BUYER);

        // 窗口结束后不能投票
        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror3);
        vm.expectRevert(unicode"SchellingVoting: 投票已截止");
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);
    }

    function test_settle_onlyAfterDeadline() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);

        vm.prank(juror1);
        vm.expectRevert(unicode"SchellingVoting: 投票窗口未结束");
        voting.settle(caseId);
    }

    function test_openCase_duplicateRejected() public {
        // 同一交易只能开一个争议案（否则第二案 settle 时 escrow 已 RESOLVED，质押永久锁死）
        vm.expectRevert(unicode"SchellingVoting: 该交易已有争议案");
        voting.openCase(tradeId, buyerAgentId, sellerAgentId, STAKE, WINDOW);
    }

    function test_claimReward_doubleClaimRejected() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        vm.prank(juror1);
        voting.claimReward(caseId);
        vm.prank(juror1);
        vm.expectRevert(unicode"SchellingVoting: 已领取");
        voting.claimReward(caseId);
    }

    function test_claim_unauthorizedRejected() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        // 未投票者（juror5）无论领奖还是退款均被拒
        vm.prank(juror5);
        vm.expectRevert(unicode"SchellingVoting: 未投票");
        voting.claimReward(caseId);
        vm.prank(juror5);
        vm.expectRevert(unicode"SchellingVoting: 未投票");
        voting.claimRefund(caseId);
    }

    function test_settle_doubleSettleRejected() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        vm.prank(juror1);
        vm.expectRevert(unicode"SchellingVoting: 已结算");
        voting.settle(caseId);
    }
}
