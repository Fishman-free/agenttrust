// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

contract Deploy is Script {
    function run() external returns (address, address, address, address) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        AgentRegistry registry = new AgentRegistry();
        ReputationHub hub = new ReputationHub();
        GuaranteeEscrow escrow = new GuaranteeEscrow(address(registry), address(hub));
        SchellingVoting voting = new SchellingVoting(address(escrow), address(registry));
        hub.setAuthorizedCaller(address(escrow), true);
        escrow.transferOwnership(address(voting));
        vm.stopBroadcast();
        return (address(registry), address(hub), address(escrow), address(voting));
    }
}
