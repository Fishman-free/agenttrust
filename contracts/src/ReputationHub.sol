// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ReputationHub is Ownable {
    enum Outcome { COMPLETED, DEFAULTED, WON, LOST }

    struct AgentReputation {
        uint256 tradesCompleted;
        uint256 tradesDefaulted;
        uint256 disputesWon;
        uint256 disputesLost;
    }

    mapping(uint256 => AgentReputation) public reputation;
    mapping(address => bool) public authorizedCallers;
    mapping(bytes32 => bool) public recordedOutcomes;

    event OutcomeRecorded(bytes32 indexed outcomeId, uint256 indexed agentId, Outcome outcome);
    event CallerAuthorized(address indexed caller, bool authorized);

    constructor() Ownable(msg.sender) {}

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        require(caller != address(0), unicode"ReputationHub: 调用方为零地址");
        authorizedCallers[caller] = authorized;
        emit CallerAuthorized(caller, authorized);
    }

    /// @notice outcomeId must identify one terminal business result. It is consumed exactly once.
    function recordOutcome(bytes32 outcomeId, uint256 agentId, Outcome outcome) external {
        require(authorizedCallers[msg.sender], unicode"ReputationHub: 未授权调用方");
        require(!recordedOutcomes[outcomeId], unicode"ReputationHub: 结果已记录");
        recordedOutcomes[outcomeId] = true;

        AgentReputation storage rep = reputation[agentId];
        if (outcome == Outcome.COMPLETED) rep.tradesCompleted++;
        else if (outcome == Outcome.DEFAULTED) rep.tradesDefaulted++;
        else if (outcome == Outcome.WON) rep.disputesWon++;
        else rep.disputesLost++;
        emit OutcomeRecorded(outcomeId, agentId, outcome);
    }

    function reputationScore(uint256 agentId) external view returns (uint256) {
        AgentReputation storage rep = reputation[agentId];
        uint256 total = rep.tradesCompleted + rep.tradesDefaulted + rep.disputesWon + rep.disputesLost;
        if (total == 0) return 50;
        uint256 penalty = (100 * rep.tradesDefaulted + 50 * rep.disputesLost) / total;
        return penalty >= 100 ? 0 : 100 - penalty;
    }
}
