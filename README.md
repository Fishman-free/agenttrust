# AgentTrust · 智能体互信协议

为智能体间商务提供**身份注册、交易担保、争议裁决、信誉记录**的可信基础设施（区块链方案，本地 anvil 演示链 / Base Sepolia 测试网）。

## 背景

智能体时代到来，智能体代替人类交易需要解决互信问题。本项目以区块链智能合约实现：

- **身份**：ERC-721 Agent ID + 责任主体（owner）绑定
- **担保**：escrow 质押 + 违约罚没
- **裁决**：Schelling 点社区质押投票
- **信誉**：链上 attestation，不可篡改、禁止自评（仅合约可写）

设计对齐行业标准 **ERC-8004（Trustless Agents）**。

## 仓库结构

| 目录 | 说明 |
|---|---|
| `contracts/` | Solidity 合约（Foundry）：AgentRegistry / GuaranteeEscrow / SchellingVoting / ReputationHub |
| `contracts/demo/DEMO.md` | 全链路演示手册 |
| `frontend/` | 开发者门户（Next.js + wagmi） |
| `papers/` | 调研论文库（30 篇，见 `papers/README.md`） |
| `docs/` | 设计规格、实现计划、论文研究笔记 |

## 快速开始

```bash
# 合约测试（38 个测试全通过）
cd contracts && NO_PROXY="127.0.0.1,localhost,::1" forge test -vvv

# 全链路演示（详见 contracts/demo/DEMO.md）
# 1. anvil 启动 + 部署 + 前端 dev
```

> **Windows 注意**：本机代理会导致 cast/forge 请求 502，所有链上命令必须带 `NO_PROXY="127.0.0.1,localhost,::1"`。

## 合规说明

MVP 使用测试网/本地链代币模拟质押/罚没（无真实价值）。境内不发行任何可交易代币/凭证；担保责任由真实主体（agent owner）承担；智能体无民事主体资格，责任归属注册人。长期代币化需海外合规架构（详见设计规格 §8）。

## 论文

**Schelling-Point Reputation Communities: A Decentralized Guarantee and Arbitration Layer for Agent-to-Agent Commerce**（进行中，见 `docs/superpowers/specs/2026-08-08-agenttrust-design.md` §10）
