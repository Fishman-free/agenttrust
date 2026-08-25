# World ID PoH 集成、双通道注册与分级找回设计（B）

> 状态：已与用户逐项确认。日期：2026-08-26。
> 范围：新增 `WorldIDPoHVerifier`；`AgentRegistry` 双通道注册 + `bindPoH` 升级 + 分级找回；`GuaranteeEscrow`/`SchellingVoting` 角色门禁；部署脚本、前端、测试、manifest 联动。
> 前序关系：本文档**修订并取代** `2026-08-14-registration-deposit-and-recovery-design.md` 中 PoH 找回部分（单一路径 24h → 分级路径 24h/48h）；押金可退、永久注销、义务检查等模型不变。
> 后续队列：A（保费曲线重设计 + 买方结果记账修复）→ C（举证与辩论机制 + 双方历史/信誉展示）。

## 1. 目标

1. 把"一人一 ID"从 mock 变为真实能力：接入 **World ID 链上验证**（Base Sepolia 官方路由 `0x379c62556c665f1edd25f2c2a0f76bc70a53b2e4`）。
2. **双通道注册**：普通通道（押金 ×3、无找回、不能担保/陪审）与 PoH 通道（标准押金、分级找回、全能），兼顾冷启动吸引力与反女巫。
3. **升级通道 `bindPoH`**：普通用户随时补挂 World ID，退回押金差额，无需注销重建。
4. **分级找回**：同人证明路径（≥1 守护人 + 24h 否决窗）与全守护人兜底路径（全守护人 + 48h 否决窗）。
5. 普通用户**无找回**（维持现状），前端强警示 + 升级引导。

## 2. 决策记录（已确认）

| 决策点 | 结论 |
|---|---|
| PoH 提供商 | **World ID**（链上验证器直连，非链下预言机） |
| 注册通道 | **双通道分权**：普通可买卖；PoH 可担保/陪审/找回 |
| 普通注册押金 | 标准押金 ×3（`PLAIN_DEPOSIT_MULTIPLIER = 3`） |
| 普通注册找回 | **无**（requestRecovery 直接 revert，警示真实有力） |
| 升级通道 | `bindPoH(nullifier, proof)` 随时补挂，自动退押金差额 |
| 找回分级 | 同人证明成功 → ≥1 守护人 + **24h** 否决窗；失败/缺失 → 全部守护人 + **48h** 否决窗 |
| 找回执行窗 | 7 天（不变） |
| 角色门禁 | 担保人、陪审员必须 PoH 验证；买卖双方不限 |
| 否决窗含义 | 请求创建到可执行之间的等待期，原钱包可在窗口内 `vetoRecovery` 一键作废 |

## 3. 架构与组件

### 3.1 新合约 `WorldIDPoHVerifier`（实现现有 `IAgentProofOfPersonhood`）

```solidity
function verifyAndConsume(address subject, bytes32 nullifier, bytes calldata proof)
    external returns (bool);   // → WorldIDRouter.verifyProof，signal = subject，一次性消费
function verifySameIdentity(bytes32 nullifier, address newWallet, bytes calldata proof)
    external returns (bool);   // 非消耗式同人校验（见下）
```

- **verifyAndConsume**：调官方路由消费式验证，用于 PoH 注册与 `bindPoH`。
- **verifySameIdentity**（自定义，找回专用）：
  1. 通过路由的公开验证器查询接口取得官方底层 Semaphore 验证器，`latestRoot()` 取官方最新组根；
  2. 直接调用 Semaphore 验证器验 ZK 证明；
  3. 校验 **proof 的 nullifierHash == 注册时锚定的 nullifier**；
  4. 校验 **signal == newWallet**；
  5. **不标记任何消费**（重放无害：registry 有 nonce/状态门）。
- **硬约束：注册与找回共用同一个 World ID action**（如 `agenttrust-identity`），仅靠 signal 区分用途。nullifierHash = H(设备身份秘密, externalNullifier(app_id, action))，同一 action 下同一设备才产生同一 nullifierHash——这是"锚点相等"能成立的前提；不同 action 会产生不同 nullifierHash，锚点对不上。
- 构造参数注入：router 地址、groupId、actionId（路由版本所需）、Semaphore 验证器来源。目标链 Base Sepolia 路由为 `WorldIDRouterImplV1`（8 参 `verifyProof`），适配器按链上实际 ABI 实现。
- 验证失败语义：`verifySameIdentity` 失败**不 revert 调用方**，由 registry 捕获后降级（见 3.2）。

### 3.2 `AgentRegistry` 改造

新增常量：

```solidity
uint256 public constant PLAIN_DEPOSIT_MULTIPLIER = 3;
uint256 public constant RECOVERY_DELAY_POH = 24 hours;      // 路径 S 否决窗
uint256 public constant RECOVERY_DELAY_GUARDIAN = 48 hours; // 路径 G 否决窗
```

`RecoveryRequest` 增加 `ProofLevel proofLevel;`（`SAME_IDENTITY` / `GUARDIANS`）。

