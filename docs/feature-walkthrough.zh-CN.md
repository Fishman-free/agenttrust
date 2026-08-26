# AgentTrust 全功能走查（真实用户流程 × 技术原理）

[English](feature-walkthrough.md) | **简体中文**

[← 返回项目 README](../README.zh-CN.md) · [World ID 接入](world-id-integration.zh-CN.md) · [防女巫分析](security/anti-sybil-analysis.zh-CN.md)

> 版本：`main` @ `29f62c1`（B：World ID PoH 双通道与分级找回；A：保费分档 + 敞口上限 + 买方记账；C：举证与陪审裁决依据，已全部合入）。
> 演示环境：Docker Compose（Anvil 31337 + 开发 PoH 验证器 + 6 个预置账户 + 自动部署），前端 http://localhost:3000。
> 验证基线：**146 项合约测试通过**。
> ⚠️ 升级到新合约需执行一次 `docker compose down --volumes && docker compose up -d --build`。

---

## 阶段零：连接与网络

| 用户动作 | 界面 | 背后技术 |
|---|---|---|
| 打开 http://localhost:3000，点击“连接钱包” | 页首钱包栏 | wagmi `useConnect` + EIP-1193 provider；本地演示由内置 Anvil provider 注入（切账户/快进时间），生产走 MetaMask/World App |
| 确认网络为 Local Anvil（31337） | 钱包栏 | `useAccount`/`useBlock`；所有写操作前置 `getWriteReadiness`（未连接/错链/未配置合约一律禁用并说明原因） |

---

## 一、身份层：入场、升级、找回、注销

### 1.1 普通注册（低门槛通道）
**用户**：填名称/能力描述/端点 + 2–3 位守护人 → 点“注册（押金 0.03 ETH，可退还）”。

**技术**：`AgentRegistry.registerAgent`：
- 押金 = `registrationDeposit × 3`（0.03 ETH）锁定进 `deposits`，超额立即转 `pendingWithdrawals`；
- 铸造 ERC-721 Agent ID（`agentCount` 递增、`registeredAtBlock`/`firstAgentIdPlusOne` 记录资格快照）；
- **一人一 ID**：`registeredSubjects` 终身墓碑，同一钱包重复注册被拒；
- 普通通道**无找回锚点、不能担保/陪审**（角色门禁见 §2.3/§3.4）。

### 1.2 未验证警示 + 一键升级（`bindPoH`）
**用户**：看到警示“尚未完成人类验证：丢失私钥无法找回，不能担保/陪审”→ 填 nullifier + 证明（演示填 `0x01`）→“绑定 PoH”。

**技术**：`bindPoH` 消费一个**未使用过的 nullifier**（`verifyAndConsume`，开发验证器/World ID 适配器），锚定 `subjectNullifier` ↔ `nullifierSubject`，**自动退回押金差额（0.03 → 0.01 ETH）**，解锁找回/担保/陪审，无需注销重建。

### 1.3 PoH 注册（直接满配入场）
**用户**：勾选“使用 World ID 人类验证注册”，填 nullifier/证明后注册。

**技术**：`registerAgentVerified` 要求标准押金 0.01 ETH（本次起强制校验押金，修复此前静默下溢缺陷）；nullifier **一次性消费**防重放；`isPoHVerified(subject)` 成为担保/陪审的硬门槛。

### 1.4 身份找回（仅 PoH 身份，分级）
**场景**：私钥丢失。**用户**（新钱包）发起找回 → 守护人在“找回与守护”卡批准 → 原钱包在否决窗口内可否决 → 到期执行。

**技术**：`requestRecovery(nullifier, proof, newWallet)` 自动分级：
- **S 路径**：同人证明（`verifySameIdentity`，非消耗式：nullifierHash 锚点相等 + signal 绑定新钱包）→ 只需 **1 个**守护人 + **24h** 否决窗；
- **G 路径**：证明缺失/失败（如设备也丢了）→ 需**全部**守护人（2/2 或 3/3）+ **48h** 否决窗；
- 7 天执行窗；执行时全量迁移 NFT 控制权、责任主体、押金、资格快照、守护人、nullifier 锚点——**信誉不清零、不创建第二身份**，原钱包永久退役；
- 安全门：找回/注销前必须**无未结义务**（escrow/voting 义务预言机）。

### 1.5 注销（永久退出）
**用户**：点“注销并退还押金”→“提取待提取余额”。

**技术**：`deregister` 校验无未结义务/无进行中找回/NFT 未转让 → burn Agent ID（档案按 ID 仍可读）、押金全额转待提取（pull-payment）、终身墓碑保留；`agentCount` 不变以保护资格快照语义。

