// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ReputationHub is Ownable {
    enum Outcome {
        COMPLETED,
        DEFAULTED,
        WON,
        LOST
    }

    struct AgentReputation {
        uint256 tradesCompleted;
        uint256 tradesDefaulted;
        uint256 disputesWon;
        uint256 disputesLost;
    }

    struct JurorReputation {
        uint256 casesFinalized;
        uint256 votesRevealed;
        uint256 abstentions;
        uint256 consensusAligned;
        uint256 consensusOpposed;
    }

    mapping(uint256 => AgentReputation) public reputation;
    mapping(address => JurorReputation) public jurorReputation;
    mapping(address => bool) public outcomeWriters;
    mapping(address => bool) public jurorMetricWriters;
    mapping(bytes32 => bool) public recordedOutcomes;
    mapping(bytes32 => bool) public recordedJurorCases;

    event OutcomeRecorded(bytes32 indexed outcomeId, uint256 indexed agentId, Outcome outcome);
    event OutcomeWriterSet(address indexed writer, bool authorized);
    event JurorMetricWriterSet(address indexed writer, bool authorized);
    event JurorCaseRecorded(
        bytes32 indexed recordId,
        address indexed subject,
        bool revealed,
        bool abstained,
        bool effective,
        bool consensusAligned
    );

    constructor() Ownable(msg.sender) {}

    function setOutcomeWriter(address writer, bool authorized) external onlyOwner {
        require(writer != address(0), unicode"ReputationHub: 调用方为零地址");
        outcomeWriters[writer] = authorized;
        emit OutcomeWriterSet(writer, authorized);
    }

    function setJurorMetricWriter(address writer, bool authorized) external onlyOwner {
        require(writer != address(0), unicode"ReputationHub: 调用方为零地址");
        jurorMetricWriters[writer] = authorized;
        emit JurorMetricWriterSet(writer, authorized);
    }

    /// @notice outcomeId must identify one terminal business result. It is consumed exactly once.
    function recordOutcome(bytes32 outcomeId, uint256 agentId, Outcome outcome) external {
        require(outcomeWriters[msg.sender], unicode"ReputationHub: 未授权结果写入方");
        require(!recordedOutcomes[outcomeId], unicode"ReputationHub: 结果已记录");
        recordedOutcomes[outcomeId] = true;

        AgentReputation storage rep = reputation[agentId];
        if (outcome == Outcome.COMPLETED) rep.tradesCompleted++;
        else if (outcome == Outcome.DEFAULTED) rep.tradesDefaulted++;
        else if (outcome == Outcome.WON) rep.disputesWon++;
        else rep.disputesLost++;
        emit OutcomeRecorded(outcomeId, agentId, outcome);
    }

    function recordJurorCase(
        bytes32 recordId,
        address subject,
        bool revealed,
        bool abstained,
        bool effective,
        bool aligned
    ) external {
        require(jurorMetricWriters[msg.sender], unicode"ReputationHub: 未授权陪审指标写入方");
        require(subject != address(0), unicode"ReputationHub: 陪审员为零地址");
        require(!abstained || revealed, unicode"ReputationHub: 弃权必须已揭示");
        require(!recordedJurorCases[recordId], unicode"ReputationHub: 陪审记录已存在");
        recordedJurorCases[recordId] = true;

        JurorReputation storage rep = jurorReputation[subject];
        rep.casesFinalized++;
        if (revealed) rep.votesRevealed++;
        if (abstained) rep.abstentions++;
        if (effective && revealed && !abstained) {
            if (aligned) rep.consensusAligned++;
            else rep.consensusOpposed++;
        }

        emit JurorCaseRecorded(recordId, subject, revealed, abstained, effective, aligned);
    }

    function reputationScore(uint256 agentId) external view returns (uint256) {
        AgentReputation storage rep = reputation[agentId];
        uint256 total = rep.tradesCompleted + rep.tradesDefaulted + rep.disputesWon + rep.disputesLost;
        if (total == 0) return 50;
        uint256 penalty = (100 * rep.tradesDefaulted + 50 * rep.disputesLost) / total;
        return penalty >= 100 ? 0 : 100 - penalty;
    }

    function isJurorEligible(address subject) external view returns (bool) {
        JurorReputation storage rep = jurorReputation[subject];
        if (rep.casesFinalized < 3) return true;
        return rep.votesRevealed * 100 >= rep.casesFinalized * 80;
    }
}
