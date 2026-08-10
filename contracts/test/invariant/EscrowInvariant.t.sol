// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {ReputationHub} from "../../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../../src/GuaranteeEscrow.sol";

contract RejectEther {
    receive() external payable {
        revert("reject ether");
    }
}

contract LiabilityObserver {
    GuaranteeEscrow private immutable escrow;
    bool public invariantHeld;

    constructor(GuaranteeEscrow escrow_) {
        escrow = escrow_;
    }

    receive() external payable {
        invariantHeld = address(escrow).balance >= escrow.totalLiability();
    }
}

contract EscrowHandler is Test {
    AgentRegistry public immutable registry;
    ReputationHub public immutable hub;
    GuaranteeEscrow public immutable escrow;
    RejectEther public immutable rejectEther;

    address public immutable buyer;
    address public immutable seller;
    address public immutable guarantor;
    uint256 public immutable buyerId;
    uint256 public immutable sellerId;
    uint256 public immutable guarantorId;

    uint256[] public tradeIds;
    mapping(uint256 => uint256) public terminalTransitions;
    mapping(uint256 => uint256) public reputationTransitions;
    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;
    uint256 public failedMaliciousWithdrawals;
    bool public failedWithdrawalPreservationHolds = true;

    constructor(AgentRegistry registry_, ReputationHub hub_, GuaranteeEscrow escrow_) {
        registry = registry_;
        hub = hub_;
        escrow = escrow_;
        rejectEther = new RejectEther();
        buyer = makeAddr("invariant buyer");
        seller = makeAddr("invariant seller");
        guarantor = makeAddr("invariant guarantor");
        vm.deal(buyer, type(uint128).max);
        vm.deal(guarantor, type(uint128).max);
        vm.prank(buyer);
        buyerId = registry.registerAgent("Buyer", "", "");
        vm.prank(seller);
        sellerId = registry.registerAgent("Seller", "", "");
        vm.prank(guarantor);
        guarantorId = registry.registerAgent("Guarantor", "", "");
    }

    function tradeCount() external view returns (uint256) {
        return tradeIds.length;
    }

    function create(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 10 ether);
        vm.prank(buyer);
        uint256 tradeId = escrow.createTrade(buyerId, sellerId, amount);
        tradeIds.push(tradeId);
    }

    function advance(uint256 seed, uint8 choice) external {
        if (tradeIds.length == 0) return;
        uint256 tradeId = tradeIds[seed % tradeIds.length];
        GuaranteeEscrow.State beforeState = escrow.tradeState(tradeId);

        if (beforeState == GuaranteeEscrow.State.CREATED) {
            vm.prank(seller);
            try escrow.acceptTrade(tradeId) {} catch {}
        } else if (beforeState == GuaranteeEscrow.State.ACCEPTED) {
            uint256 amount = _amount(tradeId);
            vm.prank(buyer);
            try escrow.fund{value: amount}(tradeId) {
                ghostDeposited += amount;
            } catch {}
        } else if (beforeState == GuaranteeEscrow.State.FUNDED) {
            uint256 amount = _amount(tradeId);
            vm.prank(guarantor);
            try escrow.guarantee{value: amount}(tradeId, guarantorId, 1e18, amount / 10) {
                ghostDeposited += amount;
            } catch {}
        } else if (beforeState == GuaranteeEscrow.State.GUARANTEE_OFFERED) {
            vm.prank(seller);
            try escrow.acceptGuarantee(tradeId) {} catch {}
        } else if (beforeState == GuaranteeEscrow.State.GUARANTEED) {
            vm.prank(seller);
            try escrow.deliver(tradeId) {} catch {}
        } else if (beforeState == GuaranteeEscrow.State.DELIVERED) {
            if (choice % 2 == 0) {
                vm.prank(buyer);
                try escrow.confirm(tradeId) {} catch {}
            } else {
                vm.prank(buyer);
                try escrow.dispute(tradeId) {} catch {}
            }
        } else if (beforeState == GuaranteeEscrow.State.DISPUTED) {
            vm.prank(escrow.owner());
            try escrow.openArbitration(tradeId) {} catch {}
            vm.prank(escrow.owner());
            GuaranteeEscrow.Verdict verdict = GuaranteeEscrow.Verdict(choice % 3);
            try escrow.resolveDispute(tradeId, verdict, uint256(choice) * 10000 / type(uint8).max) {} catch {}
        }
        _observeTerminal(tradeId, beforeState);
    }

    function timeout(uint256 seed) external {
        if (tradeIds.length == 0) return;
        uint256 tradeId = tradeIds[seed % tradeIds.length];
        GuaranteeEscrow.State beforeState = escrow.tradeState(tradeId);
        vm.warp(block.timestamp + 2 days + 1);

        if (beforeState == GuaranteeEscrow.State.CREATED) {
            try escrow.timeoutCancelUnaccepted(tradeId) {} catch {}
        } else if (beforeState == GuaranteeEscrow.State.ACCEPTED) {
            try escrow.timeoutCancelUnfunded(tradeId) {} catch {}
        } else if (beforeState == GuaranteeEscrow.State.FUNDED || beforeState == GuaranteeEscrow.State.GUARANTEED) {
            try escrow.timeoutRefund(tradeId) {} catch {}
        } else if (beforeState == GuaranteeEscrow.State.GUARANTEE_OFFERED) {
            try escrow.timeoutRejectGuarantee(tradeId) {} catch {}
        } else if (beforeState == GuaranteeEscrow.State.DELIVERED) {
            try escrow.timeoutAutoRelease(tradeId) {} catch {}
        } else if (beforeState == GuaranteeEscrow.State.DISPUTED) {
            try escrow.timeoutVoidDispute(tradeId) {} catch {}
        }
        _observeTerminal(tradeId, beforeState);
    }

    function withdraw(uint8 actorSeed, bool maliciousRecipient) external {
        address actor = _actor(actorSeed);
        uint256 creditBefore = escrow.pendingWithdrawals(actor);
        uint256 liabilityBefore = escrow.totalLiability();
        if (creditBefore == 0) return;
        address payable recipient = maliciousRecipient ? payable(address(rejectEther)) : payable(actor);
        vm.prank(actor);
        try escrow.withdraw(recipient) {
            ghostWithdrawn += creditBefore;
        } catch {
            if (maliciousRecipient) {
                failedMaliciousWithdrawals++;
                if (escrow.pendingWithdrawals(actor) != creditBefore || escrow.totalLiability() != liabilityBefore) {
                    failedWithdrawalPreservationHolds = false;
                }
            }
        }
    }

    function attemptSecondSettlement(uint256 seed) external {
        if (tradeIds.length == 0) return;
        uint256 tradeId = tradeIds[seed % tradeIds.length];
        GuaranteeEscrow.State beforeState = escrow.tradeState(tradeId);
        if (!_isTerminal(beforeState)) return;
        vm.prank(buyer);
        try escrow.confirm(tradeId) {} catch {}
        try escrow.timeoutAutoRelease(tradeId) {} catch {}
        vm.prank(escrow.owner());
        try escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.BUYER_WINS, 10000) {} catch {}
        vm.prank(escrow.owner());
        try escrow.voidDispute(tradeId) {} catch {}
        _observeTerminal(tradeId, beforeState);
    }

    function _observeTerminal(uint256 tradeId, GuaranteeEscrow.State beforeState) private {
        GuaranteeEscrow.State afterState = escrow.tradeState(tradeId);
        if (!_isTerminal(beforeState) && _isTerminal(afterState)) {
            terminalTransitions[tradeId]++;
            bytes32 outcomeId = keccak256(abi.encode(address(escrow), tradeId));
            if (hub.recordedOutcomes(outcomeId)) reputationTransitions[tradeId]++;
        }
    }

    function _isTerminal(GuaranteeEscrow.State state) private pure returns (bool) {
        return state == GuaranteeEscrow.State.RELEASED || state == GuaranteeEscrow.State.RESOLVED
            || state == GuaranteeEscrow.State.VOIDED;
    }

    function _amount(uint256 tradeId) private view returns (uint256) {
        return escrow.requiredStake(tradeId, 1e18);
    }

    function _actor(uint8 seed) private view returns (address) {
        if (seed % 3 == 0) return buyer;
        if (seed % 3 == 1) return seller;
        return guarantor;
    }
}

