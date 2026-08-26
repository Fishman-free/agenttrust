// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GuaranteeEscrow} from "./GuaranteeEscrow.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {ReputationHub} from "./ReputationHub.sol";

/// @notice Commit-reveal dispute voting with a hybrid jury: roughly half the seats are
/// grabbed first-come-first-served by eligible volunteers and half are drawn randomly from the
/// registration snapshot using a blockhash/RANDAO seed, so trade parties cannot stuff the panel.
contract SchellingVoting is Ownable, ReentrancyGuard {
    enum Side {
        BUYER,
        SELLER,
        ABSTAIN
    }
    uint256 public constant MIN_VOTERS = 3;
    uint256 public constant MAX_PHASE_WINDOW = 7 days;

    // Amount-scaled jury size (larger disputes seat a larger panel).
    uint256 public constant JURY_T1_AMOUNT = 1 ether;
    uint256 public constant JURY_T2_AMOUNT = 10 ether;
    uint256 public constant JURY_T3_AMOUNT = 50 ether;
    uint256 public constant JURY_T4_AMOUNT = 100 ether;
    uint256 public constant JURY_SIZE_T1 = 5;
    uint256 public constant JURY_SIZE_T2 = 7;
    uint256 public constant JURY_SIZE_T3 = 9;
    uint256 public constant JURY_SIZE_T4 = 11;
    uint256 public constant JURY_SIZE_T5 = 13;

    struct Case {
        bool exists;
        uint256 tradeId;
        uint256 stake;
        uint256 commitDeadline;
        uint256 randomCommitDeadline;
        uint256 revealDeadline;
        uint256 eligibilityAgentCount;
        uint256 jurySize;
        uint256 voluntarySeats;
        uint256 randomSeats;
        uint256 randomSeed;
        uint256 committedCount;
        uint256 votesForBuyer;
        uint256 votesForSeller;
        uint256 abstentions;
        uint256 randomInvitedCount;
        bool settled;
        bool effective;
        bool randomSelected;
        Side winner;
        mapping(address => bytes32) commitment;
        mapping(address => bool) hasCommitted;
        mapping(address => bool) revealed;
        mapping(address => Side) side;
        mapping(address => bool) claimed;
        mapping(address => bool) obligationCleared;
        mapping(address => bool) randomInvited;
    }

    struct CaseDetailsView {
        uint256 tradeId;
        uint256 stake;
        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 eligibilityAgentCount;
        uint256 committedCount;
        uint256 votesForBuyer;
        uint256 votesForSeller;
        uint256 abstentions;
        bool settled;
        bool effective;
        Side winner;
        uint256 jurySize;
        uint256 voluntarySeats;
        uint256 randomSeats;
        uint256 randomCommitDeadline;
        uint256 randomInvitedCount;
        bool randomSelected;
    }

    GuaranteeEscrow public immutable escrow;
    AgentRegistry public immutable registry;
    ReputationHub public immutable hub;
    uint256 public immutable caseStake;
    uint256 public immutable commitWindow;
    uint256 public immutable randomCommitWindow;
    uint256 public immutable revealWindow;
    uint256 public nextCaseId;
    uint256 public totalLiability;
    mapping(uint256 => Case) private _cases;
    mapping(uint256 => bool) public tradeHasCase;
    mapping(uint256 => uint256) public tradeCaseIdPlusOne;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => uint256) public openCommitmentCount;

    event CaseOpened(
        uint256 indexed caseId,
        uint256 indexed tradeId,
        uint256 stake,
        uint256 commitDeadline,
        uint256 revealDeadline,
        uint256 eligibilityAgentCount
    );
    event VoteCommitted(uint256 indexed caseId, address indexed subject, bytes32 commitment);
    event VoteRevealed(uint256 indexed caseId, address indexed subject, Side side);
    event CaseSettled(uint256 indexed caseId, Side winner, uint256 validVotes, bool effective);
    event WithdrawalCredited(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, address indexed recipient, uint256 amount);
    event JurorMetricsFinalized(
        uint256 indexed caseId,
        address indexed subject,
        bytes32 indexed jurorCaseId,
        bool revealed,
        bool abstained,
        bool effective,
        bool aligned
    );
    event RandomJurySelected(uint256 indexed caseId, uint256 invitedCount, uint256 seed);

    constructor(
        address escrow_,
        address registry_,
        address hub_,
        uint256 caseStake_,
        uint256 commitWindow_,
        uint256 randomCommitWindow_,
        uint256 revealWindow_
    ) Ownable(msg.sender) {
        require(
            escrow_ != address(0) && registry_ != address(0) && hub_ != address(0),
            unicode"SchellingVoting: 依赖地址为零"
        );
        require(caseStake_ != 0, unicode"SchellingVoting: 质押必须大于零");
        require(
            commitWindow_ != 0 && randomCommitWindow_ != 0 && revealWindow_ != 0,
            unicode"SchellingVoting: 窗口必须大于零"
        );
        require(
            commitWindow_ <= MAX_PHASE_WINDOW && randomCommitWindow_ <= MAX_PHASE_WINDOW
                && revealWindow_ <= MAX_PHASE_WINDOW,
            unicode"SchellingVoting: 窗口过长"
        );
        escrow = GuaranteeEscrow(escrow_);
        registry = AgentRegistry(registry_);
        hub = ReputationHub(hub_);
        caseStake = caseStake_;
        commitWindow = commitWindow_;
        randomCommitWindow = randomCommitWindow_;
        revealWindow = revealWindow_;
    }

    modifier existingCase(uint256 caseId) {
        require(_cases[caseId].exists, unicode"SchellingVoting: 案件不存在");
        _;
    }

    function openCase(uint256 tradeId) external nonReentrant returns (uint256 caseId) {
        require(!tradeHasCase[tradeId], unicode"SchellingVoting: 该交易已有案件");
        escrow.openArbitration(tradeId);
        caseId = nextCaseId++;
        tradeHasCase[tradeId] = true;
        tradeCaseIdPlusOne[tradeId] = caseId + 1;
        Case storage c = _cases[caseId];
        c.exists = true;
        c.tradeId = tradeId;
        c.stake = caseStake;
        c.jurySize = jurySizeForAmount(escrow.tradeAmount(tradeId));
        c.voluntarySeats = c.jurySize / 2; // floor(N/2)
        c.randomSeats = c.jurySize - c.jurySize / 2; // ceil(N/2)
        c.commitDeadline = block.timestamp + commitWindow;
        c.randomCommitDeadline = c.commitDeadline + randomCommitWindow;
        c.revealDeadline = c.randomCommitDeadline + revealWindow;
        c.eligibilityAgentCount = escrow.eligibilityAgentCount(tradeId);
        emit CaseOpened(caseId, tradeId, c.stake, c.commitDeadline, c.revealDeadline, c.eligibilityAgentCount);
    }

    function caseIdForTrade(uint256 tradeId) external view returns (uint256 caseId) {
        uint256 caseIdPlusOne = tradeCaseIdPlusOne[tradeId];
        require(caseIdPlusOne != 0, unicode"SchellingVoting: 交易无案件");
        return caseIdPlusOne - 1;
    }

    /// @notice Jury size for a dispute amount: larger exposures seat a larger panel.
    function jurySizeForAmount(uint256 amount) public pure returns (uint256) {
        if (amount <= JURY_T1_AMOUNT) return JURY_SIZE_T1;
        if (amount <= JURY_T2_AMOUNT) return JURY_SIZE_T2;
        if (amount <= JURY_T3_AMOUNT) return JURY_SIZE_T3;
        if (amount <= JURY_T4_AMOUNT) return JURY_SIZE_T4;
        return JURY_SIZE_T5;
    }

    /// @notice Derives the random seed and invites the random half of the jury after the
    /// volunteer commit window closes. Permissionless; blockhash/RANDAO is not manipulable by
    /// the trade parties (only a block proposer could theoretically bias it).
    function selectRandomJury(uint256 caseId) external nonReentrant existingCase(caseId) {
        Case storage c = _cases[caseId];
        require(!c.settled, unicode"SchellingVoting: 已结算");
        require(block.timestamp >= c.commitDeadline, unicode"SchellingVoting: 志愿窗口未结束");
        require(!c.randomSelected, unicode"SchellingVoting: 已抽取陪审团");
        c.randomSelected = true;
        uint256 seed = uint256(
            keccak256(
                abi.encode(
                    blockhash(block.number - 1), block.prevrandao, block.number, caseId, address(this), block.chainid
                )
            )
        );
        c.randomSeed = seed;
        uint256 count = c.eligibilityAgentCount;
        if (count != 0 && c.randomSeats != 0) {
            // Random rotation over the snapshot: scan from a seed-derived offset, visiting each
            // candidate at most once, so the panel fills whenever at least `randomSeats` eligible
            // subjects exist within the scanned window (with-replacement draws could leave seats
            // empty). Every eligible subject has equal inclusion odds.
            uint256 start = seed % count;
            uint256 maxAttempts = count < c.randomSeats * 10 ? count : c.randomSeats * 10;
            uint256 selected;
            for (uint256 step; step < maxAttempts && selected < c.randomSeats; ++step) {
                address subject = registry.subjectAt((start + step) % count);
                if (_randomEligible(c, subject)) {
                    c.randomInvited[subject] = true;
                    ++selected;
                }
            }
            c.randomInvitedCount = selected;
        }
        emit RandomJurySelected(caseId, c.randomInvitedCount, seed);
    }

    function _randomEligible(Case storage c, address subject) private view returns (bool) {
        if (subject == address(0) || c.hasCommitted[subject] || c.randomInvited[subject]) return false;
        if (!registry.isRegisteredSubjectAtCount(subject, c.eligibilityAgentCount)) return false;
        if (!hub.isJurorEligible(subject)) return false;
        if (!registry.isPoHVerified(subject)) return false;
        (address buyer, address seller, address guarantor) = escrow.tradeActors(c.tradeId);
        return subject != buyer && subject != seller && subject != guarantor;
    }

    function isRandomInvited(uint256 caseId, address subject) external view existingCase(caseId) returns (bool) {
        return _cases[caseId].randomInvited[subject];
    }

    /// @notice Full case view returned as one struct (a single stack slot), so the function
    /// compiles under every codegen mode, including `forge coverage --ir-minimum`.
    function caseDetails(uint256 caseId) external view existingCase(caseId) returns (CaseDetailsView memory details) {
        details = _caseDetails(caseId);
    }

    function _caseDetails(uint256 caseId) private view returns (CaseDetailsView memory details) {
        Case storage c = _cases[caseId];
        details.tradeId = c.tradeId;
        details.stake = c.stake;
        details.commitDeadline = c.commitDeadline;
        details.revealDeadline = c.revealDeadline;
        details.eligibilityAgentCount = c.eligibilityAgentCount;
        details.committedCount = c.committedCount;
        details.votesForBuyer = c.votesForBuyer;
        details.votesForSeller = c.votesForSeller;
        details.abstentions = c.abstentions;
        details.settled = c.settled;
        details.effective = c.effective;
        details.winner = c.winner;
        details.jurySize = c.jurySize;
        details.voluntarySeats = c.voluntarySeats;
        details.randomSeats = c.randomSeats;
        details.randomCommitDeadline = c.randomCommitDeadline;
        details.randomInvitedCount = c.randomInvitedCount;
        details.randomSelected = c.randomSelected;
    }

    function jurorStatus(uint256 caseId, address subject)
        external
        view
        existingCase(caseId)
        returns (bool committed, bool revealed, Side side, bool claimed)
    {
        Case storage c = _cases[caseId];
        return (c.hasCommitted[subject], c.revealed[subject], c.side[subject], c.claimed[subject]);
    }

    function caseResult(uint256 caseId) external view existingCase(caseId) returns (bool effective, Side winner) {
        Case storage c = _cases[caseId];
        return (c.effective, c.winner);
    }

    function subjectHasOpenCommitments(address subject) external view returns (bool) {
        return openCommitmentCount[subject] != 0;
    }

    function subjectHasOpenObligations(address subject) external view returns (bool) {
        return openCommitmentCount[subject] != 0;
    }

    function jurorObligationCleared(uint256 caseId, address subject) external view existingCase(caseId) returns (bool) {
        return _cases[caseId].obligationCleared[subject];
    }

    function voteCommitment(uint256 caseId, address subject, Side side, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, caseId, subject, side, salt));
    }

    function commitVote(uint256 caseId, bytes32 commitment) external payable nonReentrant existingCase(caseId) {
        Case storage c = _cases[caseId];
        require(!c.settled, unicode"SchellingVoting: 已结算");
        if (block.timestamp < c.commitDeadline) {
            require(c.committedCount < c.voluntarySeats, unicode"SchellingVoting: 自愿席已满");
        } else if (block.timestamp < c.randomCommitDeadline) {
            require(c.randomInvited[msg.sender], unicode"SchellingVoting: 非随机抽中陪审员");
        } else {
            revert(unicode"SchellingVoting: 提交窗口已结束");
        }
        require(
            registry.isRegisteredSubjectAtCount(msg.sender, c.eligibilityAgentCount),
            unicode"SchellingVoting: 不在资格快照中"
        );
        require(hub.isJurorEligible(msg.sender), unicode"SchellingVoting: 陪审员信誉不合格");
        require(registry.isPoHVerified(msg.sender), unicode"SchellingVoting: 陪审员需完成人类验证");
        (address buyer, address seller, address guarantor) = escrow.tradeActors(c.tradeId);
        require(
            msg.sender != buyer && msg.sender != seller && msg.sender != guarantor,
            unicode"SchellingVoting: 交易主体无投票资格"
        );
        require(!c.hasCommitted[msg.sender], unicode"SchellingVoting: 主体已提交");
        require(commitment != bytes32(0), unicode"SchellingVoting: 空承诺");
        require(msg.value == c.stake, unicode"SchellingVoting: 质押金额不符");
        c.hasCommitted[msg.sender] = true;
        c.commitment[msg.sender] = commitment;
        c.committedCount++;
        openCommitmentCount[msg.sender]++;
        totalLiability += msg.value;
        emit VoteCommitted(caseId, msg.sender, commitment);
    }

    function revealVote(uint256 caseId, Side side, bytes32 salt) external existingCase(caseId) {
        Case storage c = _cases[caseId];
        require(
            !c.settled && block.timestamp >= c.randomCommitDeadline && block.timestamp < c.revealDeadline,
            unicode"SchellingVoting: 不在揭示窗口"
        );
        require(c.hasCommitted[msg.sender], unicode"SchellingVoting: 未提交");
        require(!c.revealed[msg.sender], unicode"SchellingVoting: 已揭示");
        require(
            c.commitment[msg.sender] == voteCommitment(caseId, msg.sender, side, salt),
            unicode"SchellingVoting: 承诺不匹配"
        );
        c.revealed[msg.sender] = true;
        c.side[msg.sender] = side;
        if (side == Side.BUYER) c.votesForBuyer++;
        else if (side == Side.SELLER) c.votesForSeller++;
        else c.abstentions++;
        emit VoteRevealed(caseId, msg.sender, side);
    }

    function settle(uint256 caseId) external nonReentrant existingCase(caseId) {
        Case storage c = _cases[caseId];
        require(!c.settled, unicode"SchellingVoting: 已结算");
        require(block.timestamp >= c.revealDeadline, unicode"SchellingVoting: 揭示窗口未结束");
        c.settled = true;
        uint256 validVotes = c.votesForBuyer + c.votesForSeller;
        bool buyerTwoThirds = validVotes != 0 && c.votesForBuyer * 3 >= validVotes * 2;
        bool sellerTwoThirds = validVotes != 0 && c.votesForSeller * 3 >= validVotes * 2;
        if (validVotes >= MIN_VOTERS && (buyerTwoThirds || sellerTwoThirds)) {
            c.effective = true;
            c.winner = buyerTwoThirds ? Side.BUYER : Side.SELLER;
            uint256 winners = c.winner == Side.BUYER ? c.votesForBuyer : c.votesForSeller;
            uint256 slashed = c.committedCount - winners - c.abstentions;
            totalLiability -= (c.stake * slashed) % winners;
            escrow.resolveDispute(
                c.tradeId,
                c.winner == Side.BUYER ? GuaranteeEscrow.Verdict.BUYER_WINS : GuaranteeEscrow.Verdict.SELLER_WINS,
                c.winner == Side.BUYER ? 10000 : 0
            );
        } else {
            c.winner = Side.ABSTAIN;
            escrow.voidDispute(c.tradeId);
        }
        emit CaseSettled(caseId, c.winner, validVotes, c.effective);
    }

    /// @notice Permissionlessly records one committed juror's metrics after settlement.
    /// Metrics are intentionally finalized out of band so ReputationHub cannot block settlement.
    function finalizeJurorMetrics(uint256 caseId, address subject) external nonReentrant existingCase(caseId) {
        Case storage c = _cases[caseId];
        require(c.settled, unicode"SchellingVoting: 未结算");
        require(c.hasCommitted[subject], unicode"SchellingVoting: 主体未提交");
        bool revealed = c.revealed[subject];
        bool abstained = revealed && c.side[subject] == Side.ABSTAIN;
        bool effective = c.effective;
        bool aligned = effective && revealed && !abstained && c.side[subject] == c.winner;
        bytes32 jurorCaseId =
            keccak256(abi.encode("AGENTTRUST_JUROR_CASE_V1", address(this), block.chainid, caseId, subject));
        hub.recordJurorCase(jurorCaseId, subject, revealed, abstained, effective, aligned);
        _clearObligation(c, subject);
        emit JurorMetricsFinalized(caseId, subject, jurorCaseId, revealed, abstained, effective, aligned);
    }

    /// @notice Credits a pull-payment. Effective-case losers and non-revealers are slashed.
    function claim(uint256 caseId) external nonReentrant existingCase(caseId) {
        Case storage c = _cases[caseId];
        require(c.settled, unicode"SchellingVoting: 未结算");
        require(c.hasCommitted[msg.sender], unicode"SchellingVoting: 未提交");
        require(!c.claimed[msg.sender], unicode"SchellingVoting: 已领取");
        c.claimed[msg.sender] = true;
        uint256 amount;
        if (!c.effective) {
            amount = c.stake;
        } else if (c.revealed[msg.sender] && c.side[msg.sender] == Side.ABSTAIN) {
            amount = c.stake;
        } else if (c.revealed[msg.sender] && c.side[msg.sender] == c.winner) {
            uint256 winners = c.winner == Side.BUYER ? c.votesForBuyer : c.votesForSeller;
            uint256 slashed = c.committedCount - winners - c.abstentions;
            amount = c.stake + (c.stake * slashed) / winners;
        } else {
            revert(unicode"SchellingVoting: 质押已罚没");
        }
        _clearObligation(c, msg.sender);
        pendingWithdrawals[msg.sender] += amount;
        emit WithdrawalCredited(msg.sender, amount);
    }

    /// @notice Permissionlessly clears the identity-recovery obligation after settlement,
    /// independently from claimability or ReputationHub availability.
    function clearCommitmentObligation(uint256 caseId, address subject) external existingCase(caseId) {
        Case storage c = _cases[caseId];
        require(c.settled, unicode"SchellingVoting: 未结算");
        require(c.hasCommitted[subject], unicode"SchellingVoting: 主体未提交");
        _clearObligation(c, subject);
    }

    function _clearObligation(Case storage c, address subject) private {
        if (c.obligationCleared[subject]) return;
        c.obligationCleared[subject] = true;
        openCommitmentCount[subject]--;
    }

    function withdraw(address payable recipient) external nonReentrant {
        require(recipient != address(0), unicode"SchellingVoting: 收款地址为零");
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount != 0, unicode"SchellingVoting: 无可提取余额");
        pendingWithdrawals[msg.sender] = 0;
        totalLiability -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, unicode"SchellingVoting: 提取失败");
        emit Withdrawal(msg.sender, recipient, amount);
    }
}