---

## 二、交易层：担保交易闭环

### 2.1 创建交易（报价即定价）
**用户**：交易页填买家/卖家 Agent ID、金额、最高保费 → 预览 `quoteGuaranteeTerms`。

**技术**：`createTrade` 调用 `quoteGuaranteeTerms(sellerId, amount, maxPremium)`：
- 最低覆盖率 `coverageBps = 5000 + (100−分数)×100/2`（新卖家 50 分 → **75%**；满分 → 50%；0 分 → 100%）；
- 参考保费率 = 分数基准 bps（新卖家 750 bps = 7.5%）**+ 分档附加**（≤1 ETH +0；1–10 ETH +100 bps；>10 ETH +250 bps），总费率 ≤20% 封顶；
- `insurable = maxPremium ≥ reference && ≤ 20%`；创建时**快照** `referencePremium`、`minCoverage`、`eligibilityAgentCount`。

### 2.2 接受与托管
**用户**：卖家“接受交易”→ 买家“买家托管 0.1 ETH”。

**技术**：`acceptTrade`/`fund` 推进 CREATED → ACCEPTED → FUNDED，各自 1 天窗口；义务计数 `openTradeCount` 入账（买方在创建时、卖方在接受时），超时由任何人可调的 `timeoutCancel*` 推进。

### 2.3 担保报价（多重校验）
**用户**：担保人填担保 Agent ID/覆盖率/保费 → 查看 `requiredStake` 精确值与**剩余可担保额度** →“提供担保并质押 0.075 ETH”。

**技术**：`guarantee` 链上依次校验：
1. 状态 FUNDED 且窗口内；
2. **PoH 门禁**（担保人必须完成人类验证）；
3. 覆盖率 ≥ `minCoverage` 且 ≤200%；
4. 保费 ∈ `[referencePremium, maxPremium]`；
5. `stake = amount × coverage` 且 `msg.value` 精确；
6. **敞口上限**：`openStakeBySubject[subject] + stake ≤ maxOpenStake`（默认 5 ETH，超限拒绝，前端显示剩余额度）。

质押入 `totalLiability`，`openTradeCount`/`openStakeBySubject` 入账。

### 2.4 交付与确认（放款 + 双记账）
**用户**：卖家“确认交付”→ 买家“确认完成”。

**技术**：`deliver` → `confirm` → `_release`：卖家得 `amount − premium`、担保人得 `stake + premium`、买方托管的 `amount` 全部转出；买卖双方各记一条 COMPLETED。幂等 outcomeId：卖方 `keccak(escrow, tradeId)`、买方 `keccak(escrow, tradeId, 1)`；Hub 失联时进入 pending，可用 `retryOutcome` 补记。

### 2.5 提现
**用户**：各账户“提取待提取余额/全部余额”。

**技术**：`withdraw` pull-payment，只从 `pendingWithdrawals` 划转并同步 `totalLiability`；收款合约拒绝时余额与负债不变。

### 2.6 超时家族（无人值守可推进）
`timeoutCancelUnaccepted`（未接受）、`timeoutCancelUnfunded`（未托管，**买方记 DEFAULTED**）、`timeoutRejectGuarantee`/`timeoutRefund`（FUNDED，作废退款）、`timeoutRefund`（GUARANTEED，卖方未交付 → **卖方 DEFAULTED + 买方 COMPLETED**，担保人 stake 全赔）、`timeoutAutoRelease`（已交付未确认 → 自动放款 + 双 COMPLETED）。全部为 1 天窗口、任何人可调、链上校验到期。

---

## 三、仲裁层：争议、举证、陪审

### 3.1 发起争议
**用户**：交易页“前往争议页”→ 填 Trade ID →“支付精确保证金并发起争议”。

**技术**：`dispute` 精确支付 2% bond（向上取整，链上读取），状态变为 DISPUTED；bond 计入 `totalLiability`。

### 3.2 举证（C：单轮 1 天窗口）
**用户**：争议页“举证与证据”区填 CID/摘要，或“上传证据到 IPFS”（粘贴自己的 Pinata JWT → 选文件 → 自动填 CID）→“提交证据”。陪审员可见双方证据卡片（摘要/内容哈希/CIDv0/CIDv1 网关链接/哈希校验按钮）以及双方信誉分、四计数器、最近交易；未提交方显示“**未举证**”。

