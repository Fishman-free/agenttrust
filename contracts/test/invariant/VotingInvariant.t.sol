// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {ReputationHub} from "../../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../../src/SchellingVoting.sol";
import {MockPoHVerifier} from "../mocks/MockPoHVerifier.sol";

contract VotingHandler is Test {
    SchellingVoting public immutable voting;
    uint256 public immutable caseId;
    uint256 public immutable stake;
    uint256 public immutable commitDeadline;
    uint256 public immutable randomCommitDeadline;
    uint256 public immutable revealDeadline;
    address[] internal jurors;

    uint256 public totalDeposits;
    uint256 public totalCredits;
    uint256 public totalWithdrawn;
    uint256 public settleSuccesses;
    mapping(address => uint256) public commitSuccesses;
    mapping(address => uint256) public revealSuccesses;
    mapping(address => uint256) public claimSuccesses;
    mapping(address => uint256) public withdrawSuccesses;
    mapping(address => uint256) public metricFinalizationSuccesses;
    mapping(address => SchellingVoting.Side) internal committedSide;
    mapping(address => bytes32) internal committedSalt;

    constructor(
        SchellingVoting voting_,
        uint256 caseId_,
        uint256 stake_,
        uint256 commitDeadline_,
        uint256 randomCommitDeadline_,
        uint256 revealDeadline_,
        address[] memory jurors_
    ) {
        voting = voting_;
        caseId = caseId_;
        stake = stake_;
        commitDeadline = commitDeadline_;
        randomCommitDeadline = randomCommitDeadline_;
        revealDeadline = revealDeadline_;
        jurors = jurors_;
    }

    function commit(uint256 jurorSeed, uint8 sideSeed, bytes32 salt) external {
        address juror = _juror(jurorSeed);
        SchellingVoting.Side side = SchellingVoting.Side(sideSeed % 3);
        if (salt == bytes32(0)) salt = bytes32(uint256(1));
        bytes32 commitment = voting.voteCommitment(caseId, juror, side, salt);
        vm.prank(juror);
        try voting.commitVote{value: stake}(caseId, commitment) {
            totalDeposits += stake;
            commitSuccesses[juror]++;
            committedSide[juror] = side;
            committedSalt[juror] = salt;
        } catch {}
    }

    function advanceToReveal() external {
        if (block.timestamp < randomCommitDeadline) vm.warp(randomCommitDeadline);
    }

    function reveal(uint256 jurorSeed) external {
        address juror = _juror(jurorSeed);
        vm.prank(juror);
        try voting.revealVote(caseId, committedSide[juror], committedSalt[juror]) {
            revealSuccesses[juror]++;
        } catch {}
    }

    function advanceToSettle() external {
        if (block.timestamp < revealDeadline) vm.warp(revealDeadline);
    }

    function settle() external {
        try voting.settle(caseId) {
            settleSuccesses++;
        } catch {}
    }

    function claim(uint256 jurorSeed) external {
        address juror = _juror(jurorSeed);
        uint256 beforeCredit = voting.pendingWithdrawals(juror);
        vm.prank(juror);
        try voting.claim(caseId) {
            uint256 credited = voting.pendingWithdrawals(juror) - beforeCredit;
            totalCredits += credited;
            claimSuccesses[juror]++;
        } catch {}
    }

    function withdraw(uint256 jurorSeed) external {
        address juror = _juror(jurorSeed);
        uint256 amount = voting.pendingWithdrawals(juror);
        vm.prank(juror);
        try voting.withdraw(payable(address(0xBEEF))) {
            totalWithdrawn += amount;
            withdrawSuccesses[juror]++;
        } catch {}
    }

    function finalizeMetrics(uint256 jurorSeed) external {
        address juror = _juror(jurorSeed);
        try voting.finalizeJurorMetrics(caseId, juror) {
            metricFinalizationSuccesses[juror]++;
        } catch {}
    }

    function jurorCount() external view returns (uint256) {
        return jurors.length;
    }

    function jurorAt(uint256 index) external view returns (address) {
        return jurors[index];
    }

    function _juror(uint256 seed) private view returns (address) {
        return jurors[seed % jurors.length];
    }
}

contract RevertingRecipient {
    receive() external payable {
        revert("reject");
    }
}

