# World ID 接入说明

[English](world-id-integration.md) | **简体中文**

[← 返回功能走查](feature-walkthrough.zh-CN.md) · [防女巫分析](security/anti-sybil-analysis.zh-CN.md) · [项目 README](../README.zh-CN.md)

> 状态：合约与前端骨架已实现（2026-08-26）；**真实 World ID 适配器尚未在 Base Sepolia 部署或完成校验**。校验需要申请 World Developer Portal `app_id` 并在前端接入 IDKit。本地 Anvil 与 CI 使用开发/mock 验证器模拟流程，不能据此认定真实 World ID 验证已打通。
> 验证基线：**146 项合约测试通过**。
> 设计依据：[`docs/superpowers/specs/2026-08-26-world-id-poh-tiered-recovery-design.md`](superpowers/specs/2026-08-26-world-id-poh-tiered-recovery-design.md)

## 1. 架构总览

```text
前端（IDKit 生成证明） ──► AgentRegistry.registerAgentVerified / bindPoH
                              │
                              ▼
                     WorldIDPoHVerifier.verifyAndConsume
                              │
                              ▼
                    官方 WorldIDRouter.verifyProof（消费式）

新钱包（找回） ──► AgentRegistry.requestRecovery
                              │
                              ▼
                     WorldIDPoHVerifier.verifySameIdentity（非消耗式）
                              │
                              ├─ 通过路由查询 Semaphore 验证器 + latestRoot()
                              ├─ 校验 proof.nullifierHash == 注册锚点
                              │  （同一 action、同一设备）
                              └─ 校验 proof.signalHash == H(newWallet)，不标记消费
```

- 注册/升级 = **消费式**：router 保证每个身份对同一 action 只使用一次；
- 找回 = **非消耗式**：只有同一设备才能复现锚定的 `nullifierHash`。重放不会重复执行找回，因为 registry 另有 nonce、过期和一次性执行门。

### 真实适配器与本地测试验证器的区别

- `WorldIDPoHVerifier` 是面向生产的适配器，调用官方 World ID router/Semaphore 验证路径，必须用目标链上的真实 IDKit 输出完成校验。
- `AnvilDevPoHVerifier` 与 `MockPoHVerifier` 是本地/测试替代品，行为刻意简化。它们只验证 registry 状态流转，**不会验证真实 World ID 证明、router 地址、组根或 IDKit 哈希约定**。
- 本地或 CI 流程通过，不得表述为 Base Sepolia 或生产 World ID 接入成功。

## 2. 官方部署地址

