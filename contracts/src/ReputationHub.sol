// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ReputationHub —— 信誉记录中心
/// @notice 记录智能体交易结果与仲裁裁决，形成不可篡改的行为档案（"警察证据"）。
///         MVP 用链上结构+事件存证；论文版迁移 EAS attestation。
///         ACL 设计：仅授权合约（Escrow/Voting）可写入，天然禁止自评。
contract ReputationHub is Ownable {
    enum Outcome {
        COMPLETED, // 交易完成（记录到卖方）
        DEFAULTED, // 卖方违约（记录到违约方）
        WON,       // 争议胜诉（从被记录 agent 视角）
        LOST       // 争议败诉（从被记录 agent 视角）
    }

    struct AgentReputation {
        uint256 tradesCompleted;   // 完成交易数
        uint256 tradesDefaulted;   // 违约数（卖方）
        uint256 disputesWon;       // 争议胜诉数
        uint256 disputesLost;      // 争议败诉数
    }

    mapping(uint256 => AgentReputation) public reputation;
    mapping(address => bool) public authorizedCallers;

    event OutcomeRecorded(uint256 indexed agentId, Outcome outcome);
    event CallerAuthorized(address indexed caller, bool authorized);

    constructor() Ownable(msg.sender) {}

    /// 配置可信写入方（仅 owner；应为 Escrow/Voting 合约地址）
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit CallerAuthorized(caller, authorized);
    }

    /// 记录一次交易/裁决结果（仅授权调用方）。
    /// 调用约定：WON/LOST 从"被记录 agent"的视角传参（T5/T6 按此语义调用）。
    function recordOutcome(uint256 agentId, Outcome outcome) external {
        require(authorizedCallers[msg.sender], unicode"ReputationHub: 未授权调用方");

        AgentReputation storage rep = reputation[agentId];
        if (outcome == Outcome.COMPLETED) {
            rep.tradesCompleted++;
        } else if (outcome == Outcome.DEFAULTED) {
            rep.tradesDefaulted++;
        } else if (outcome == Outcome.WON) {
            rep.disputesWon++;
        } else if (outcome == Outcome.LOST) {
            rep.disputesLost++;
        }

        emit OutcomeRecorded(agentId, outcome);
    }

    /// 信誉分（0-100，链上直接计算；无记录的新 agent 默认 50）
    function reputationScore(uint256 agentId) external view returns (uint256 score) {
        AgentReputation storage rep = reputation[agentId];
        uint256 total = rep.tradesCompleted + rep.tradesDefaulted + rep.disputesWon + rep.disputesLost;
        if (total == 0) return 50; // 新智能体默认 50（需担保人担保才能接单）
        score = 100 - (100 * rep.tradesDefaulted) / total - (50 * rep.disputesLost) / total;
        if (score > 100) score = 100;
    }
}
