# World ID 接入说明

> 状态：合约与前端骨架已实现（2026-08-26）；**真实 World ID 验证尚待一次 Base Sepolia 集成校验**（需申请 app_id 并在前端接入 IDKit）。本地 Anvil 与 CI 使用开发验证器模拟全部流程。
> 设计依据：[`docs/superpowers/specs/2026-08-26-world-id-poh-tiered-recovery-design.md`](superpowers/specs/2026-08-26-world-id-poh-tiered-recovery-design.md)

## 1. 架构总览

```
前端（IDKit 生成证明） ──► AgentRegistry.registerAgentVerified / bindPoH
                              │
                              ▼
                     WorldIDPoHVerifier.verifyAndConsume
                              │
                              ▼
                    官方 WorldIDRouter.verifyProof（一次性消费）

新钱包（找回） ──► AgentRegistry.requestRecovery
                              │
                              ▼
                     WorldIDPoHVerifier.verifySameIdentity（非消耗式）
                              │
                              ├─ 官方路由查表拿 Semaphore 验证器 + latestRoot()
                              ├─ 校验 proof.nullifierHash == 注册锚点（同一 action 同一设备）
                              └─ 校验 proof.signalHash == H(newWallet)，不标记消费
```

- 注册/升级 = **消费式**（router 保证一人一 action 一次）；
- 找回 = **非消耗式**（同一设备才能复现同一 nullifierHash；重放无害，registry 有 nonce/过期/一次性执行门）。

## 2. 官方部署地址

| 链 | WorldIDRouter |
|---|---|
| Base Sepolia（项目测试网） | `0x379c62556c665f1edd25f2c2a0f76bc70a53b2e4` |
| OP Sepolia | `0xe177f37af0a862a02edfea4f59c02668e9d0aaa4` |
| Base 主网 | 以官方 [Address Book](https://docs.world.org/world-id/reference/address-book) 为准 |

Semaphore 验证器与组根：通过路由的 `verifierLookupTable(groupId)` / `latestRoot()` 链上查询，适配器不硬编码。

## 3. 部署 WorldIDPoHVerifier

```bash
forge create contracts/src/WorldIDPoHVerifier.sol:WorldIDPoHVerifier \
  --rpc-url <RPC> \
  --private-key <PK> \
  --constructor-args <router地址> <groupId> "<app_id>" "<action>"
```

然后在 Deploy 时注入：

```bash
POH_VERIFIER=<适配器地址> PRIVATE_KEY=<PK> forge script contracts/script/Deploy.s.sol --broadcast
```

- `app_id` / `action` 在 World Developer Portal 创建（staging 与 production 分开）；
- **注册与找回必须共用同一个 action**（如 `agenttrust-identity`），仅 signal 不同——这是 nullifierHash 锚点相等的前提；
- groupId 用目标链官方值（staging 通常为 `1`，以 portal/官方文档为准）。

## 4. 哈希约定（前端必须与适配器一致）

适配器（Solidity）：

```solidity
signalHash        = uint256(keccak256(abi.encodePacked(wallet))) >> 8;
externalNullifier = uint256(keccak256(abi.encodePacked(appId, action))) >> 8;
```

前端接入 IDKit 时必须核对实际生成的 `nullifier_hash` 与 `external_nullifier` 是否与上述约定一致；若 IDKit 版本采用不同归约（如模 SNARK 域），需在 TS 侧实现等价预哈希并保证提交链上的 `nullifier` 与证明公开输入一致。**集成校验清单见 §6，未通过校验前不要在生产链开启 PoH 通道。**

## 5. 已知限制（协议边界，不隐瞒）

1. **一设备一身份**：World ID 的身份按设备发放，同一人类多台设备可获多个身份 → 链上实际保证为"一设备一 ID"。押金、信誉、守护人为第二道防线。
2. **Orb 级强制链上做不到**：router 只验组归属（含设备级验证身份），不暴露验证级别；如需 Orb-only，只能在产品层引导。
3. **同人找回依赖设备**：S 路径（同人证明）仅在注册设备可用时成立；设备丢失走 G 路径（全守护人 + 48h 否决窗）。
4. **无同人证明即无找回**：普通注册（无 nullifier 锚点）丢失私钥 = 永久损失，前端已强警示；`bindPoH` 是唯一补救（且需在丢钥前完成）。

## 6. Base Sepolia 集成校验清单（上线前必做）

1. 在 Developer Portal 创建 staging app，创建单一 action `agenttrust-identity`；
2. 部署 `WorldIDPoHVerifier`（§3）并 `setPoHVerifier`；
3. 用世界 App 生成一次注册证明：确认 `registerAgentVerified` 成功、`usedPoHNullifiers` 置位、`isPoHVerified` 为真；
4. 同一设备生成 signal=newWallet 的找回证明：确认 `verifySameIdentity` 通过（非消耗，router 无消费记录）且 S 路径参数（24h）生效；
5. 换设备/空证明：确认降级 G 路径（48h、全守护人）；
6. 前端接入 `@worldcoin/idkit`（app_id/action 走 env），本地与 E2E 继续走 mock 分支；
7. 复核 §4 哈希约定与 IDKit 实际输出一致。

## 7. 本地开发

- Anvil（31337）：`Deploy.s.sol` 自动部署 `AnvilDevPoHVerifier`（非空证明有效、nullifier 一次性消费、同人证明恒真），前端可直接体验注册/升级/找回全流程；
- 覆盖 S/G 两路径：测试中用 `MockPoHVerifier.setSameIdentityFailure` 强制同人证明失败。