contract EscrowInvariantTest is StdInvariant, Test {
    AgentRegistry registry;
    ReputationHub hub;
    GuaranteeEscrow escrow;
    EscrowHandler handler;

    function setUp() public {
        registry = new AgentRegistry();
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        hub.setAuthorizedCaller(address(escrow), true);
        handler = new EscrowHandler(registry, hub, escrow);

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = handler.create.selector;
        selectors[1] = handler.advance.selector;
        selectors[2] = handler.timeout.selector;
        selectors[3] = handler.withdraw.selector;
        selectors[4] = handler.attemptSecondSettlement.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_balanceCoversObservableLiability() public view {
        assertGe(address(escrow).balance, escrow.totalLiability());
    }

    function invariant_withdrawalsSynchronizeLiability() public view {
        assertEq(escrow.totalLiability(), handler.ghostDeposited() - handler.ghostWithdrawn());
    }

    function invariant_terminalTradesSettleAndRecordAtMostOnce() public view {
        uint256 count = handler.tradeCount();
        for (uint256 i; i < count; ++i) {
            uint256 tradeId = handler.tradeIds(i);
            assertLe(handler.terminalTransitions(tradeId), 1);
            assertLe(handler.reputationTransitions(tradeId), 1);
            bytes32 outcomeId = keccak256(abi.encode(address(escrow), tradeId));
            GuaranteeEscrow.State state = escrow.tradeState(tradeId);
            bool recorded = hub.recordedOutcomes(outcomeId);
            if (state == GuaranteeEscrow.State.RELEASED || state == GuaranteeEscrow.State.RESOLVED) {
                assertTrue(recorded);
            } else if (state == GuaranteeEscrow.State.VOIDED) {
                assertFalse(recorded);
            }
            if (recorded) assertEq(handler.reputationTransitions(tradeId), 1);
        }
    }

    function invariant_failedMaliciousWithdrawPreservesCredit() public view {
        assertTrue(handler.failedWithdrawalPreservationHolds());
    }
}

contract EscrowLivenessScenarioTest is Test {
    AgentRegistry registry;
    ReputationHub hub;
    GuaranteeEscrow escrow;
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address guarantor = makeAddr("guarantor");
    uint256 buyerId;
    uint256 sellerId;
    uint256 guarantorId;

    function setUp() public {
        registry = new AgentRegistry();
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        hub.setAuthorizedCaller(address(escrow), true);
        vm.deal(buyer, 100 ether);
        vm.deal(guarantor, 100 ether);
        vm.prank(buyer);
        buyerId = registry.registerAgent("Buyer", "", "");
        vm.prank(seller);
        sellerId = registry.registerAgent("Seller", "", "");
        vm.prank(guarantor);
        guarantorId = registry.registerAgent("Guarantor", "", "");
    }

    function test_livenessTimeoutExitsPreDeliveryStates() public {
        uint256 created = _create();
        vm.warp(block.timestamp + escrow.ACCEPT_WINDOW() + 1);
        escrow.timeoutCancelUnaccepted(created);
        assertEq(uint8(escrow.tradeState(created)), uint8(GuaranteeEscrow.State.VOIDED));

        uint256 accepted = _create();
        vm.prank(seller);
        escrow.acceptTrade(accepted);
        vm.warp(block.timestamp + escrow.FUND_WINDOW() + 1);
        escrow.timeoutCancelUnfunded(accepted);
        assertEq(uint8(escrow.tradeState(accepted)), uint8(GuaranteeEscrow.State.VOIDED));

        uint256 funded = _funded();
        vm.warp(block.timestamp + escrow.GUARANTEE_WINDOW() + 1);
        escrow.timeoutRefund(funded);
        assertEq(uint8(escrow.tradeState(funded)), uint8(GuaranteeEscrow.State.VOIDED));

        uint256 offered = _offered();
        vm.warp(block.timestamp + escrow.GUARANTEE_ACCEPT_WINDOW() + 1);
        escrow.timeoutRejectGuarantee(offered);
        assertEq(uint8(escrow.tradeState(offered)), uint8(GuaranteeEscrow.State.VOIDED));
    }

    function test_livenessTimeoutExitsAcceptedGuaranteeAndDelivery() public {
        uint256 guaranteed = _guaranteed();
        vm.warp(block.timestamp + escrow.DELIVER_WINDOW() + 1);
        escrow.timeoutRefund(guaranteed);
        assertEq(uint8(escrow.tradeState(guaranteed)), uint8(GuaranteeEscrow.State.RESOLVED));

        uint256 delivered = _delivered();
        vm.warp(block.timestamp + escrow.CONFIRM_WINDOW() + 1);
        escrow.timeoutAutoRelease(delivered);
        assertEq(uint8(escrow.tradeState(delivered)), uint8(GuaranteeEscrow.State.RELEASED));
    }

    function test_livenessDisputeCanExitWithOrWithoutOpenedCase() public {
        uint256 unopened = _disputed();
        vm.warp(block.timestamp + escrow.CASE_OPEN_WINDOW() + 1);
        escrow.timeoutVoidDispute(unopened);
        assertEq(uint8(escrow.tradeState(unopened)), uint8(GuaranteeEscrow.State.VOIDED));

        uint256 opened = _disputed();
        escrow.openArbitration(opened);
        escrow.voidDispute(opened);
        assertEq(uint8(escrow.tradeState(opened)), uint8(GuaranteeEscrow.State.VOIDED));
    }

    function test_failedRecipientPreservesCreditAndLiability() public {
        uint256 tradeId = _delivered();
        vm.prank(buyer);
        escrow.confirm(tradeId);
        RejectEther recipient = new RejectEther();
        uint256 credit = escrow.pendingWithdrawals(seller);
        uint256 liability = escrow.totalLiability();

        vm.prank(seller);
        vm.expectRevert(unicode"GuaranteeEscrow: 提取失败");
        escrow.withdraw(payable(address(recipient)));

        assertEq(escrow.pendingWithdrawals(seller), credit);
        assertEq(escrow.totalLiability(), liability);
    }

    function test_balanceInvariantHoldsDuringRecipientCallback() public {
        uint256 tradeId = _delivered();
        vm.prank(buyer);
        escrow.confirm(tradeId);
        LiabilityObserver recipient = new LiabilityObserver(escrow);

        vm.prank(seller);
        escrow.withdraw(payable(address(recipient)));

        assertTrue(recipient.invariantHeld());
    }

    function _create() private returns (uint256 tradeId) {
        vm.prank(buyer);
        tradeId = escrow.createTrade(buyerId, sellerId, 1 ether);
    }

    function _funded() private returns (uint256 tradeId) {
        tradeId = _create();
        vm.prank(seller);
        escrow.acceptTrade(tradeId);
        vm.prank(buyer);
        escrow.fund{value: 1 ether}(tradeId);
    }

    function _offered() private returns (uint256 tradeId) {
        tradeId = _funded();
        vm.prank(guarantor);
        escrow.guarantee{value: 1 ether}(tradeId, guarantorId, 1e18, 0.1 ether);
    }

    function _guaranteed() private returns (uint256 tradeId) {
        tradeId = _offered();
        vm.prank(seller);
        escrow.acceptGuarantee(tradeId);
    }

    function _delivered() private returns (uint256 tradeId) {
        tradeId = _guaranteed();
        vm.prank(seller);
        escrow.deliver(tradeId);
    }

    function _disputed() private returns (uint256 tradeId) {
        tradeId = _delivered();
        vm.prank(buyer);
        escrow.dispute(tradeId);
    }
}