| 链/网络 | WorldIDRouter |
|---|---|
| Base Sepolia（项目测试网目标；适配器当前未部署） | `0x379c62556c665f1edd25f2c2a0f76bc70a53b2e4` |
| OP Sepolia | `0xe177f37af0a862a02edfea4f59c02668e9d0aaa4` |
| Base 主网 | 以官方 [Address Book](https://docs.world.org/world-id/reference/address-book) 为准 |

Semaphore 验证器与组根通过路由的 `verifierLookupTable(groupId)` / `latestRoot()` 链上查询，适配器不硬编码。

> ⚠️ 链的区别：Base Sepolia、OP Sepolia 与 Base 主网使用不同部署和环境。未核对官方配置前，不要跨网络复用地址、`app_id`、action 环境或证明。

## 3. 部署 `WorldIDPoHVerifier`

```bash
forge create contracts/src/WorldIDPoHVerifier.sol:WorldIDPoHVerifier \
  --rpc-url <RPC> \
  --private-key <PK> \
  --constructor-args <router地址> <groupId> "<app_id>" "<action>"
```

然后在项目部署时注入适配器：

```bash
POH_VERIFIER=<适配器地址> PRIVATE_KEY=<PK> forge script contracts/script/Deploy.s.sol --broadcast
```

- `app_id` / `action` 在 World Developer Portal 创建，staging 与 production 必须分开；
- **注册与找回必须共用同一个 action**（如 `agenttrust-identity`），仅 signal 不同——这是 nullifierHash 锚点相等的前提；
- groupId 使用目标网络官方值。staging 通常为 `1`，但应以 portal 与最新官方文档为准；
- 部署后调用 `setPoHVerifier` 配置 registry，并在开放 PoH 界面前核对最终链上地址。

## 4. 哈希约定（前端必须与适配器一致）

适配器 Solidity 实现：

```solidity
signalHash        = uint256(keccak256(abi.encodePacked(wallet))) >> 8;
externalNullifier = uint256(keccak256(abi.encodePacked(appId, action))) >> 8;
```

前端接入 IDKit 时，必须确认生成的 `nullifier_hash` 与 `external_nullifier` 完全符合上述约定。若所用 IDKit 版本采用不同归约方式（例如模 SNARK 域），应在 TypeScript 侧实现等价预哈希，并确保提交链上的 `nullifier` 与证明公开输入一致。

> ⚠️ **§6 全部通过前，不要在生产链开启 PoH 通道。** 本地 mock 成功不能验证这些哈希假设。

## 5. 已知限制与残余风险

1. **一设备一身份，不一定是一人一身份**：World ID 身份按设备发放，同一人类多台设备可获多个身份；链上实际保证为“一设备一 ID”。押金、信誉、守护人为第二道防线。
2. **Orb 级强制链上做不到**：router 只验证组归属（包括设备级验证身份），不暴露验证级别；如需 Orb-only，只能在产品层引导。
3. **同人找回依赖设备**：S 路径仅在注册设备仍可用时成立；设备丢失走 G 路径（全守护人 + 48h 否决窗）。
4. **无 PoH 锚点即无身份找回**：普通注册丢失私钥后永久不可访问；`bindPoH` 是唯一补救，且必须在丢钥前完成。
5. **router 与验证器依赖**：`WorldIDPoHVerifier` 依赖官方 router 与 Semaphore 行为；升级、组根可用性或网络配置变化都可能导致验证失败。
6. **治理控制风险**：registry owner 可调用 `setPoHVerifier`；密钥泄露或权限滥用可替换受信验证器，仍需运维控制与链上监控。
7. **真实集成尚未校验**：适配器哈希方案与真实 IDKit 输出尚未在 Base Sepolia 完成端到端核对。

## 6. Base Sepolia 集成校验清单（上线前必做）

Base Sepolia 是计划使用的集成测试网，但适配器**当前尚未部署**。完成并记录以下全部步骤后，才能将接入视为已上线：

1. 在 Developer Portal 创建 staging app，并创建单一 action `agenttrust-identity`；
2. 按 §3 部署 `WorldIDPoHVerifier`，调用 `setPoHVerifier`，并在 Base Sepolia 核验两个地址；
3. 用 World App 生成一次注册证明：确认 `registerAgentVerified` 成功、`usedPoHNullifiers` 置位、`isPoHVerified` 为真；
4. 同一设备生成 `signal = newWallet` 的找回证明：确认 `verifySameIdentity` 通过且不消费，router 没有找回消费记录，并确认 S 路径参数（1 位守护人 + 24h 否决窗）生效；
5. 换设备并测试空/无效证明：确认降级 G 路径（全守护人 + 48h 否决窗）；
6. 前端接入 `@worldcoin/idkit`，`app_id`/action 走环境配置；本地与 E2E 保留明确的 mock 分支；
7. 将 §4 哈希约定与真实 IDKit 输出、证明公开输入逐项核对；
8. 确认 chain ID、router 地址、浏览器记录和前端写入就绪检查都指向 Base Sepolia，而不是 Local Anvil（31337）、OP Sepolia 或 Base 主网。

## 7. 本地开发

- Local Anvil（31337）：`Deploy.s.sol` 自动部署 `AnvilDevPoHVerifier`。它接受任意非空证明、每个 nullifier 只消费一次，并将同人证明视为有效，可在本地演示注册/升级/找回全流程；
- 测试通过 `MockPoHVerifier.setSameIdentityFailure` 强制同人证明失败，覆盖 S/G 两路径；
- 这些验证器都是 mock。不得把它们的地址配置到 Base Sepolia、OP Sepolia、Base 主网或任何生产部署。

---

[← 返回功能走查](feature-walkthrough.zh-CN.md) · [防女巫分析](security/anti-sybil-analysis.zh-CN.md) · [项目 README](../README.zh-CN.md)
