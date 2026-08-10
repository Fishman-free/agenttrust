// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {ReputationHub} from "./ReputationHub.sol";

contract GuaranteeEscrow is Ownable, ReentrancyGuard {
    enum State {
        CREATED,
        ACCEPTED,
        FUNDED,
        GUARANTEE_OFFERED,
        GUARANTEED,
        DELIVERED,
        DISPUTED,
        RELEASED,
        RESOLVED,
        VOIDED
    }
    enum Verdict {
        BUYER_WINS,
        SELLER_WINS,
        PARTIAL_BUYER
    }

    struct Trade {
        bool exists;
        uint256 id;
        uint256 buyerAgentId;
        uint256 sellerAgentId;
        uint256 guarantorAgentId;
        uint256 amount;
        address buyerSubject;
        address sellerSubject;
        address guarantorSubject;
        uint256 coverage;
        uint256 stake;
        uint256 premium;
        State state;
        uint256 createdAt;
        uint256 acceptedAt;
        uint256 fundedAt;
        uint256 guaranteeOfferedAt;
        uint256 guaranteedAt;
        uint256 deliveredAt;
        uint256 disputedAt;
        bool caseOpened;
    }

    uint256 public constant ACCEPT_WINDOW = 1 days;
    uint256 public constant FUND_WINDOW = 1 days;
    uint256 public constant GUARANTEE_WINDOW = 1 days;
    uint256 public constant GUARANTEE_ACCEPT_WINDOW = 1 days;
    uint256 public constant DELIVER_WINDOW = 1 days;
    uint256 public constant CONFIRM_WINDOW = 1 days;
    uint256 public constant CASE_OPEN_WINDOW = 1 days;
    uint256 public constant MAX_COVERAGE = 2e18;
    uint256 public constant MAX_PREMIUM_BPS = 2000;

    AgentRegistry public immutable registry;
    ReputationHub public immutable hub;
    uint256 public nextTradeId;
    uint256 public totalLiability;
    mapping(uint256 => Trade) private _trades;
    mapping(address => uint256) public pendingWithdrawals;

    event TradeCreated(uint256 indexed tradeId, uint256 buyerAgentId, uint256 sellerAgentId, uint256 amount);
    event TradeAccepted(uint256 indexed tradeId, address indexed sellerSubject);
    event TradeFunded(uint256 indexed tradeId, address funder);
    event GuaranteeOffered(
        uint256 indexed tradeId, uint256 guarantorAgentId, address guarantor, uint256 coverage, uint256 premium
    );
    event GuaranteeAccepted(uint256 indexed tradeId, address indexed sellerSubject);
    event TradeDelivered(uint256 indexed tradeId);
    event TradeDisputed(uint256 indexed tradeId);
    event ArbitrationOpened(uint256 indexed tradeId);
    event TradeResolved(uint256 indexed tradeId, Verdict verdict, uint256 buyerShareBps);
    event TradeVoided(uint256 indexed tradeId);
    event WithdrawalCredited(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, address indexed recipient, uint256 amount);

    constructor(address registry_, address hub_) Ownable(msg.sender) {
        require(registry_ != address(0) && hub_ != address(0), unicode"GuaranteeEscrow: 依赖地址为零");
        registry = AgentRegistry(registry_);
        hub = ReputationHub(hub_);
    }

    modifier existingTrade(uint256 tradeId) {
        require(_trades[tradeId].exists, unicode"GuaranteeEscrow: 交易不存在");
        _;
    }

    function createTrade(uint256 buyerAgentId, uint256 sellerAgentId, uint256 amount)
        external
        returns (uint256 tradeId)
    {
        require(amount != 0, unicode"GuaranteeEscrow: 金额必须大于零");
        address buyerSubject = registry.responsibleParty(buyerAgentId);
        address sellerSubject = registry.responsibleParty(sellerAgentId);
        require(msg.sender == buyerSubject, unicode"GuaranteeEscrow: 仅买方主体可创建");
        require(buyerSubject != sellerSubject, unicode"GuaranteeEscrow: 买卖方主体必须不同");
        tradeId = nextTradeId++;
        Trade storage t = _trades[tradeId];
        t.exists = true;
        t.id = tradeId;
        t.buyerAgentId = buyerAgentId;
        t.sellerAgentId = sellerAgentId;
        t.amount = amount;
        t.buyerSubject = buyerSubject;
        t.sellerSubject = sellerSubject;
        t.createdAt = block.timestamp;
        emit TradeCreated(tradeId, buyerAgentId, sellerAgentId, amount);
    }

    function tradeState(uint256 tradeId) external view existingTrade(tradeId) returns (State) {
        return _trades[tradeId].state;
    }

    function tradeActors(uint256 tradeId) external view existingTrade(tradeId) returns (address, address, address) {
        Trade storage t = _trades[tradeId];
        return (t.buyerSubject, t.sellerSubject, t.guarantorSubject);
    }

    function acceptTrade(uint256 tradeId) external existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.CREATED, unicode"GuaranteeEscrow: 状态错误");
        require(msg.sender == t.sellerSubject, unicode"GuaranteeEscrow: 仅卖方主体可接受");
        require(block.timestamp <= t.createdAt + ACCEPT_WINDOW, unicode"GuaranteeEscrow: 接受超时");
        t.state = State.ACCEPTED;
        t.acceptedAt = block.timestamp;
        emit TradeAccepted(tradeId, msg.sender);
    }

    function fund(uint256 tradeId) external payable nonReentrant existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.ACCEPTED, unicode"GuaranteeEscrow: 状态错误");
        require(msg.sender == t.buyerSubject, unicode"GuaranteeEscrow: 仅买方主体可付款");
        require(msg.value == t.amount, unicode"GuaranteeEscrow: 付款金额不符");
        require(block.timestamp <= t.acceptedAt + FUND_WINDOW, unicode"GuaranteeEscrow: 付款超时");
        t.state = State.FUNDED;
        t.fundedAt = block.timestamp;
        totalLiability += msg.value;
        emit TradeFunded(tradeId, msg.sender);
    }

    function minimumCoverage(uint256 sellerAgentId) public view returns (uint256) {
        uint256 score = hub.reputationScore(sellerAgentId);
        if (score < 60) return 1e18;
        if (score < 80) return 0.75e18;
        return 0.5e18;
    }

    function requiredStake(uint256 tradeId, uint256 coverage) public view existingTrade(tradeId) returns (uint256) {
        require(coverage != 0 && coverage <= MAX_COVERAGE, unicode"GuaranteeEscrow: 覆盖率非法");
        return Math.mulDiv(_trades[tradeId].amount, coverage, 1e18, Math.Rounding.Ceil);
    }

    function guarantee(uint256 tradeId, uint256 guarantorAgentId, uint256 coverage, uint256 premium)
        external
        payable
        nonReentrant
        existingTrade(tradeId)
    {
        Trade storage t = _trades[tradeId];
        require(t.state == State.FUNDED, unicode"GuaranteeEscrow: 状态错误");
        require(block.timestamp <= t.fundedAt + GUARANTEE_WINDOW, unicode"GuaranteeEscrow: 担保超时");
        address subject = registry.responsibleParty(guarantorAgentId);
        require(msg.sender == subject, unicode"GuaranteeEscrow: 仅担保主体可质押");
        require(
            subject != t.buyerSubject && subject != t.sellerSubject,
            unicode"GuaranteeEscrow: 交易主体不得自担保"
        );
        require(coverage >= minimumCoverage(t.sellerAgentId), unicode"GuaranteeEscrow: 覆盖率低于信誉要求");
        require(coverage <= MAX_COVERAGE, unicode"GuaranteeEscrow: 覆盖率非法");
        require(premium <= Math.mulDiv(t.amount, MAX_PREMIUM_BPS, 10000), unicode"GuaranteeEscrow: 保费过高");
        uint256 stake = requiredStake(tradeId, coverage);
        require(msg.value == stake, unicode"GuaranteeEscrow: 担保质押金额不符");
        t.guarantorAgentId = guarantorAgentId;
        t.guarantorSubject = subject;
        t.coverage = coverage;
        t.stake = stake;
        t.premium = premium;
        t.state = State.GUARANTEE_OFFERED;
        t.guaranteeOfferedAt = block.timestamp;
        totalLiability += msg.value;
        emit GuaranteeOffered(tradeId, guarantorAgentId, subject, coverage, premium);
    }

    function acceptGuarantee(uint256 tradeId) external existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.GUARANTEE_OFFERED, unicode"GuaranteeEscrow: 状态错误");
        require(msg.sender == t.sellerSubject, unicode"GuaranteeEscrow: 仅卖方主体可接受担保");
        require(
            block.timestamp <= t.guaranteeOfferedAt + GUARANTEE_ACCEPT_WINDOW,
            unicode"GuaranteeEscrow: 担保接受超时"
        );
        t.state = State.GUARANTEED;
        t.guaranteedAt = block.timestamp;
        emit GuaranteeAccepted(tradeId, msg.sender);
    }

    function deliver(uint256 tradeId) external existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.GUARANTEED, unicode"GuaranteeEscrow: 状态错误");
        require(msg.sender == t.sellerSubject, unicode"GuaranteeEscrow: 仅卖方主体可交付");
        require(block.timestamp <= t.guaranteedAt + DELIVER_WINDOW, unicode"GuaranteeEscrow: 交付超时");
        t.state = State.DELIVERED;
        t.deliveredAt = block.timestamp;
        emit TradeDelivered(tradeId);
    }

    function confirm(uint256 tradeId) external nonReentrant existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.DELIVERED, unicode"GuaranteeEscrow: 状态错误");
        require(msg.sender == t.buyerSubject, unicode"GuaranteeEscrow: 仅买方主体可确认");
        require(block.timestamp <= t.deliveredAt + CONFIRM_WINDOW, unicode"GuaranteeEscrow: 确认超时");
        _release(t);
        _record(t, ReputationHub.Outcome.COMPLETED);
    }

    function dispute(uint256 tradeId) external existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.DELIVERED, unicode"GuaranteeEscrow: 状态错误");
        require(
            msg.sender == t.buyerSubject || msg.sender == t.sellerSubject,
            unicode"GuaranteeEscrow: 仅交易主体可争议"
        );
        require(block.timestamp <= t.deliveredAt + CONFIRM_WINDOW, unicode"GuaranteeEscrow: 争议超时");
        t.state = State.DISPUTED;
        t.disputedAt = block.timestamp;
        emit TradeDisputed(tradeId);
    }

    function openArbitration(uint256 tradeId) external onlyOwner existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.DISPUTED && !t.caseOpened, unicode"GuaranteeEscrow: 不可开案");
        require(block.timestamp <= t.disputedAt + CASE_OPEN_WINDOW, unicode"GuaranteeEscrow: 开案超时");
        t.caseOpened = true;
        emit ArbitrationOpened(tradeId);
    }

    function resolveDispute(uint256 tradeId, Verdict verdict, uint256 buyerShareBps)
        external
        onlyOwner
        nonReentrant
        existingTrade(tradeId)
    {
        Trade storage t = _trades[tradeId];
        require(t.state == State.DISPUTED && t.caseOpened, unicode"GuaranteeEscrow: 仅活动案件可裁决");
        if (verdict == Verdict.SELLER_WINS) {
            t.state = State.RESOLVED;
            _credit(t.sellerSubject, t.amount - t.premium);
            _credit(t.guarantorSubject, t.stake + t.premium);
            _record(t, ReputationHub.Outcome.WON);
        } else {
            uint256 share = verdict == Verdict.BUYER_WINS ? 10000 : buyerShareBps;
            require(share <= 10000, unicode"GuaranteeEscrow: 比例非法");
            t.state = State.RESOLVED;
            uint256 buyerRefund = Math.mulDiv(t.amount, share, 10000);
            _credit(t.buyerSubject, buyerRefund + t.stake);
            _credit(t.sellerSubject, t.amount - buyerRefund);
            _record(t, ReputationHub.Outcome.LOST);
        }
        emit TradeResolved(tradeId, verdict, buyerShareBps);
    }

    function voidDispute(uint256 tradeId) external onlyOwner nonReentrant existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.DISPUTED && t.caseOpened, unicode"GuaranteeEscrow: 仅活动案件可作废");
        _voidFundedTrade(t);
    }

    function timeoutAutoRelease(uint256 tradeId) external nonReentrant existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.DELIVERED, unicode"GuaranteeEscrow: 状态错误");
        require(block.timestamp > t.deliveredAt + CONFIRM_WINDOW, unicode"GuaranteeEscrow: 未到超时");
        _release(t);
        _record(t, ReputationHub.Outcome.COMPLETED);
    }

    function timeoutCancelUnaccepted(uint256 tradeId) external existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.CREATED, unicode"GuaranteeEscrow: 状态错误");
        require(block.timestamp > t.createdAt + ACCEPT_WINDOW, unicode"GuaranteeEscrow: 未到超时");
        t.state = State.VOIDED;
        emit TradeVoided(tradeId);
    }

    function timeoutCancelUnfunded(uint256 tradeId) external existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.ACCEPTED, unicode"GuaranteeEscrow: 状态错误");
        require(block.timestamp > t.acceptedAt + FUND_WINDOW, unicode"GuaranteeEscrow: 未到超时");
        t.state = State.VOIDED;
        emit TradeVoided(tradeId);
    }

    function timeoutRejectGuarantee(uint256 tradeId) external nonReentrant existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.GUARANTEE_OFFERED, unicode"GuaranteeEscrow: 状态错误");
        require(
            block.timestamp > t.guaranteeOfferedAt + GUARANTEE_ACCEPT_WINDOW, unicode"GuaranteeEscrow: 未到超时"
        );
        _voidFundedTrade(t);
    }

    function timeoutRefund(uint256 tradeId) external nonReentrant existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        if (t.state == State.FUNDED) {
            require(block.timestamp > t.fundedAt + GUARANTEE_WINDOW, unicode"GuaranteeEscrow: 未到超时");
            t.state = State.VOIDED;
            _credit(t.buyerSubject, t.amount);
            emit TradeVoided(tradeId);
        } else {
            require(t.state == State.GUARANTEED, unicode"GuaranteeEscrow: 状态错误");
            require(block.timestamp > t.guaranteedAt + DELIVER_WINDOW, unicode"GuaranteeEscrow: 未到超时");
            t.state = State.RESOLVED;
            _credit(t.buyerSubject, t.amount + t.stake);
            _record(t, ReputationHub.Outcome.DEFAULTED);
            emit TradeResolved(tradeId, Verdict.BUYER_WINS, 10000);
        }
    }

    function timeoutVoidDispute(uint256 tradeId) external nonReentrant existingTrade(tradeId) {
        Trade storage t = _trades[tradeId];
        require(t.state == State.DISPUTED && !t.caseOpened, unicode"GuaranteeEscrow: 不可超时作废");
        require(block.timestamp > t.disputedAt + CASE_OPEN_WINDOW, unicode"GuaranteeEscrow: 未到超时");
        _voidFundedTrade(t);
    }

    function withdraw(address payable recipient) external nonReentrant {
        require(recipient != address(0), unicode"GuaranteeEscrow: 收款地址为零");
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount != 0, unicode"GuaranteeEscrow: 无可提取余额");
        pendingWithdrawals[msg.sender] = 0;
        totalLiability -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, unicode"GuaranteeEscrow: 提取失败");
        emit Withdrawal(msg.sender, recipient, amount);
    }

    function _release(Trade storage t) private {
        t.state = State.RELEASED;
        _credit(t.sellerSubject, t.amount - t.premium);
        _credit(t.guarantorSubject, t.stake + t.premium);
    }

    function _voidFundedTrade(Trade storage t) private {
        t.state = State.VOIDED;
        _credit(t.buyerSubject, t.amount);
        _credit(t.guarantorSubject, t.stake);
        emit TradeVoided(t.id);
    }

    function _record(Trade storage t, ReputationHub.Outcome outcome) private {
        hub.recordOutcome(keccak256(abi.encode(address(this), t.id)), t.sellerAgentId, outcome);
    }

    function _credit(address account, uint256 amount) private {
        if (amount == 0) return;
        pendingWithdrawals[account] += amount;
        emit WithdrawalCredited(account, amount);
    }
}
