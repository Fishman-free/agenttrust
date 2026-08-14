// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Optional proof-of-personhood oracle used to bind one human to one community ID.
/// The verifier is expected to consume the nullifier itself so the same human attestation
/// cannot be reused across wallets; AgentRegistry additionally tracks used nullifiers as
/// defense in depth.
interface IAgentProofOfPersonhood {
    function verifyAndConsume(address subject, bytes32 nullifier, bytes calldata proof) external returns (bool);
}

/// @notice Transferable agent token plus an immutable legal/responsible subject.
/// NFT transfers change control of the token, not responsibility for already registered activity.
///
/// Anti-Sybil model:
/// - one community ID per responsible subject (EOA/contract wallet);
/// - a registration fee raises the cost of multi-wallet farming;
/// - optionally, a proof-of-personhood verifier can be required so the same human cannot
///   register from multiple wallets (real-world uniqueness must come from the oracle).
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

    /// @notice Human-proof verifier. address(0) = disabled (fee-only anti-Sybil, demo mode).
    address public pohVerifier;
    mapping(bytes32 => bool) public usedPoHNullifiers;

    event AgentRegistered(uint256 indexed tokenId, address indexed owner, string name);
    event RegistrationFeeUpdated(uint256 fee);
    event PoHVerifierSet(address indexed verifier);
    event WithdrawalCredited(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, address indexed recipient, uint256 amount);

    constructor() ERC721("AgentTrust Agent ID", "ATID") Ownable(msg.sender) {}

    function setRegistrationFee(uint256 fee) external onlyOwner {
        registrationFee = fee;
        emit RegistrationFeeUpdated(fee);
    }

    /// @notice Enable, replace, or disable (address(0)) the proof-of-personhood requirement.
    function setPoHVerifier(address verifier) external onlyOwner {
        pohVerifier = verifier;
        emit PoHVerifierSet(verifier);
    }

    /// @notice Fee-only registration path. Only available while no PoH verifier is configured.
    function registerAgent(string memory name, string memory description, string memory endpoint)
        external
        payable
        nonReentrant
        returns (uint256 tokenId)
    {
        require(pohVerifier == address(0), unicode"AgentRegistry: 需提供人类证明");
        tokenId = _registerAgent(name, description, endpoint);
    }

    /// @notice Proof-of-personhood registration path: one human attestation (nullifier) can be
    /// consumed exactly once, so a human cannot mint multiple community IDs across wallets.
    function registerAgentVerified(
        string memory name,
        string memory description,
        string memory endpoint,
        bytes32 nullifier,
        bytes calldata proof
    ) external payable nonReentrant returns (uint256 tokenId) {
        require(pohVerifier != address(0), unicode"AgentRegistry: 未配置人类证明验证器");
        require(nullifier != bytes32(0), unicode"AgentRegistry: 无效 nullifier");
        require(!usedPoHNullifiers[nullifier], unicode"AgentRegistry: nullifier 已使用");
        require(
            IAgentProofOfPersonhood(pohVerifier).verifyAndConsume(msg.sender, nullifier, proof),
            unicode"AgentRegistry: 人类证明无效"
        );
        usedPoHNullifiers[nullifier] = true;
        tokenId = _registerAgent(name, description, endpoint);
    }

    function _registerAgent(string memory name, string memory description, string memory endpoint)
        internal
        returns (uint256 tokenId)
    {
        require(msg.value >= registrationFee, unicode"AgentRegistry: 注册质押不足");
        require(!registeredSubjects[msg.sender], unicode"AgentRegistry: 主体已注册");
        tokenId = agentCount++;
        agents[tokenId] = AgentInfo(name, description, endpoint, msg.sender, block.timestamp);
        registeredSubjects[msg.sender] = true;
        registeredAtBlock[msg.sender] = block.number;
        firstAgentIdPlusOne[msg.sender] = tokenId + 1;
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
