// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

/// @title E2E —— 全链路业务故事（= M3 演示脚本的自动化基线）
/// @notice 资金流核对表（绝对余额，assert 与其严格一致）：
///   alice(卖家)   0 起手 → 买家胜 +0 → 正常交易 +0.95(1-0.05 保费)           = 0.95
///   bob(买家)     3 起手 → -2(t1 付款) +4(t1 拿回本金2+罚没2) → 5 → -1(t2)    = 4
///   guarantor     3.05 起手 → -2(t1 质押,罚没) → 1.05 → -1(t2 质押) +1.05     = 1.10
///   j1/j2(多数派) 0.1 起手 → -0.05(投票质押) +0.075(奖励)                     = 0.125
///   j3(少数派)    0.1 起手 → -0.05(投票质押,罚没)                             = 0.05
///   escrow        进 2+2+1+1 = 6；出 4+0.95+1.05 = 6 → 归零
///   voting        进 3×0.05 = 0.15；出 2×0.075 = 0.15 → 归零
contract E2ETest is Test {
    AgentRegistry registry;
    ReputationHub hub;
    GuaranteeEscrow escrow;
    SchellingVoting voting;

    address alice = makeAddr("alice");   // 数据服务商（卖方）
    address bob = makeAddr("bob");       // 买方开发者
    address guarantor = makeAddr("guarantor");
    address j1 = makeAddr("j1");
    address j2 = makeAddr("j2");
    address j3 = makeAddr("j3");

    /// 公共 trades 映射 getter 返回元组，无法直接 .state 成员访问，解构取状态
    function stateOf(uint256 tradeId_) internal view returns (GuaranteeEscrow.State) {
        (,,,,,,, GuaranteeEscrow.State st,,,,) = escrow.trades(tradeId_);
        return st;
    }

    function setUp() public {
        registry = new AgentRegistry();
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        voting = new SchellingVoting(address(escrow)); // 仅 escrow
        hub.setAuthorizedCaller(address(escrow), true);
        escrow.transferOwnership(address(voting));

        // 资金：买家/卖家/担保人按支出拨付，陪审员按质押拨付。
        // alice 注册免费（registrationFee 默认 0），无需拨付 → 0 起手，step8 断言 0 成立。
        vm.deal(alice, 0);
        vm.deal(bob, 3 ether);   // 买家：1 笔争议交易付款 2 + 1 笔正常交易付款 1
        vm.deal(guarantor, 3.05 ether); // 担保人：两次质押 2+1
        vm.deal(j1, 0.1 ether);
        vm.deal(j2, 0.1 ether);
        vm.deal(j3, 0.1 ether);
    }

    function test_fullStory_dispute_communityVerdict() public {
        // 1. 注册：两个智能体（责任主体 = 注册开发者）
        vm.prank(alice);
        uint256 sellerId = registry.registerAgent("DataAgent", unicode"链上数据分析服务", "https://a.example/mcp");
        vm.prank(bob);
        uint256 buyerId = registry.registerAgent("TraderAgent", unicode"交易策略智能体", "https://b.example/mcp");

        // 2. 创建担保交易：bob 的智能体购买 alice 的智能体服务
        vm.prank(bob);
        uint256 tradeId = escrow.createTrade(buyerId, sellerId, 2 ether);

        // 3. 付款 + 担保（担保人质押 100% + 5% 保费）
        vm.prank(bob);
        escrow.fund{value: 2 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 2 ether}(tradeId, 1e18, 0.1 ether);

        // 4. 卖方交付声明
        vm.prank(alice);
        escrow.deliver(tradeId);

        // 5. 买方发起争议（声称服务与描述不符）
        vm.prank(bob);
        escrow.dispute(tradeId);

        // 6. 社区投票：Schelling 收敛 —— 3 票支持买家（事实：服务确实不符）
        // openCase 为 Voting 的 onlyOwner（部署者 = Test 合约），无需 prank
        uint256 caseId = voting.openCase(tradeId, buyerId, sellerId, 0.05 ether, 1 days);
        vm.prank(j1);
        voting.vote{value: 0.05 ether}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(j2);
        voting.vote{value: 0.05 ether}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(j3);
        voting.vote{value: 0.05 ether}(caseId, SchellingVoting.Side.SELLER);

        // 7. 结算：买家胜
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(j1);
        voting.settle(caseId);

        // 8. 结果断言：买家拿回 2 ETH + 2 ETH 罚没担保金；卖家 0；担保人 0（质押全失）
        assertEq(uint8(stateOf(tradeId)), uint8(GuaranteeEscrow.State.RESOLVED));
        assertEq(bob.balance, 5 ether, unicode"买家：3 起手 -2(付) +4(拿回本金2+罚没2) = 5");
        assertEq(alice.balance, 0, unicode"卖家分文未得（注册免费，0 起手）");
        assertEq(guarantor.balance, 1.05 ether, unicode"担保人：3.05 -2(质押,罚没) = 1.05");

        // 9. 信誉更新：卖家无超时违约（走争议路径），争议败诉 1 次 → 信誉分下降
        (, uint256 defaulted, uint256 won, uint256 lost) = hub.reputation(sellerId);
        assertEq(defaulted, 0);
        assertEq(lost, 1, unicode"卖家争议败诉应 +1");
        assertEq(won, 0);
        uint256 score = hub.reputationScore(sellerId);
        // ReputationHub 公式：score = 100 - 100*defaulted/total - 50*lost/total；
        // 仅 1 次败诉 → total=1 → 100 - 0 - 50 = 50（等于新智能体默认值，不会低于 50）
        assertEq(score, 50, unicode"1 次败诉且无其他记录：100 - 50*1/1 = 50");

        // 10. 正常交易仍记录完成（对照组：另一笔无争议交易）
        vm.prank(bob);
        uint256 trade2 = escrow.createTrade(buyerId, sellerId, 1 ether);
        vm.prank(bob);
        escrow.fund{value: 1 ether}(trade2);
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(trade2, 1e18, 0.05 ether);
        vm.prank(alice);
        escrow.deliver(trade2);
        vm.prank(bob);
        escrow.confirm(trade2);

        (uint256 completed2,,,) = hub.reputation(sellerId);
        assertEq(completed2, 1, unicode"正常交易应累计完成数");

        // 11. 终态余额核对（逐笔重算，与 vm.deal 起手严格一致）
        // 担保人：3.05 -2(争议质押罚没) -1(正常质押) +1.05(正常案本金1+保费0.05) = 1.10
        assertEq(guarantor.balance, 1.10 ether, unicode"担保人终态：1.05(第8步) -1 +1.05 = 1.10");
        // 买家：5(第8步) -1(第10步付款) = 4；confirm 不回款（钱从 escrow 池出）
        assertEq(bob.balance, 4 ether, unicode"买家终态：5 -1 = 4");
        // 卖家：正常交易得 amount - premium = 1 - 0.05 = 0.95
        assertEq(alice.balance, 0.95 ether, unicode"卖家终态：正常案得 1-0.05 = 0.95");
        // 陪审员奖励：j1/j2（多数派）各拿回质押 0.05 + 罚没均分 0.025 = 0.075
        vm.prank(j1);
        voting.claimReward(caseId);
        vm.prank(j2);
        voting.claimReward(caseId);
        assertEq(j1.balance, 0.125 ether, unicode"j1：0.1 -0.05(质押) +0.075(奖励) = 0.125");
        assertEq(j2.balance, 0.125 ether, unicode"j2：同上");
        assertEq(j3.balance, 0.05 ether, unicode"j3：0.1 -0.05(质押,少数派罚没) = 0.05");
        // 资金守恒：两个托管合约归零
        assertEq(address(escrow).balance, 0, unicode"escrow：进 6 出 6");
        assertEq(address(voting).balance, 0, unicode"voting：进 0.15 出 0.15");
    }
}
