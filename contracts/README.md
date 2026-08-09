# AgentTrust 智能合约（Foundry）

AgentTrust 协议的四层 Solidity 合约实现，使用 Foundry 开发、测试与部署。

## 合约清单

| 合约 | 职责 |
|---|---|
| `src/AgentRegistry.sol` | 智能体身份注册表（ERC-721 Agent ID + 责任主体 owner 绑定） |
| `src/GuaranteeEscrow.sol` | 交易担保托管（escrow 质押 + 违约罚没） |
| `src/SchellingVoting.sol` | 争议裁决（Schelling 点社区质押投票） |
| `src/ReputationHub.sol` | 信誉中心（链上 attestation，仅 Escrow/Voting 可写，禁止自评） |

## 测试

```bash
# 38 个测试全通过（含 E2E 全链路）
export PATH="$HOME/.foundry/bin:$PATH"
NO_PROXY="127.0.0.1,localhost,::1" forge test -vvv

# 仅 E2E 全链路
NO_PROXY="127.0.0.1,localhost,::1" forge test --match-contract E2ETest -vvv
```

> **Windows 注意**：foundry 不在 PATH 需先 `export PATH="$HOME/.foundry/bin:$PATH"`；本机代理会导致 cast/forge 请求 502，必须带 `NO_PROXY="127.0.0.1,localhost,::1"`。

## 部署

```bash
# 本地 anvil 演示链（配合全链路演示）
export PATH="$HOME/.foundry/bin:$PATH"
NO_PROXY="127.0.0.1,localhost,::1" anvil --chain-id 31337 --port 8545

# 部署（需同时导出 PRIVATE_KEY，Deploy.s.sol 内部用 vm.envUint 读取）
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key "$PRIVATE_KEY"
```

部署脚本自动完成：Registry → Hub → Escrow → Voting 顺序部署、Hub 授权 Escrow/Voting 写入、Escrow 所有权移交 Voting（社区裁决可驱动 escrow）。

## 演示

全链路演示手册见 [`demo/DEMO.md`](./demo/DEMO.md)（注册 → 担保交易 → 交付 → 争议 → 社区投票 → 罚没 → 信誉更新）。

## 更多

- 项目总览见根目录 [`README.md`](../README.md)
- 设计规格见 [`docs/superpowers/specs/2026-08-08-agenttrust-design.md`](../docs/superpowers/specs/2026-08-08-agenttrust-design.md)