| 函数 | 变化 |
|---|---|
| `registerAgent`（普通） | **移除** `pohVerifier == address(0)` 要求（验证器上线后普通通道仍开放）；押金要求 `registrationDeposit × 3`；`deposits[subject]` 存实付额（3×），注销全额退 |
| `registerAgentVerified`（PoH） | 押金标准档；锚定逻辑不变 |
| `bindPoH(nullifier, proof)`（新） | 仅未锚定活跃主体可调（`subjectNullifier[subject] == 0`）；消费式验证后锚定；**退回押金差额**（`deposits` 3×→1×，差额入 `pendingWithdrawals`）；解锁找回 + 角色 |
| `requestRecovery` | `try/catch` 调 `verifySameIdentity`：成功 → `SAME_IDENTITY`；失败/验证器未配置 → `GUARDIANS`。无锚点主体直接 revert |
| `approveRecovery` / `executeRecovery` | 批准阈值按 `proofLevel`：S ≥1；G = 全守护人（2/2 或 3/3） |
| `vetoRecovery` | 否决窗按 `proofLevel`：S 24h；G 48h |
| `isPoHVerified(subject)`（新 view） | `subjectNullifier[subject] != 0`，供 escrow/voting/前端使用 |

- 降级安全：G 比 S 更严格（全守护人 + 更长窗口），攻击者无法借"证明失败"获得优势；失败原因（含 gas 不足）一律降级，不细分。
- `pohVerifier == address(0)` 但主体已锚定的极端场景（验证器被移除）：S 不可用，G 仍可用（守护人兜底不受影响）。
- 防重放：S 路径的恢复证明可被第三方重放提交，但 `requestRecovery` 有"已有未过期请求则拒绝" + nonce 递增门，且执行后删除请求；重放只能覆盖到同一新钱包的无害路径。

### 3.3 角色门禁（`GuaranteeEscrow` / `SchellingVoting`）

- `GuaranteeEscrow.guarantee`：新增 `require(registry.isPoHVerified(subject))`（担保人必须 PoH）。
- `SchellingVoting.commitVote`：新增 `require(registry.isPoHVerified(msg.sender))`（陪审员必须 PoH）。
- 影响面：现有测试/E2E 大量以普通注册账号充当担保人/陪审员，需迁移至 `registerAgentVerified`（mock 下同样锚定 nullifier）。

### 3.4 部署脚本与链配置

- 新增 env `POH_VERIFIER`（默认 `0` = 不启用，行为与现状一致）；Deploy 末尾 `registry.setPoHVerifier(...)`。
- 目标链：**Base Sepolia**（路由 `0x379c62556c665f1edd25f2c2a0f76bc70a53b2e4`，官方已部署）；主网与 OP Sepolia 路由地址一并写入部署文档。
- 本地 anvil / CI：`MockPoHVerifier` 升级——`verifySameIdentity` 可配置成功/失败（覆盖 S/G 两路径）、支持 `bindPoH` 场景。

### 3.5 前端

- 注册表单：普通/PoH 双通道；押金金额按通道展示（标准 vs ×3）。
- 未验证用户：**风险警示条**（"未做人类验证：丢失私钥无法找回、不能担保与陪审，建议尽快验证"）+「现在验证」按钮 → IDKit 流程 → 新用户走 `registerAgentVerified`、老用户走 `bindPoH`。
- 验证流依赖 `@worldcoin/idkit`：app_id/action 经 env 注入；本地开发与 E2E 走 mock 分支（不做真实证明）。
- 找回 UI：新钱包连接 → 同人证明（可选）→ 提交 → 守护人批准 / 原钱包否决按钮 / 否决窗倒计时（24h/48h）。
- 智能体卡片加"已人类验证"徽章。

## 4. 数据流

1. **PoH 注册**：前端 IDKit 生成证明（nullifier, proof）→ `registerAgentVerified` → `verifyAndConsume`（router 消费）→ 锚定 nullifier ↔ 主体 → 解锁全部能力。
2. **升级**：`bindPoH` → `verifyAndConsume`（router 消费）→ 锚定 → 退押金差额 → 角色解锁。
3. **找回 S**：新钱包用**同一设备** World App 生成同 action 证明（signal = newWallet）→ `requestRecovery` → `verifySameIdentity` 成功 → 1 守护人批准 → 24h 否决窗 → `executeRecovery`。
4. **找回 G**：证明缺失/失败 → 降级 G → 全守护人批准 → 48h 否决窗 → 执行。
5. **执行条件**（不变）：新钱包未注册、非守护人、无未结义务（escrow/voting oracles）、NFT 未转让、执行窗内。

## 5. 已知限制（写入文档，不实现）

- World ID 唯一性按**设备**：同一人类多台设备可获多个身份，链上只能做到"一设备一 ID"；押金 + 信誉 + 守护人为第二道防线。
- **Orb 级强制校验链上做不到**（router 只验组归属，不暴露验证级别），以文档明示。
- 找回的"同人"保证仅在注册设备仍可用时成立（S 路径）；设备丢失靠 G 路径（守护人承载安全）。

## 6. 测试

- 单测：双通道注册押金差异；`bindPoH`（成功/重复/非主体/差额退款/角色解锁）；S/G 两路径的批准阈值与窗口；无锚点 revert；担保人/陪审员门禁；验证器失败降级；重放防护。
- 集成/不变式：`openTradeCount`/`openCommitmentCount` 与门禁共存。
- E2E：警示条、升级流程、找回流程（mock 分支）。
- CI：四门禁全绿；manifest 重新生成（`forge fmt` → clean build → clean anvil deploy → `--write`）。

## 7. 文档

USAGE.md、anti-sybil-analysis.md 同步；新增"World ID 接入说明"（app_id/action 创建、各链地址、已知限制）。

## 8. 不做（YAGNI）

多 PoH provider 抽象层；普通用户找回；Orb 强制校验；押金动态曲线（属 A）；举证机制（属 C）。