contract VotingInvariantTest is StdInvariant, Test {
    function _guardians() internal returns (address[] memory list) {
        list = new address[](2);
        list[0] = makeAddr("guardian-a");
        list[1] = makeAddr("guardian-b");
    }

    AgentRegistry internal registry;
    ReputationHub internal hub;
    GuaranteeEscrow internal escrow;
    SchellingVoting internal voting;
    VotingHandler internal handler;

    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    address internal guarantor = makeAddr("guarantor");
    address internal postCreationJuror = makeAddr("invariant post-dispute juror");
    address[] internal jurors;
    uint256 internal buyerId;
    uint256 internal sellerId;
    uint256 internal guarantorId;
    uint256 internal tradeId;
    uint256 internal caseId;
    uint256 internal openedAt;

    uint256 internal constant STAKE = 0.1 ether;
    bytes32 internal constant SALT = keccak256("invariant salt");

    function setUp() public {
        registry = new AgentRegistry();
        MockPoHVerifier verifier = new MockPoHVerifier();
        registry.setPoHVerifier(address(verifier));
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        escrow.setMaxOpenStake(type(uint256).max);
        voting = new SchellingVoting(address(escrow), address(registry), address(hub), STAKE, 1 days, 1 days, 1 days);
        hub.setOutcomeWriter(address(escrow), true);
        hub.setJurorMetricWriter(address(voting), true);
        escrow.transferOwnership(address(voting));

        vm.deal(buyer, 103.02 ether);
        vm.deal(seller, 1 ether);
        vm.deal(guarantor, 101 ether);
        vm.prank(buyer);
        buyerId = registry.registerAgent("Buyer", "", "", _guardians());
        vm.prank(seller);
        sellerId = registry.registerAgent("Seller", "", "", _guardians());
        vm.prank(guarantor);
        guarantorId =
            registry.registerAgentVerified("Guarantor", "", "", keccak256("human-guarantor"), hex"01", _guardians());
        for (uint256 i; i < 6; ++i) {
            address juror = makeAddr(string.concat("invariant juror ", vm.toString(i)));
            jurors.push(juror);
            vm.deal(juror, 2 ether);
            vm.prank(juror);
            registry.registerAgentVerified(
                "Juror", "", "", keccak256(abi.encode("human-juror", i)), hex"01", _guardians()
            );
        }

        vm.prank(buyer);
        tradeId = escrow.createTrade(buyerId, sellerId, 101 ether, 20 ether);
        vm.deal(postCreationJuror, 2 ether);
        vm.prank(postCreationJuror);
        registry.registerAgentVerified(
            "Post-creation Juror", "", "", keccak256("human-post-juror"), hex"01", _guardians()
        );
        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 101 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 101 ether}(tradeId, guarantorId, 1e18, 15 ether);
        vm.prank(seller);
        escrow.acceptGuarantee(tradeId);
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute{value: 2.02 ether}(tradeId);

        vm.warp(block.timestamp + escrow.EVIDENCE_WINDOW() + 1);
        openedAt = block.timestamp;
        vm.prank(makeAddr("invariant opener"));
        caseId = voting.openCase(tradeId);
        address[] memory handlerJurors = jurors;
        handler = new VotingHandler(
            voting, caseId, STAKE, openedAt + 1 days, openedAt + 2 days, openedAt + 3 days, handlerJurors
        );

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.commit.selector;
        selectors[1] = handler.advanceToReveal.selector;
        selectors[2] = handler.reveal.selector;
        selectors[3] = handler.advanceToSettle.selector;
        selectors[4] = handler.settle.selector;
        selectors[5] = handler.claim.selector;
        selectors[6] = handler.withdraw.selector;
        selectors[7] = handler.finalizeMetrics.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_balanceAlwaysCoversObservableLiability() public view {
        assertGe(address(voting).balance, voting.totalLiability());
    }

    function invariant_creditsAndWithdrawalsNeverExceedDeposits() public view {
        assertLe(handler.totalCredits(), handler.totalDeposits());
        assertLe(handler.totalWithdrawn(), handler.totalCredits());
        assertLe(handler.totalWithdrawn(), handler.totalDeposits());
    }

    function invariant_pendingCreditsMatchGhostAccounting() public view {
        uint256 aggregatePending;
        for (uint256 i; i < jurors.length; ++i) {
            aggregatePending += voting.pendingWithdrawals(jurors[i]);
        }
        assertEq(aggregatePending, handler.totalCredits() - handler.totalWithdrawn());
    }

    function invariant_oneSubjectVoteAndNoDoubleActions() public view {
        for (uint256 i; i < jurors.length; ++i) {
            address juror = jurors[i];
            assertLe(handler.commitSuccesses(juror), 1);
            assertLe(handler.revealSuccesses(juror), 1);
            assertLe(handler.claimSuccesses(juror), 1);
            assertLe(handler.withdrawSuccesses(juror), 1);
            assertLe(handler.metricFinalizationSuccesses(juror), 1);
        }
        assertLe(handler.settleSuccesses(), 1);
    }

    function invariant_oneCasePerTrade() public view {
        assertEq(escrow.nextTradeId(), 1);
        assertEq(voting.nextCaseId(), 1);
        assertTrue(voting.tradeHasCase(tradeId));
    }

    function test_creationSnapshotCannotBeExpandedBeforePermissionlessOpening() public {
        bytes32 lateCommitment = voting.voteCommitment(caseId, postCreationJuror, SchellingVoting.Side.BUYER, SALT);
        vm.prank(postCreationJuror);
        vm.expectRevert(unicode"SchellingVoting: 不在资格快照中");
        voting.commitVote{value: STAKE}(caseId, lateCommitment);

        _commit(jurors[0], SchellingVoting.Side.BUYER);
    }

    function test_oneTradeCannotOpenTwoCases() public {
        vm.expectRevert(unicode"SchellingVoting: 该交易已有案件");
        voting.openCase(tradeId);
    }

    function test_unrevealedVotesAreExcludedFromQuorumAndThreshold() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        _commit(jurors[1], SchellingVoting.Side.BUYER);
        _commit(jurors[2], SchellingVoting.Side.BUYER);
        _commit(jurors[3], SchellingVoting.Side.SELLER);
        _commit(jurors[4], SchellingVoting.Side.SELLER);
        vm.warp(openedAt + 2 days);
        _reveal(jurors[0], SchellingVoting.Side.BUYER);
        _reveal(jurors[1], SchellingVoting.Side.BUYER);
        _reveal(jurors[2], SchellingVoting.Side.BUYER);
        vm.warp(openedAt + 3 days);
        voting.settle(caseId);

        (bool effective, SchellingVoting.Side winner) = voting.caseResult(caseId);
        assertTrue(effective);
        assertEq(uint8(winner), uint8(SchellingVoting.Side.BUYER));
    }

    function test_ineffectiveVoidDoesNotChangeReputation() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        _commit(jurors[1], SchellingVoting.Side.BUYER);
        vm.warp(openedAt + 3 days);
        voting.settle(caseId);

        (uint256 completed, uint256 defaulted, uint256 won, uint256 lost) = hub.reputation(sellerId);
        assertEq(completed, 0);
        assertEq(defaulted, 0);
        assertEq(won, 0);
        assertEq(lost, 0);
        assertEq(uint8(escrow.tradeState(tradeId)), uint8(GuaranteeEscrow.State.VOIDED));
    }

    function test_claimMovesLiabilityInternallyAndRoundingDustIsSurplus() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        _commit(jurors[1], SchellingVoting.Side.BUYER);
        _commit(jurors[2], SchellingVoting.Side.BUYER);
        _commit(jurors[3], SchellingVoting.Side.SELLER);
        vm.warp(openedAt + 2 days);
        _reveal(jurors[0], SchellingVoting.Side.BUYER);
        _reveal(jurors[1], SchellingVoting.Side.BUYER);
        _reveal(jurors[2], SchellingVoting.Side.BUYER);
        _reveal(jurors[3], SchellingVoting.Side.SELLER);
        vm.warp(openedAt + 3 days);
        voting.settle(caseId);

        uint256 dust = STAKE % 3;
        assertEq(voting.totalLiability(), 4 * STAKE - dust);
        assertEq(address(voting).balance - voting.totalLiability(), dust);
        uint256 liabilityBeforeClaim = voting.totalLiability();
        vm.prank(jurors[0]);
        voting.claim(caseId);
        assertEq(voting.totalLiability(), liabilityBeforeClaim);
    }

    function test_maliciousRecipientFailureDoesNotBlockOwnerWithdrawal() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        vm.warp(openedAt + 3 days);
        voting.settle(caseId);
        vm.prank(jurors[0]);
        voting.claim(caseId);

        RevertingRecipient malicious = new RevertingRecipient();
        uint256 liabilityBefore = voting.totalLiability();
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 提取失败");
        voting.withdraw(payable(address(malicious)));
        assertEq(voting.pendingWithdrawals(jurors[0]), STAKE);
        assertEq(voting.totalLiability(), liabilityBefore);

        address payable safeRecipient = payable(makeAddr("safe recipient"));
        vm.prank(jurors[0]);
        voting.withdraw(safeRecipient);
        assertEq(safeRecipient.balance, STAKE);
        assertEq(voting.pendingWithdrawals(jurors[0]), 0);
        assertEq(voting.totalLiability(), liabilityBefore - STAKE);
    }

    function test_noDoubleSettleClaimOrWithdraw() public {
        _commit(jurors[0], SchellingVoting.Side.BUYER);
        vm.warp(openedAt + 3 days);
        voting.settle(caseId);
        vm.expectRevert(unicode"SchellingVoting: 已结算");
        voting.settle(caseId);

        vm.prank(jurors[0]);
        voting.claim(caseId);
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 已领取");
        voting.claim(caseId);

        vm.prank(jurors[0]);
        voting.withdraw(payable(jurors[0]));
        vm.prank(jurors[0]);
        vm.expectRevert(unicode"SchellingVoting: 无可提取余额");
        voting.withdraw(payable(jurors[0]));
    }

    function _commit(address juror, SchellingVoting.Side side) private {
        bytes32 commitment = voting.voteCommitment(caseId, juror, side, SALT);
        vm.prank(juror);
        voting.commitVote{value: STAKE}(caseId, commitment);
    }

    function _reveal(address juror, SchellingVoting.Side side) private {
        vm.prank(juror);
        voting.revealVote(caseId, side, SALT);
    }
}
