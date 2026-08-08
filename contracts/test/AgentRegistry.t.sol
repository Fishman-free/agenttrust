// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry registry;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    // forge 中部署者为测试合约自身，withdrawFees 需要 owner 能接收 ETH
    receive() external payable {}

    function setUp() public {
        registry = new AgentRegistry();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        // Foundry 默认给测试合约（= owner）2^96-1 wei，清零以对齐 withdraw 断言
        vm.deal(address(this), 0);
    }

    function test_registerAgent_mintsAndBindsOwner() public {
        vm.prank(alice);
        uint256 tokenId = registry.registerAgent("DataAgent", unicode"数据分析服务", "https://a.example/mcp");

        assertEq(tokenId, 0);
        assertEq(registry.ownerOf(tokenId), alice, unicode"责任主体应为注册人");
        assertEq(registry.agentCount(), 1);
    }

    function test_registerAgent_paysRegistrationFee() public {
        registry.setRegistrationFee(0.01 ether);

        vm.prank(alice);
        vm.expectRevert(unicode"AgentRegistry: 注册质押不足");
        registry.registerAgent("A", "desc", "https://a.example/mcp");

        vm.prank(alice);
        registry.registerAgent{value: 0.01 ether}("A", "desc", "https://a.example/mcp");
        assertEq(address(registry).balance, 0.01 ether);
    }

    function test_agentInfo_returnsMetadata() public {
        vm.prank(alice);
        uint256 tokenId = registry.registerAgent("DataAgent", unicode"数据分析服务", "https://a.example/mcp");

        (string memory name, string memory desc, string memory endpoint, address owner, uint256 createdAt) =
            registry.agents(tokenId);
        assertEq(name, "DataAgent");
        assertEq(desc, unicode"数据分析服务");
        assertEq(endpoint, "https://a.example/mcp");
        assertEq(owner, alice);
        assertGt(createdAt, 0);
    }

    function test_onlyOwner_setsFee() public {
        vm.prank(bob);
        vm.expectRevert();
        registry.setRegistrationFee(0.1 ether);

        vm.prank(alice); // 非 owner 也失败（部署者为 owner）
        vm.expectRevert();
        registry.setRegistrationFee(0.1 ether);
    }

    function test_withdrawFees_onlyOwner() public {
        vm.prank(alice);
        registry.registerAgent{value: 0.01 ether}("A", "desc", "x");

        vm.prank(bob);
        vm.expectRevert();
        registry.withdrawFees();

        vm.prank(registry.owner());
        registry.withdrawFees();
        assertEq(registry.owner().balance, 0.01 ether);
    }
}
