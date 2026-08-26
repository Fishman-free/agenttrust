# AgentTrust 智能合约（Foundry）

[English](./README.md) | **简体中文**

AgentTrust 的 Solidity 合约实现，使用 Foundry 开发、测试与部署。

## 合约清单

每份部署 manifest 跟踪以下四个核心合约：

| 合约 | 职责 |
|---|---|
| `src/AgentRegistry.sol` | 智能体身份注册表：ERC-721 Agent ID、责任主体 owner 绑定、注册押金及真人证明配置 |
| `src/GuaranteeEscrow.sol` | 交易托管、担保人质押、结算与罚没 |
| `src/SchellingVoting.sol` | 通过 Schelling 点社区质押投票裁决争议 |
| `src/ReputationHub.sol` | 链上信誉存证；仅获授权的 Escrow/Voting 可写，禁止自评 |

`src/WorldIDPoHVerifier.sol` 是真实的 World ID 真人证明适配器，需要单独部署和配置，不属于 manifest 跟踪的四个核心合约。`script/Deploy.s.sol` 中定义的 `AnvilDevPoHVerifier` 仅供本地开发，绝不能部署到公共网络或承载价值的网络。

## 测试

权威 Foundry 基线为：**146 tests passed, 0 failed, 0 skipped across 10 suites**，包含 unit、fuzz、E2E 与 invariant 覆盖。

```bash
export PATH="$HOME/.foundry/bin:$PATH"
NO_PROXY="127.0.0.1,localhost,::1" forge test -vvv

# 仅运行全链路 E2E
NO_PROXY="127.0.0.1,localhost,::1" forge test --match-contract E2ETest -vvv
```

> **Windows 注意**：Foundry 不在 `PATH` 时，先执行 `export PATH="$HOME/.foundry/bin:$PATH"`。本机代理可能导致 `cast`/`forge` 请求返回 502；访问本地 RPC 时请设置 `NO_PROXY="127.0.0.1,localhost,::1"`。

## 本地部署

```bash
# 全链路演示使用的一次性本地 Anvil 链
export PATH="$HOME/.foundry/bin:$PATH"
NO_PROXY="127.0.0.1,localhost,::1" anvil --chain-id 31337 --port 8545

# 部署；Deploy.s.sol 也会通过 vm.envUint 读取 PRIVATE_KEY
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key "$PRIVATE_KEY"
```

上述公开私钥是不安全的一次性 Anvil 私钥。绝不能在公共网络或承载价值的网络上使用。

脚本按 Registry → Hub → Escrow → Voting 的顺序部署，授予 Escrow/Voting 对 Hub 的写权限，将 Escrow 所有权移交 Voting，并配置义务预言机和注册参数。仅当链 ID 为 `31337` 且未设置 `POH_VERIFIER` 时，脚本才会部署本地专用的 `AnvilDevPoHVerifier`。

公共网络部署必须先单独部署真实的 `WorldIDPoHVerifier`，再通过 `POH_VERIFIER` 传入其地址；详见 [Base Sepolia 部署指南](./demo/DEPLOY-BaseSepolia.zh-CN.md)。

## 演示

完整流程见[全链路演示手册](./demo/DEMO.zh-CN.md)：注册 → 担保交易 → 交付 → 争议 → 社区投票 → 罚没 → 信誉更新。

## 更多

- [项目总览](../README.zh-CN.md)
- [Base Sepolia 部署指南](./demo/DEPLOY-BaseSepolia.zh-CN.md)
- [设计规格](../docs/superpowers/specs/2026-08-08-agenttrust-design.md)
