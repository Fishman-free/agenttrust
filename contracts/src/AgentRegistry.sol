// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentProofOfPersonhood {
    function verifyAndConsume(address subject, bytes32 nullifier, bytes calldata proof) external returns (bool);

    /// @notice Re-verifies the already-bound human for wallet recovery without consuming a new identity.
    /// The proof must bind the recovery signal to newWallet.
    function verifySameIdentity(bytes32 nullifier, address newWallet, bytes calldata proof) external returns (bool);
}

interface ISubjectObligationOracle {
    function subjectHasOpenObligations(address subject) external view returns (bool);
}

/// @notice One lifetime community ID per human/responsible subject with a refundable deposit.
/// NFT transfers do not change responsibility. A PoH-bound identity can recover to a new wallet
/// using same-human verification, one guardian approval, and a 24-hour veto window.
contract AgentRegistry is ERC721, Ownable, ReentrancyGuard {
    uint256 public constant MIN_GUARDIANS = 2;
    uint256 public constant MAX_GUARDIANS = 3;
    uint256 public constant RECOVERY_DELAY = 24 hours;
    uint256 public constant RECOVERY_EXECUTION_WINDOW = 7 days;

    struct AgentInfo {
        string name;
        string description;
        string endpoint;
        address owner;
        uint256 createdAt;
    }

    struct RecoveryRequest {
        address newWallet;
        bytes32 nullifier;
        uint64 executeAfter;
        uint64 expiresAt;
        uint64 nonce;
        uint8 approvals;
        bool exists;
    }

    uint256 public registrationDeposit;
    uint256 public agentCount;
    uint256 public totalLiability;

    mapping(uint256 => AgentInfo) public agents;
    /// @notice Permanent tombstone: once true, an address can never claim another identity.
    mapping(address => bool) public registeredSubjects;
    /// @notice Current participation eligibility. Cleared on deregistration/recovery-from-old-wallet.
    mapping(address => bool) public activeSubjects;
    mapping(address => bool) public deregistered;
    mapping(address => uint256) public registeredAtBlock;
    mapping(address => uint256) public firstAgentIdPlusOne;
    mapping(address => uint256) public deposits;
    mapping(address => uint256) public pendingWithdrawals;

    address public pohVerifier;
    mapping(bytes32 => bool) public usedPoHNullifiers;
    mapping(bytes32 => address) public nullifierSubject;
    mapping(address => bytes32) public subjectNullifier;

    mapping(address => address[]) private _guardians;
    mapping(address => mapping(address => bool)) public isGuardian;

    mapping(address => RecoveryRequest) public recoveryRequests;
    mapping(address => uint64) public nextRecoveryNonce;
    mapping(address => mapping(address => uint64)) public guardianApprovedNonce;

    mapping(address => bool) public authorizedSlashSources;
    address public escrowOracle;
    address public votingOracle;

    event AgentRegistered(uint256 indexed tokenId, address indexed owner, string name, uint256 deposit);
    event RegistrationDepositUpdated(uint256 deposit);
    event PoHVerifierSet(address indexed verifier);
    event ObligationOraclesSet(address indexed escrow, address indexed voting);
    event SlashSourceSet(address indexed source, bool authorized);
    event GuardiansUpdated(address indexed subject, address[] guardians);
    event SubjectDeregistered(address indexed subject, uint256 indexed agentId, uint256 refundedDeposit);
    event RecoveryRequested(
        address indexed subject,
        address indexed newWallet,
        bytes32 indexed nullifier,
        uint256 executeAfter,
        uint256 expiresAt,
        uint256 nonce
    );
    event RecoveryGuardianApproved(address indexed subject, address indexed guardian, uint256 nonce);
    event RecoveryVetoed(address indexed subject, address indexed newWallet, uint256 nonce);
    event RecoveryCompleted(
        address indexed oldSubject, address indexed newSubject, uint256 indexed agentId, bytes32 nullifier
    );
    event DepositSlashed(address indexed subject, address indexed recipient, uint256 amount);
    event WithdrawalCredited(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, address indexed recipient, uint256 amount);

    constructor() ERC721("AgentTrust Agent ID", "ATID") Ownable(msg.sender) {}

    function setRegistrationDeposit(uint256 deposit) external onlyOwner {
        registrationDeposit = deposit;
        emit RegistrationDepositUpdated(deposit);
    }

    function setPoHVerifier(address verifier) external onlyOwner {
        pohVerifier = verifier;
        emit PoHVerifierSet(verifier);
    }

    function setObligationOracles(address escrow, address voting) external onlyOwner {
        escrowOracle = escrow;
        votingOracle = voting;
        emit ObligationOraclesSet(escrow, voting);
    }

    function setSlashSource(address source, bool authorized) external onlyOwner {
        require(source != address(0), unicode"AgentRegistry: 罚没来源为零");
        authorizedSlashSources[source] = authorized;
        emit SlashSourceSet(source, authorized);
    }

    function registerAgent(
        string memory name,
        string memory description,
        string memory endpoint,
        address[] calldata guardianList
    ) external payable nonReentrant returns (uint256 tokenId) {
        require(pohVerifier == address(0), unicode"AgentRegistry: 需提供人类证明");
        tokenId = _registerAgent(name, description, endpoint, guardianList, bytes32(0));
    }

    function registerAgentVerified(
        string memory name,
        string memory description,
        string memory endpoint,
        bytes32 nullifier,
        bytes calldata proof,
        address[] calldata guardianList
    ) external payable nonReentrant returns (uint256 tokenId) {
        require(pohVerifier != address(0), unicode"AgentRegistry: 未配置人类证明验证器");
        require(nullifier != bytes32(0), unicode"AgentRegistry: 无效 nullifier");
        require(!usedPoHNullifiers[nullifier], unicode"AgentRegistry: nullifier 已使用");
        require(
            IAgentProofOfPersonhood(pohVerifier).verifyAndConsume(msg.sender, nullifier, proof),
            unicode"AgentRegistry: 人类证明无效"
        );
        usedPoHNullifiers[nullifier] = true;
        nullifierSubject[nullifier] = msg.sender;
        subjectNullifier[msg.sender] = nullifier;
        tokenId = _registerAgent(name, description, endpoint, guardianList, nullifier);
    }

    function _registerAgent(
        string memory name,
        string memory description,
        string memory endpoint,
        address[] calldata guardianList,
        bytes32 nullifier
    ) internal returns (uint256 tokenId) {
        require(msg.value >= registrationDeposit, unicode"AgentRegistry: 注册押金不足");
        require(!registeredSubjects[msg.sender], unicode"AgentRegistry: 主体已注册");
        _validateGuardians(msg.sender, guardianList);

        tokenId = agentCount++;
        agents[tokenId] = AgentInfo(name, description, endpoint, msg.sender, block.timestamp);
        registeredSubjects[msg.sender] = true;
        activeSubjects[msg.sender] = true;
        registeredAtBlock[msg.sender] = block.number;
        firstAgentIdPlusOne[msg.sender] = tokenId + 1;
        deposits[msg.sender] = registrationDeposit;
        totalLiability += msg.value;

        _storeGuardians(msg.sender, guardianList);

        uint256 excess = msg.value - registrationDeposit;
        if (excess != 0) {
            pendingWithdrawals[msg.sender] += excess;
            emit WithdrawalCredited(msg.sender, excess);
        }
        _safeMint(msg.sender, tokenId);
        emit AgentRegistered(tokenId, msg.sender, name, registrationDeposit);
        nullifier; // Documents that plain registrations intentionally have no recovery anchor.
    }

    function setGuardians(address[] calldata guardianList) external {
        require(activeSubjects[msg.sender] && !deregistered[msg.sender], unicode"AgentRegistry: 主体未激活");
        require(!_hasLiveRecovery(msg.sender), unicode"AgentRegistry: 找回处理中");
        _validateGuardians(msg.sender, guardianList);
        _clearGuardians(msg.sender);
        _storeGuardians(msg.sender, guardianList);
    }

    function guardiansOf(address subject) external view returns (address[] memory) {
        return _guardians[subject];
    }

    function deregister() external nonReentrant {
        require(activeSubjects[msg.sender] && !deregistered[msg.sender], unicode"AgentRegistry: 主体未激活");
        require(!_hasLiveRecovery(msg.sender), unicode"AgentRegistry: 找回处理中");
        require(!_hasOpenObligations(msg.sender), unicode"AgentRegistry: 存在未结义务");

        uint256 tokenId = firstAgentIdPlusOne[msg.sender] - 1;
        require(_ownerOf(tokenId) == msg.sender, unicode"AgentRegistry: NFT 已转让");
        uint256 amount = deposits[msg.sender];
        deposits[msg.sender] = 0;
        activeSubjects[msg.sender] = false;
        deregistered[msg.sender] = true;
        _clearGuardians(msg.sender);
        _burn(tokenId);

        if (amount != 0) {
            pendingWithdrawals[msg.sender] += amount;
            emit WithdrawalCredited(msg.sender, amount);
        }
        emit SubjectDeregistered(msg.sender, tokenId, amount);
    }

    function requestRecovery(bytes32 nullifier, bytes calldata recoveryProof, address newWallet) external nonReentrant {
        require(msg.sender == newWallet, unicode"AgentRegistry: 新钱包必须发起");
        require(newWallet != address(0), unicode"AgentRegistry: 新钱包为零");
        require(!registeredSubjects[newWallet], unicode"AgentRegistry: 新钱包已注册");
        address subject = nullifierSubject[nullifier];
        require(subject != address(0), unicode"AgentRegistry: 未知 nullifier");
        require(activeSubjects[subject] && !deregistered[subject], unicode"AgentRegistry: 身份未激活");
        require(_ownerOf(firstAgentIdPlusOne[subject] - 1) == subject, unicode"AgentRegistry: NFT 已转让");
        require(!isGuardian[subject][newWallet], unicode"AgentRegistry: 新钱包不能是守护人");
        require(pohVerifier != address(0), unicode"AgentRegistry: 未配置人类证明验证器");
        require(
            IAgentProofOfPersonhood(pohVerifier).verifySameIdentity(nullifier, newWallet, recoveryProof),
            unicode"AgentRegistry: 找回证明无效"
        );

        RecoveryRequest storage existing = recoveryRequests[subject];
        require(!existing.exists || block.timestamp > existing.expiresAt, unicode"AgentRegistry: 已有找回请求");

        uint64 nonce = ++nextRecoveryNonce[subject];
        uint64 executeAfter = uint64(block.timestamp + RECOVERY_DELAY);
        uint64 expiresAt = uint64(uint256(executeAfter) + RECOVERY_EXECUTION_WINDOW);
        recoveryRequests[subject] = RecoveryRequest({
            newWallet: newWallet,
            nullifier: nullifier,
            executeAfter: executeAfter,
            expiresAt: expiresAt,
            nonce: nonce,
            approvals: 0,
            exists: true
        });
        emit RecoveryRequested(subject, newWallet, nullifier, executeAfter, expiresAt, nonce);
    }

    function approveRecovery(address subject) external {
        RecoveryRequest storage request = recoveryRequests[subject];
        require(request.exists, unicode"AgentRegistry: 无找回请求");
        require(block.timestamp <= request.expiresAt, unicode"AgentRegistry: 找回请求已过期");
        require(isGuardian[subject][msg.sender], unicode"AgentRegistry: 非守护人");
        require(guardianApprovedNonce[subject][msg.sender] != request.nonce, unicode"AgentRegistry: 守护人已批准");
        guardianApprovedNonce[subject][msg.sender] = request.nonce;
        request.approvals++;
        emit RecoveryGuardianApproved(subject, msg.sender, request.nonce);
    }

    function vetoRecovery(address subject) external {
        RecoveryRequest memory request = recoveryRequests[subject];
        require(request.exists, unicode"AgentRegistry: 无找回请求");
        require(msg.sender == subject, unicode"AgentRegistry: 仅原钱包可否决");
        require(block.timestamp < request.executeAfter, unicode"AgentRegistry: 否决窗口已结束");
        delete recoveryRequests[subject];
        emit RecoveryVetoed(subject, request.newWallet, request.nonce);
    }

    function executeRecovery(address subject) external nonReentrant {
        RecoveryRequest memory request = recoveryRequests[subject];
        require(request.exists, unicode"AgentRegistry: 无找回请求");
        require(block.timestamp >= request.executeAfter, unicode"AgentRegistry: 否决窗口未结束");
        require(block.timestamp <= request.expiresAt, unicode"AgentRegistry: 找回请求已过期");
        require(request.approvals >= 1, unicode"AgentRegistry: 缺少守护人批准");
        require(activeSubjects[subject] && !deregistered[subject], unicode"AgentRegistry: 身份未激活");
        require(!registeredSubjects[request.newWallet], unicode"AgentRegistry: 新钱包已注册");
        require(!isGuardian[subject][request.newWallet], unicode"AgentRegistry: 新钱包不能是守护人");
        require(!_hasOpenObligations(subject), unicode"AgentRegistry: 存在未结义务");

        uint256 tokenId = firstAgentIdPlusOne[subject] - 1;
        require(_ownerOf(tokenId) == subject, unicode"AgentRegistry: NFT 已转让");

        address[] memory guardianList = _guardians[subject];
        _clearGuardians(subject);
        for (uint256 i; i < guardianList.length; ++i) {
            isGuardian[request.newWallet][guardianList[i]] = true;
            _guardians[request.newWallet].push(guardianList[i]);
        }
        emit GuardiansUpdated(request.newWallet, guardianList);

        registeredSubjects[request.newWallet] = true;
        activeSubjects[request.newWallet] = true;
        activeSubjects[subject] = false;
        registeredAtBlock[request.newWallet] = registeredAtBlock[subject];
        firstAgentIdPlusOne[request.newWallet] = firstAgentIdPlusOne[subject];
        deposits[request.newWallet] = deposits[subject];
        deposits[subject] = 0;
        agents[tokenId].owner = request.newWallet;
        nullifierSubject[request.nullifier] = request.newWallet;
        subjectNullifier[request.newWallet] = request.nullifier;
        subjectNullifier[subject] = bytes32(0);
        _safeTransfer(subject, request.newWallet, tokenId, "");

        delete recoveryRequests[subject];
        emit RecoveryCompleted(subject, request.newWallet, tokenId, request.nullifier);
    }

    function slashDeposit(address subject, address recipient, uint256 amount) external nonReentrant {
        require(authorizedSlashSources[msg.sender], unicode"AgentRegistry: 未授权罚没来源");
        require(recipient != address(0), unicode"AgentRegistry: 罚没收款人为零");
        require(amount != 0 && amount <= deposits[subject], unicode"AgentRegistry: 罚没金额无效");
        deposits[subject] -= amount;
        pendingWithdrawals[recipient] += amount;
        emit DepositSlashed(subject, recipient, amount);
        emit WithdrawalCredited(recipient, amount);
    }

    function responsibleParty(uint256 agentId) public view returns (address) {
        address subject = agents[agentId].owner;
        require(subject != address(0), unicode"AgentRegistry: 智能体不存在");
        return subject;
    }

    function isRegisteredSubjectAt(address subject, uint256 snapshotBlock) external view returns (bool) {
        return activeSubjects[subject] && registeredAtBlock[subject] <= snapshotBlock;
    }

    function isRegisteredSubjectAtCount(address subject, uint256 snapshotAgentCount) external view returns (bool) {
        uint256 first = firstAgentIdPlusOne[subject];
        return activeSubjects[subject] && first != 0 && first <= snapshotAgentCount;
    }

    function subjectHasOpenObligations(address subject) external view returns (bool) {
        return _hasOpenObligations(subject);
    }

    function withdraw(address payable recipient) external nonReentrant {
        require(recipient != address(0), unicode"AgentRegistry: 收款地址为零");
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount != 0, unicode"AgentRegistry: 无可提取余额");
        pendingWithdrawals[msg.sender] = 0;
        totalLiability -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, unicode"AgentRegistry: 提取失败");
        emit Withdrawal(msg.sender, recipient, amount);
    }

    function _validateGuardians(address subject, address[] calldata guardianList) private pure {
        require(
            guardianList.length >= MIN_GUARDIANS && guardianList.length <= MAX_GUARDIANS,
            unicode"AgentRegistry: 守护人数量必须为 2-3"
        );
        for (uint256 i; i < guardianList.length; ++i) {
            address guardian = guardianList[i];
            require(guardian != address(0), unicode"AgentRegistry: 守护人为零");
            require(guardian != subject, unicode"AgentRegistry: 不能自任守护人");
            for (uint256 j; j < i; ++j) {
                require(guardianList[j] != guardian, unicode"AgentRegistry: 守护人重复");
            }
        }
    }

    function _storeGuardians(address subject, address[] calldata guardianList) private {
        for (uint256 i; i < guardianList.length; ++i) {
            address guardian = guardianList[i];
            isGuardian[subject][guardian] = true;
            _guardians[subject].push(guardian);
        }
        emit GuardiansUpdated(subject, guardianList);
    }

    function _clearGuardians(address subject) private {
        address[] storage list = _guardians[subject];
        for (uint256 i; i < list.length; ++i) {
            isGuardian[subject][list[i]] = false;
        }
        delete _guardians[subject];
    }

    function _hasLiveRecovery(address subject) private view returns (bool) {
        RecoveryRequest storage request = recoveryRequests[subject];
        return request.exists && block.timestamp <= request.expiresAt;
    }

    function _hasOpenObligations(address subject) private view returns (bool) {
        if (escrowOracle != address(0) && ISubjectObligationOracle(escrowOracle).subjectHasOpenObligations(subject)) {
            return true;
        }
        if (votingOracle != address(0) && ISubjectObligationOracle(votingOracle).subjectHasOpenObligations(subject)) {
            return true;
        }
        return false;
    }
}
