// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";
import {Deploy} from "../script/Deploy.s.sol";

contract DeployTest is Test {
    uint256 internal constant ANVIL_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function test_deploymentWiresDependenciesRolesAndOwnership() public {
        AgentRegistry registry = new AgentRegistry();
        ReputationHub hub = new ReputationHub();
        GuaranteeEscrow escrow = new GuaranteeEscrow(address(registry), address(hub));
        SchellingVoting voting =
            new SchellingVoting(address(escrow), address(registry), address(hub), 0.1 ether, 1 days, 1 days);

        hub.setOutcomeWriter(address(escrow), true);
        hub.setJurorMetricWriter(address(voting), true);
        escrow.transferOwnership(address(voting));
        registry.setObligationOracles(address(escrow), address(voting));
        registry.setRegistrationDeposit(0.01 ether);

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
        assertEq(registry.escrowOracle(), address(escrow));
        assertEq(registry.votingOracle(), address(voting));
        assertEq(registry.registrationDeposit(), 0.01 ether);
    }

    function test_deployEnvConfiguration() public {
        vm.setEnv("PRIVATE_KEY", vm.toString(ANVIL_KEY));
        vm.setEnv("POH_VERIFIER", vm.toString(address(0)));

        Deploy script = new Deploy();
        (address registryAddress,, address escrowAddress,) = script.run();
        assertNotEq(AgentRegistry(registryAddress).pohVerifier(), address(0), "anvil must get a dev PoH verifier");
        assertEq(GuaranteeEscrow(escrowAddress).maxOpenStake(), 5 ether, "default exposure cap");

        // 同一测试内覆盖 env 并再次运行脚本（跨测试 env 缓存行为不可靠，不跨测试断言覆盖）。
        vm.setEnv("MAX_OPEN_STAKE", "6000000000000000000");
        (,, escrowAddress,) = script.run();
        assertEq(GuaranteeEscrow(escrowAddress).maxOpenStake(), 6 ether, "MAX_OPEN_STAKE override");

        address configured = makeAddr("configured poh verifier");
        vm.setEnv("POH_VERIFIER", vm.toString(configured));
        (registryAddress,,,) = script.run();
        assertEq(AgentRegistry(registryAddress).pohVerifier(), configured, "POH_VERIFIER override");
    }
}
