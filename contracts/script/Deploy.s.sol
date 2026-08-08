// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

/// @notice 部署顺序：Registry → Hub → Escrow → Voting；随后授权与所有权移交。
///         所有权移交：escrow.transferOwnership(voting) 使社区裁决可驱动 escrow（论文版语义）。
contract Deploy is Script {
    function run() external returns (address, address, address, address) {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);

        AgentRegistry registry = new AgentRegistry();
        ReputationHub hub = new ReputationHub();
        GuaranteeEscrow escrow = new GuaranteeEscrow(address(registry), address(hub));
        SchellingVoting voting = new SchellingVoting(address(escrow)); // T6 修复后签名：仅 escrow

        hub.setAuthorizedCaller(address(escrow), true);
        hub.setAuthorizedCaller(address(voting), true);
        escrow.transferOwnership(address(voting)); // 社区裁决驱动 escrow

        vm.stopBroadcast();

        return (address(registry), address(hub), address(escrow), address(voting));
    }
}
