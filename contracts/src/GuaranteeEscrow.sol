// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {ReputationHub} from "./ReputationHub.sol";

/// @title GuaranteeEscrow —— 担保托管交易
/// @notice 交易状态机 + 担保人质押 + 违约罚没 + 超时默认动作。
///         权限模型：buyer/seller 动作仅其责任主体（agent owner）可执行。
///         MVP 仲裁：仅 owner（平台）可调用 resolveDispute；论文版由 SchellingVoting 驱动。
contract GuaranteeEscrow is Ownable, ReentrancyGuard {
    enum State { CREATED, FUNDED, GUARANTEED, DELIVERED, DISPUTED, RELEASED, RESOLVED }
    enum Verdict { BUYER_WINS, SELLER_WINS, PARTIAL_BUYER }

    struct Trade {
        uint256 id;
        uint256 buyerAgentId;
        uint256 sellerAgentId;
        uint256 amount;      // 交易金额（wei）
        address guarantor;   // 担保人（0 地址=无担保）
        uint256 coverage;    // 覆盖率（1e18 = 100%）
        uint256 premium;     // 保费（担保人报价）
        State state;
        uint256 createdAt;
        uint256 fundedAt;
        uint256 guaranteedAt;
        uint256 deliveredAt;
    }

    uint256 public constant FUND_WINDOW = 1 days;      // 付款截止
    uint256 public constant GUARANTEE_WINDOW = 1 days; // 担保截止（FUNDED 起）
    uint256 public constant DELIVER_WINDOW = 1 days;   // 交付截止（GUARANTEED 起）
    uint256 public constant CONFIRM_WINDOW = 1 days;   // 确认截止（DELIVERED 起）

    AgentRegistry public immutable registry;
    ReputationHub public immutable hub;
    uint256 public nextTradeId;
    mapping(uint256 => Trade) public trades;

    event TradeCreated(uint256 indexed tradeId, uint256 buyerAgentId, uint256 sellerAgentId, uint256 amount);
    event TradeFunded(uint256 indexed tradeId, address funder);
    event TradeGuaranteed(uint256 indexed tradeId, address guarantor, uint256 coverage, uint256 premium);
    event TradeDelivered(uint256 indexed tradeId);
    event TradeConfirmed(uint256 indexed tradeId);
    event TradeDisputed(uint256 indexed tradeId);
    event TradeResolved(uint256 indexed tradeId, Verdict verdict, uint256 buyerShareBps);

    constructor(address registry_, address hub_) Ownable(msg.sender) {
        registry = AgentRegistry(registry_);
        hub = ReputationHub(hub_);
    }

    /// 创建交易（买方发起）
    function createTrade(uint256 buyerAgentId, uint256 sellerAgentId, uint256 amount)
        external returns (uint256 tradeId)
    {
        require(amount > 0, unicode"GuaranteeEscrow: 金额必须大于零");
        tradeId = nextTradeId++;
        trades[tradeId] = Trade(tradeId, buyerAgentId, sellerAgentId, amount, address(0), 0, 0, State.CREATED, block.timestamp, 0, 0, 0);
        emit TradeCreated(tradeId, buyerAgentId, sellerAgentId, amount);
    }

    /// 买家付款进 escrow
    function fund(uint256 tradeId) external payable nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.CREATED, unicode"GuaranteeEscrow: 状态错误");
        require(msg.value == t.amount, unicode"GuaranteeEscrow: 付款金额与交易金额不符");
        require(block.timestamp <= t.createdAt + FUND_WINDOW, unicode"GuaranteeEscrow: 付款超时");
        t.state = State.FUNDED;
        t.fundedAt = block.timestamp;
        emit TradeFunded(tradeId, msg.sender);
    }

    /// 担保人质押：覆盖率×金额 + 报价保费（金额必须精确匹配）
    function guarantee(uint256 tradeId, uint256 coverage, uint256 premium) external payable nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.FUNDED, unicode"GuaranteeEscrow: 状态错误");
        require(coverage > 0 && coverage <= 2e18, unicode"GuaranteeEscrow: 覆盖率需在 0-200%");
        require(block.timestamp <= t.fundedAt + GUARANTEE_WINDOW, unicode"GuaranteeEscrow: 担保超时");
        uint256 requiredStake = (t.amount * coverage) / 1e18;
        require(msg.value == requiredStake + premium, unicode"GuaranteeEscrow: 担保质押金额不符");

        t.guarantor = msg.sender;
        t.coverage = coverage;
        t.premium = premium;
        t.state = State.GUARANTEED;
        t.guaranteedAt = block.timestamp;
        emit TradeGuaranteed(tradeId, msg.sender, coverage, premium);
    }

    /// 卖家交付声明（仅卖家负责人）
    function deliver(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.GUARANTEED, unicode"GuaranteeEscrow: 状态错误");
        require(registry.ownerOf(t.sellerAgentId) == msg.sender, unicode"GuaranteeEscrow: 仅卖家负责人可交付");
        require(block.timestamp <= t.guaranteedAt + DELIVER_WINDOW, unicode"GuaranteeEscrow: 交付超时");
        t.state = State.DELIVERED;
        t.deliveredAt = block.timestamp;
        emit TradeDelivered(tradeId);
    }

    /// 买家确认收货（仅买家负责人）→ 释放：卖家收款，担保人拿回本金+保费
    function confirm(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.DELIVERED, unicode"GuaranteeEscrow: 状态错误");
        require(registry.ownerOf(t.buyerAgentId) == msg.sender, unicode"GuaranteeEscrow: 仅买家负责人可确认");
        require(block.timestamp <= t.deliveredAt + CONFIRM_WINDOW, unicode"GuaranteeEscrow: 确认超时，请走超时释放");

        _release(t);
        hub.recordOutcome(t.sellerAgentId, ReputationHub.Outcome.COMPLETED);
        emit TradeConfirmed(tradeId);
    }

    /// 买家/卖家发起争议（双方负责人均可）
    function dispute(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.DELIVERED, unicode"GuaranteeEscrow: 仅交付后可争议");
        address buyerOwner = registry.ownerOf(t.buyerAgentId);
        address sellerOwner = registry.ownerOf(t.sellerAgentId);
        require(msg.sender == buyerOwner || msg.sender == sellerOwner, unicode"GuaranteeEscrow: 仅交易双方负责人可发起争议");
        t.state = State.DISPUTED;
        emit TradeDisputed(tradeId);
    }

    /// 仲裁裁决（MVP：仅平台 owner；论文版由 SchellingVoting 调用）
    /// buyerShareBps: 部分胜诉时买家所得比例（0-10000）；全额胜诉时忽略
    function resolveDispute(uint256 tradeId, Verdict verdict, uint256 buyerShareBps) external onlyOwner nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.DISPUTED, unicode"GuaranteeEscrow: 仅争议中可裁决");

        if (verdict == Verdict.BUYER_WINS) {
            _resolveBuyerWins(t, 10000);
            hub.recordOutcome(t.sellerAgentId, ReputationHub.Outcome.LOST); // 从卖家视角：败诉
        } else if (verdict == Verdict.PARTIAL_BUYER) {
            require(buyerShareBps <= 10000, unicode"GuaranteeEscrow: 比例非法");
            _resolveBuyerWins(t, buyerShareBps);
            hub.recordOutcome(t.sellerAgentId, ReputationHub.Outcome.LOST);
        } else {
            // 卖家胜诉：全额放给卖家，担保人拿回本金+保费
            uint256 stake = (t.amount * t.coverage) / 1e18;
            _pay(t.guarantor, stake + t.premium);
            _pay(registry.ownerOf(t.sellerAgentId), t.amount);
            t.state = State.RESOLVED;
            hub.recordOutcome(t.sellerAgentId, ReputationHub.Outcome.WON); // 从卖家视角：胜诉
        }
        emit TradeResolved(tradeId, verdict, buyerShareBps);
    }

    /// 交付后买家超时未确认 → 自动释放（任何人可触发）
    function timeoutAutoRelease(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.DELIVERED, unicode"GuaranteeEscrow: 状态错误");
        require(block.timestamp > t.deliveredAt + CONFIRM_WINDOW, unicode"GuaranteeEscrow: 未到超时时间");
        _release(t);
        hub.recordOutcome(t.sellerAgentId, ReputationHub.Outcome.COMPLETED);
    }

    /// 退款路径（任一超时/卖家未交付/担保未达成）→ 买家收回金额，违约时罚没担保金
    function timeoutRefund(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.FUNDED || t.state == State.GUARANTEED, unicode"GuaranteeEscrow: 状态错误");

        if (t.state == State.FUNDED) {
            require(block.timestamp > t.fundedAt + GUARANTEE_WINDOW, unicode"GuaranteeEscrow: 未到担保截止");
            _pay(registry.ownerOf(t.buyerAgentId), t.amount);
            t.state = State.RESOLVED;
        } else {
            require(block.timestamp > t.guaranteedAt + DELIVER_WINDOW, unicode"GuaranteeEscrow: 未到交付截止");
            _resolveBuyerWins(t, 10000); // 卖家违约：退款+罚没
            hub.recordOutcome(t.sellerAgentId, ReputationHub.Outcome.DEFAULTED);
        }
    }

    // ---------- 内部 ----------

    /// 买家胜诉结算：买家拿回本金 + 担保金罚没补偿；担保人失去质押、拿回保费
    function _resolveBuyerWins(Trade storage t, uint256 buyerShareBps) private {
        uint256 stake = (t.amount * t.coverage) / 1e18;
        uint256 buyerRefund = (t.amount * buyerShareBps) / 10000;
        uint256 sellerShare = t.amount - buyerRefund;
        _pay(registry.ownerOf(t.buyerAgentId), buyerRefund + stake);
        if (sellerShare > 0) _pay(registry.ownerOf(t.sellerAgentId), sellerShare);
        _pay(t.guarantor, t.premium); // 担保人只拿回保费（服务费），本金罚没
        t.state = State.RESOLVED;
    }

    /// 正常释放：卖家收款 + 担保人拿回本金和保费
    function _release(Trade storage t) private {
        uint256 stake = (t.amount * t.coverage) / 1e18;
        _pay(registry.ownerOf(t.sellerAgentId), t.amount);
        _pay(t.guarantor, stake + t.premium);
        t.state = State.RELEASED;
        emit TradeResolved(t.id, Verdict.BUYER_WINS, 0); // verdict 仅作事件标记
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, unicode"GuaranteeEscrow: 转账失败");
    }
}