**技术**：`submitEvidence(contentHash, summary)` 链上锚定 **IPFS 内容哈希（sha2-256 摘要，`bytes32`）+ 文字摘要**；仅买卖双方、仅 DISPUTED 且未开案、窗口内可提交；单轮可覆盖更新并记录提交次数。哈希校验从网关取回内容，按 raw 编码重新计算 sha2-256 后与锚点比对。未 pin 的文件可能从 IPFS 消失，但摘要与哈希永久在链上；未举证不自动处罚。

### 3.3 开案（C 时序）
**用户**：任何人点 `openCase`。

**技术**：`SchellingVoting.openCase` → `escrow.openArbitration`，仅能在**举证窗口（1 天）结束后、随后 2 天内**开案，避免抢先开案剥夺任一方完整举证机会；证据随后冻结。

### 3.4 陪审投票（Schelling commit–reveal）
**用户**：3 名 juror 各选立场 →“生成秘密并提交承诺”（自动生成 salt 并提示备份）→ 揭示阶段“用已保存秘密揭示”。

**技术**：`commitVote` 硬门槛：交易创建前注册的**资格快照** + **PoH** + 陪审信誉（样本 ≥3 后揭示率须 ≥80%）+ 非交易三方 + 质押 0.1 ETH；承诺 = `keccak256(caseId, subject, side, salt)`（防跟票）；`revealVote` 窗口 1 天；`settle` 要求多数方 ≥2/3 且有效票 ≥3。未揭示者质押罚没，已揭示弃权者豁免。

### 3.5 裁决执行
**技术**：`resolveDispute` 由投票合约以 escrow owner 身份调用，按裁决分配：买方拿回退款 + stake 份额、卖方保留获判货款、担保人拿剩余 stake；**争议保证金归胜方**。双方记账（卖方 WON/LOST、买方 LOST/WON，部分裁决买方记 WON）。无有效裁决时，`voidDispute` 全额退回。

### 3.6 领取与陪审指标
**用户**：胜方/符合条件的陪审员“统一领取 claim”→“提取”；各 juror“固化我的陪审员指标”。

**技术**：`claim` 分配胜方奖励与败方罚没；`finalizeJurorMetrics` 用幂等 `recordId` 将揭示率/共识一致率写入陪审档案。

---

## 四、信誉与治理

| 维度 | 规则 | 技术 |
|---|---|---|
| 业务信誉 | `100 − (100×违约 + 50×败诉)/总样本`，无记录默认 50 | `ReputationHub.reputationScore`；**买卖双方都记账**（买方仅展示，不参与定价） |
| 陪审信誉 | 样本 <3 合格；之后揭示率 ≥80% | `isJurorEligible` + `recordJurorCase` |
| 担保定价 | 费率 = 分数基准 + 金额分档附加 | §2.1 |
| 敞口 | 每担保人未结质押和 ≤ `maxOpenStake` | §2.3 |
| 治理 | 押金/敞口/验证器/义务预言机均 owner 可调；**escrow 的 owner 是投票合约**（裁决权完全在陪审团） | Deploy 脚本 + `transferOwnership` |
| 罚没预留 | `slashDeposit` 接口存在，但未授权任何调用方 | Registry |

**链上不变式**（Forge 不变式测试守护）：`totalLiability ≤ 合约余额`；义务计数 = 未结交易旗标和；`openStakeBySubject` = 未结质押和；每条交易的结果与陪审记录恰好一次。

---

## 五、安全边界与残余风险

1. **World ID 唯一性按设备**：一人多设备可获多身份，链上保证的是“一设备一 ID”，不是严格的“一人一 ID”；
2. **找回 S 路径依赖注册设备**：设备丢失走 G 路径（守护人承载安全）；普通注册无锚点、无法找回，警示即真实约束；
3. **陪审并非随机抽选**：开放自选 + 资格快照 + PoH + 质押，依赖 Schelling 点收敛假设；
4. **举证持久化依赖链下 pin**：链上只有哈希 + 摘要，页面提供 Pinata 上传与持久化警告；
5. **真实 World ID 适配器不同于本地 mock**：本地 Anvil 与 CI 使用开发/mock 验证器演练流程，不能证明真实 World ID 兼容性。`WorldIDPoHVerifier` 已实现，但 **Base Sepolia 尚未部署并完成校验**；在 [World ID 接入清单](world-id-integration.zh-CN.md) 全部通过前，不应开启生产 PoH 通道。

---

[← 返回项目 README](../README.zh-CN.md) · [World ID 接入](world-id-integration.zh-CN.md) · [防女巫分析](security/anti-sybil-analysis.zh-CN.md)
