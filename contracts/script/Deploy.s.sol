// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

/// @notice Development-only PoH verifier for local Anvil (chain 31337).
/// Accepts any non-empty proof; each nullifier can be consumed once.
/// Never deploy this on a public network — use POH_VERIFIER with the real World ID adapter.
contract AnvilDevPoHVerifier {
    mapping(bytes32 => bool) public consumed;

    function verifyAndConsume(address, bytes32 nullifier, bytes calldata proof) external returns (bool) {
        if (proof.length == 0 || consumed[nullifier]) return false;
        consumed[nullifier] = true;
        return true;
    }

    function verifySameIdentity(bytes32, address, bytes calldata proof) external returns (bool) {
        return proof.length != 0;
    }
}

contract Deploy is Script {
    function run() external returns (address, address, address, address) {
        // 所有 env 读取必须在 startBroadcast 之前完成（广播模拟上下文不继承测试 cheatcode 环境）。
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint256 registrationDeposit = vm.envOr("REGISTRATION_DEPOSIT", uint256(0.01 ether));
        uint256 maxOpenStake = vm.envOr("MAX_OPEN_STAKE", uint256(5 ether));
        address pohVerifier = vm.envOr("POH_VERIFIER", address(0));
        bool devVerifier = pohVerifier == address(0) && block.chainid == 31337;

        vm.startBroadcast(pk);
        AgentRegistry registry = new AgentRegistry();
        ReputationHub hub = new ReputationHub();
        GuaranteeEscrow escrow = new GuaranteeEscrow(address(registry), address(hub));
        SchellingVoting voting =
            new SchellingVoting(address(escrow), address(registry), address(hub), 0.1 ether, 1 days, 1 days);
        hub.setOutcomeWriter(address(escrow), true);
        hub.setJurorMetricWriter(address(voting), true);
        // Guarantor exposure cap: per-subject total open stakes (operators tune via MAX_OPEN_STAKE).
        escrow.setMaxOpenStake(maxOpenStake);
        escrow.transferOwnership(address(voting));
        registry.setObligationOracles(address(escrow), address(voting));
        // Fully refundable anti-Sybil deposit. Operators set REGISTRATION_DEPOSIT explicitly.
        registry.setRegistrationDeposit(registrationDeposit);
        // Optional PoH verifier. 0 = disabled (plain channel only, no recovery).
        // Local Anvil gets a dev verifier so the verified channel and recovery paths are exercisable.
        if (devVerifier) {
            pohVerifier = address(new AnvilDevPoHVerifier());
        }
        if (pohVerifier != address(0)) {
            registry.setPoHVerifier(pohVerifier);
        }
        vm.stopBroadcast();
        return (address(registry), address(hub), address(escrow), address(voting));
    }
}
