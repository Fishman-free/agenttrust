// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentRegistry —— 智能体身份注册表
/// @notice 对齐 ERC-8004 身份注册表语义：可移植 Agent ID（ERC-721）+ 责任主体绑定 + anti-Sybil 注册质押。
///         铸造者即法律责任人（智能体无民事主体资格，责任归属真实主体）。
contract AgentRegistry is ERC721, Ownable, ReentrancyGuard {
    struct AgentInfo {
        string name;        // 智能体名称
        string description; // 能力描述
        string endpoint;    // MCP/A2A 接入端点
        address owner;      // 责任主体（= 铸造者）
        uint256 createdAt;  // 注册时间
    }

    uint256 public registrationFee;   // 注册质押（anti-Sybil）
    uint256 public agentCount;
    mapping(uint256 => AgentInfo) public agents;

    event AgentRegistered(uint256 indexed tokenId, address indexed owner, string name);
    event RegistrationFeeUpdated(uint256 fee);

    constructor() ERC721("AgentTrust Agent ID", "ATID") Ownable(msg.sender) {}

    /// 设置注册质押金额（仅 owner）
    function setRegistrationFee(uint256 fee) external onlyOwner {
        registrationFee = fee;
        emit RegistrationFeeUpdated(fee);
    }

    /// 注册智能体：支付注册质押，铸造 Agent ID，绑定责任主体
    function registerAgent(string memory name, string memory description, string memory endpoint)
        external payable nonReentrant returns (uint256 tokenId)
    {
        require(msg.value >= registrationFee, unicode"AgentRegistry: 注册质押不足");

        tokenId = agentCount++;
        _safeMint(msg.sender, tokenId);
        agents[tokenId] = AgentInfo(name, description, endpoint, msg.sender, block.timestamp);

        emit AgentRegistered(tokenId, msg.sender, name);

        // 超额支付显式退款（CEI：外部调用置于状态变更之后，nonReentrant 已防护）
        if (msg.value > registrationFee) {
            (bool ok,) = msg.sender.call{value: msg.value - registrationFee}("");
            require(ok, unicode"AgentRegistry: 退款失败");
        }
    }

    /// 提取注册质押（仅 owner）
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, unicode"AgentRegistry: 余额为零");
        (bool ok,) = owner().call{value: balance}("");
        require(ok, unicode"AgentRegistry: 转账失败");
    }
}
