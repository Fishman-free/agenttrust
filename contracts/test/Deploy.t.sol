// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

contract DeployTest is Test {
    function test_deploymentWiresDependenciesRolesAndOwnership() public {
        AgentRegistry registry = new AgentRegistry();
        ReputationHub hub = new ReputationHub();
        GuaranteeEscrow escrow = new GuaranteeEscrow(address(registry), address(hub));
        SchellingVoting voting =
            new SchellingVoting(address(escrow), address(registry), address(hub), 0.1 ether, 1 days, 1 days);

        hub.setOutcomeWriter(address(escrow), true);
        hub.setJurorMetricWriter(address(voting), true);
        escrow.transferOwnership(address(voting));

        assertEq(address(escrow.registry()), address(registry));
        assertEq(address(escrow.hub()), address(hub));
        assertEq(address(voting.escrow()), address(escrow));
        assertEq(address(voting.registry()), address(registry));
        assertEq(address(voting.hub()), address(hub));
        assertEq(voting.caseStake(), 0.1 ether);
        assertEq(voting.commitWindow(), 1 days);
        assertEq(voting.revealWindow(), 1 days);
        assertTrue(hub.outcomeWriters(address(escrow)));
        assertTrue(hub.jurorMetricWriters(address(voting)));
        assertEq(escrow.owner(), address(voting));
    }
}
