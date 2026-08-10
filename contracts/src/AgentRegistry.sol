// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Transferable agent token plus an immutable legal/responsible subject.
/// NFT transfers change control of the token, not responsibility for already registered activity.
contract AgentRegistry is ERC721, Ownable, ReentrancyGuard {
    struct AgentInfo {
        string name;
        string description;
        string endpoint;
        address owner;
        uint256 createdAt;
    }

    uint256 public registrationFee;
    uint256 public accruedFees;
    uint256 public agentCount;
    mapping(uint256 => AgentInfo) public agents;
    mapping(address => bool) public registeredSubjects;
    mapping(address => uint256) public registeredAtBlock;
    mapping(address => uint256) public firstAgentIdPlusOne;
    mapping(address => uint256) public pendingWithdrawals;

    event AgentRegistered(uint256 indexed tokenId, address indexed owner, string name);
    event RegistrationFeeUpdated(uint256 fee);
    event WithdrawalCredited(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, address indexed recipient, uint256 amount);

    constructor() ERC721("AgentTrust Agent ID", "ATID") Ownable(msg.sender) {}

    function setRegistrationFee(uint256 fee) external onlyOwner {
        registrationFee = fee;
        emit RegistrationFeeUpdated(fee);
    }

    function registerAgent(string memory name, string memory description, string memory endpoint)
        external
        payable
        nonReentrant
        returns (uint256 tokenId)
    {
        require(msg.value >= registrationFee, unicode"AgentRegistry: 注册质押不足");
        tokenId = agentCount++;
        agents[tokenId] = AgentInfo(name, description, endpoint, msg.sender, block.timestamp);
        if (!registeredSubjects[msg.sender]) {
            registeredSubjects[msg.sender] = true;
            registeredAtBlock[msg.sender] = block.number;
            firstAgentIdPlusOne[msg.sender] = tokenId + 1;
        }
        accruedFees += registrationFee;
        uint256 excess = msg.value - registrationFee;
        if (excess != 0) {
            pendingWithdrawals[msg.sender] += excess;
            emit WithdrawalCredited(msg.sender, excess);
        }
        _safeMint(msg.sender, tokenId);
        emit AgentRegistered(tokenId, msg.sender, name);
    }

    function responsibleParty(uint256 agentId) public view returns (address) {
        require(_ownerOf(agentId) != address(0), unicode"AgentRegistry: 智能体不存在");
        return agents[agentId].owner;
    }

    function isRegisteredSubjectAt(address subject, uint256 snapshotBlock) external view returns (bool) {
        return registeredSubjects[subject] && registeredAtBlock[subject] <= snapshotBlock;
    }

    function isRegisteredSubjectAtCount(address subject, uint256 snapshotAgentCount) external view returns (bool) {
        uint256 first = firstAgentIdPlusOne[subject];
        return first != 0 && first <= snapshotAgentCount;
    }

    function withdrawFees() external onlyOwner {
        uint256 amount = accruedFees;
        require(amount != 0, unicode"AgentRegistry: 余额为零");
        accruedFees = 0;
        pendingWithdrawals[msg.sender] += amount;
        emit WithdrawalCredited(msg.sender, amount);
    }

    function withdraw(address payable recipient) external nonReentrant {
        require(recipient != address(0), unicode"AgentRegistry: 收款地址为零");
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount != 0, unicode"AgentRegistry: 无可提取余额");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, unicode"AgentRegistry: 提取失败");
        emit Withdrawal(msg.sender, recipient, amount);
    }
}
