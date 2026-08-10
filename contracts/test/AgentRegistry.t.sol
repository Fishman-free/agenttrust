// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract RejectEther is IERC721Receiver {
    receive() external payable { revert("no ether"); }

    function register(AgentRegistry registry) external payable returns (uint256) {
        return registry.registerAgent{value: msg.value}("ContractAgent", "desc", "endpoint");
    }

    function withdraw(AgentRegistry registry, address payable recipient) external {
        registry.withdraw(recipient);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract AgentRegistryTest is Test {
    AgentRegistry registry;
    address alice = makeAddr("alice");

    function setUp() public {
        registry = new AgentRegistry();
        vm.deal(alice, 10 ether);
    }

    function test_registrationBindsImmutableResponsibleSubjectAndSnapshot() public {
        vm.prank(alice);
        uint256 id = registry.registerAgent("Agent", "desc", "endpoint");
        uint256 registeredBlock = block.number;

        assertEq(registry.ownerOf(id), alice);
        assertEq(registry.responsibleParty(id), alice);
        assertTrue(registry.isRegisteredSubjectAt(alice, registeredBlock));
        assertFalse(registry.isRegisteredSubjectAt(alice, registeredBlock - 1));

        vm.prank(alice);
        registry.transferFrom(alice, makeAddr("buyer"), id);
        assertEq(registry.responsibleParty(id), alice, "NFT transfer must not rewrite legal subject");
    }

    function test_overpaymentUsesPullPaymentAndCannotDosRegistration() public {
        registry.setRegistrationFee(1 ether);
        RejectEther rejector = new RejectEther();
        vm.deal(address(rejector), 2 ether);

        rejector.register{value: 2 ether}(registry);
        assertEq(registry.pendingWithdrawals(address(rejector)), 1 ether);
        assertEq(registry.accruedFees(), 1 ether);

        address recipient = makeAddr("recipient");
        rejector.withdraw(registry, payable(recipient));
        assertEq(recipient.balance, 1 ether);
    }

    function test_ownerFeesAreCreditedBeforeWithdrawal() public {
        registry.setRegistrationFee(1 ether);
        vm.prank(alice);
        registry.registerAgent{value: 1 ether}("Agent", "desc", "endpoint");

        registry.withdrawFees();
        assertEq(registry.accruedFees(), 0);
        assertEq(registry.pendingWithdrawals(address(this)), 1 ether);

        registry.withdraw(payable(alice));
        assertEq(alice.balance, 10 ether);
    }

    function test_nonexistentAgentRejected() public {
        vm.expectRevert();
        registry.responsibleParty(0);
    }
}
