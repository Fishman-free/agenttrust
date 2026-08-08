// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GuaranteeEscrow} from "./GuaranteeEscrow.sol";

/// @title SchellingVoting —— 争议质押投票（Schelling 点收敛）
/// @notice 争议案：成员质押投票 {BUYER/SELLER/ABSTAIN}；窗口结束后结算。
///         多数方 ≥2/3 且有效票 ≥3 → 裁决成立：少数派质押罚没均分多数派；
///         不足法定数/未达 2/3 → 作废退款，escrow 保守默认买家胜。
///         MVP 简化：不做随机抽选陪审员（论文版补 ZK 抽选）；先到先得投票。
contract SchellingVoting is Ownable, ReentrancyGuard {
    enum Side { BUYER, SELLER, ABSTAIN }
    uint256 public constant MIN_VOTERS = 3;      // 最低有效票数
    uint256 public constant MAJORITY_BPS = 6500; // ≥2/3 多数判定（工程近似 6500/10000，避免 2/3 边界整除误差；论文版精化）

    struct Case {
        uint256 tradeId;
        uint256 buyerAgentId;
        uint256 sellerAgentId;
        uint256 stake;      // 每票质押
        uint256 deadline;   // 投票截止
        uint256 votesForBuyer;
        uint256 votesForSeller;
        bool settled;
        bool effective;     // 是否达成有效裁决（≥2/3 多数且有效票 ≥3）
        Side winner;        // 有效时：多数方；作废时：ABSTAIN
        mapping(address => bool) hasVoted; // 独立投票标记（避免 enum 初始值冲突）
        mapping(address => Side) side;     // 每人所投方
        mapping(address => bool) claimed;  // 是否已领取（奖励/退款互斥）
    }

    GuaranteeEscrow public immutable escrow;
    uint256 public nextCaseId;
    mapping(uint256 => Case) public cases;
    mapping(uint256 => bool) private tradeHasCase; // 同一交易仅一个争议案

    event CaseOpened(uint256 indexed caseId, uint256 tradeId, uint256 stake, uint256 deadline);
    event CaseVoted(uint256 indexed caseId, address voter, Side side, uint256 stake);
    event CaseSettled(uint256 indexed caseId, Side winningSide, uint256 voters, bool effective);

    constructor(address escrow_) Ownable(msg.sender) {
        escrow = GuaranteeEscrow(escrow_);
    }

    /// 发起争议案（需交易处于 DISPUTED 状态；仅 owner 可开——论文版由 escrow 自动驱动）
    function openCase(uint256 tradeId, uint256 buyerAgentId, uint256 sellerAgentId, uint256 stake, uint256 windowSeconds)
        external onlyOwner returns (uint256 caseId)
    {
        require(stake > 0, unicode"SchellingVoting: 质押必须大于零");
        require(!tradeHasCase[tradeId], unicode"SchellingVoting: 该交易已有争议案");
        (,,,,,,, GuaranteeEscrow.State st,,,,) = escrow.trades(tradeId);
        require(st == GuaranteeEscrow.State.DISPUTED, unicode"SchellingVoting: 交易不在争议中");
        tradeHasCase[tradeId] = true;

        caseId = nextCaseId++;
        Case storage c = cases[caseId];
        c.tradeId = tradeId;
        c.buyerAgentId = buyerAgentId;
        c.sellerAgentId = sellerAgentId;
        c.stake = stake;
        c.deadline = block.timestamp + windowSeconds;

        emit CaseOpened(caseId, tradeId, stake, c.deadline);
    }

    /// 投票：质押 stake 后投一方（窗口内、每地址一票）
    function vote(uint256 caseId, Side side) external payable nonReentrant {
        Case storage c = cases[caseId];
        require(block.timestamp < c.deadline, unicode"SchellingVoting: 投票已截止");
        require(!c.settled, unicode"SchellingVoting: 案件已结算");
        require(!c.hasVoted[msg.sender], unicode"SchellingVoting: 已投票");
        require(msg.value == c.stake, unicode"SchellingVoting: 质押金额不符");

        c.hasVoted[msg.sender] = true;
        c.side[msg.sender] = side;
        if (side == Side.BUYER) c.votesForBuyer++;
        else if (side == Side.SELLER) c.votesForSeller++;
        // ABSTAIN 不参与多数判定（质押在结算时凭 claimRefund 退还）

        emit CaseVoted(caseId, msg.sender, side, msg.value);
    }

    /// 结算（窗口结束后任何人可触发）
    function settle(uint256 caseId) external nonReentrant {
        Case storage c = cases[caseId];
        require(!c.settled, unicode"SchellingVoting: 已结算");
        require(block.timestamp >= c.deadline, unicode"SchellingVoting: 投票窗口未结束");

        c.settled = true;
        uint256 total = c.votesForBuyer + c.votesForSeller;
        if (total == 0) {
            // 无人投票：winner 显式置 ABSTAIN（0>=0 会使两侧多数判定恒真，需短路）
            c.winner = Side.ABSTAIN;
        } else {
            bool buyerMaj = c.votesForBuyer * 10000 >= total * MAJORITY_BPS;
            bool sellerMaj = c.votesForSeller * 10000 >= total * MAJORITY_BPS;
            c.winner = buyerMaj ? Side.BUYER : (sellerMaj ? Side.SELLER : Side.ABSTAIN);
        }
        c.effective = total >= MIN_VOTERS && (c.winner != Side.ABSTAIN);

        if (!c.effective) {
            // 作废：所有投票者凭 claimRefund 领回质押；escrow 保守默认买家胜（退款+罚没担保金）
            _applyVerdict(c, GuaranteeEscrow.Verdict.BUYER_WINS, 10000);
        } else if (c.winner == Side.BUYER) {
            _applyVerdict(c, GuaranteeEscrow.Verdict.BUYER_WINS, 10000);
        } else {
            _applyVerdict(c, GuaranteeEscrow.Verdict.SELLER_WINS, 0);
        }

        emit CaseSettled(caseId, c.winner, total, c.effective);
    }

    /// 领取奖励（有效案的多数派：拿回质押 + 均分少数派罚没）
    function claimReward(uint256 caseId) external nonReentrant {
        Case storage c = cases[caseId];
        require(c.settled, unicode"SchellingVoting: 未结算");
        require(c.hasVoted[msg.sender], unicode"SchellingVoting: 未投票");
        require(c.effective, unicode"SchellingVoting: 案件作废，请领取退款");
        require(c.side[msg.sender] == c.winner, unicode"SchellingVoting: 非多数派");
        require(!c.claimed[msg.sender], unicode"SchellingVoting: 已领取");

        uint256 winnerCount = c.winner == Side.BUYER ? c.votesForBuyer : c.votesForSeller;
        uint256 loserCount = c.winner == Side.BUYER ? c.votesForSeller : c.votesForBuyer;
        c.claimed[msg.sender] = true;
        // 多数派每票：本金 + 罚没池均分（罚没池 = 少数派票数 × stake）
        // 整除余数 dust wei 滞留合约（MVP 已知限制，论文版批量结算解决）
        uint256 reward = c.stake + (c.stake * loserCount) / winnerCount;
        _pay(msg.sender, reward);
    }

    /// 领取退款（作废案的全部投票者 / 有效案的弃权票）
    function claimRefund(uint256 caseId) external nonReentrant {
        Case storage c = cases[caseId];
        require(c.settled, unicode"SchellingVoting: 未结算");
        require(c.hasVoted[msg.sender], unicode"SchellingVoting: 未投票");
        require(!c.claimed[msg.sender], unicode"SchellingVoting: 已领取");
        require(!c.effective || c.side[msg.sender] == Side.ABSTAIN, unicode"SchellingVoting: 有效案仅弃权票可退款");

        c.claimed[msg.sender] = true;
        _pay(msg.sender, c.stake);
    }

    // ---------- 内部 ----------

    function _applyVerdict(Case storage c, GuaranteeEscrow.Verdict verdict, uint256 share) private {
        // 论文版语义：Voting 拥有 escrow（部署脚本 transferOwnership），可驱动裁决；
        // 若未授权则 revert（部署脚本已保证授权，见 Task 13）
        escrow.resolveDispute(c.tradeId, verdict, share);
        // 注意：GuaranteeEscrow.resolveDispute 已按 T5 语义记录 seller 的 WON/LOST
        //（BUYER_WINS→LOST、SELLER_WINS→WON），此处不再重复 recordOutcome，避免双计数。
        // 论文版若需 Voting 侧补充存证，应引入独立事件/字段而非再记一次信誉。
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, unicode"SchellingVoting: 转账失败");
    }
}
