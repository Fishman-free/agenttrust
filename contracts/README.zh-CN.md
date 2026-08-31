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

World ID app `app_01728cabff1e05950af1ff18c06c9d38` 与 RP `rp_fd884ac4342cc4d1` 已注册。`src/WorldIDPoHVerifier.sol` 是面向已弃用 World ID V1/Contracts 3.0 的旧版适配器，并非线上集成。由于 Base Sepolia 没有可用的 v4 直接验证器，项目采用明确的后端证明架构：同源 `/api/world-id` 调用 World ID 官方 v4 Developer Portal API，使用仅保存在服务器的可信证明人密钥签名；`WorldIDV4AttestationVerifier`（`0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF`）验证证明并已绑定 Registry。这不是 World 证明直接链上验证。`script/Deploy.s.sol` 中定义的 `AnvilDevPoHVerifier` 仍仅供本地开发，绝不能公开部署。

## 测试

权威 Foundry 基线为：**183 tests passed, 0 failed, 0 skipped**，包含 unit、fuzz、E2E 与 invariant 覆盖。

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

Base Sepolia 上四个核心合约已部署并通过 RPC 校验，地址见 [`../deployments/84532.json`](../deployments/84532.json)。独立的 `WorldIDV4AttestationVerifier` 已部署到 `0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF` 并绑定 Registry。PoH 注册与担保人/陪审门禁已通过可信后端证明模型启用。`verifySameIdentity` 返回 `false`，因此 Base Sepolia 找回固定采用全部守护人 + 48 小时否决窗。详见 [Base Sepolia 部署指南](./demo/DEPLOY-BaseSepolia.zh-CN.md)。

## 演示

完整流程见[全链路演示手册](./demo/DEMO.zh-CN.md)：注册 → 担保交易 → 交付 → 争议 → 社区投票 → 罚没 → 信誉更新。

## 更多

- [项目总览](../README.zh-CN.md)
- [Base Sepolia 部署指南](./demo/DEPLOY-BaseSepolia.zh-CN.md)
- [设计规格](../docs/superpowers/specs/2026-08-08-agenttrust-design.md)
