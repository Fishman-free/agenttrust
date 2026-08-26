# 防女巫分析：如何限制一个智能体只拥有一个社区 ID

[English](anti-sybil-analysis.md) | **简体中文**

[← 返回功能走查](../feature-walkthrough.zh-CN.md) · [World ID 接入](../world-id-integration.zh-CN.md) · [项目 README](../../README.zh-CN.md)

> 问题：智能体（或其运营者）如何绕过注册机制、领取多个社区 ID？
> 本文梳理已实现控制、逐一列出绕过路径，并记录缓解措施与残余风险；本文不宣称已实现严格的“一人一 ID”。

---

## 1. 社区 ID 唯一性为何重要

AgentTrust 的社区 ID（ERC-721 Agent ID）是智能体参与交易、担保、投票与信誉积累的身份凭据。若一个实体可以领取多个 ID，则可以：

- **操纵陪审**：用多身份投票，扭曲 Schelling 裁决。协议要求“多数 ≥2/3 且有效票 ≥3”，女巫 ID 可伪造或稀释多数；
- **刷信誉**：控制多个身份互相交易，伪造 COMPLETED 与争议胜诉记录；
- **逃避罚没**：把违约分散到低成本身份并随时抛弃；
- **伪造成交量**：制造虚假市场活动，误导担保人定价。

因此“一人一 ID”是信任目标，但仅靠 EVM 地址唯一性无法证明它。

---

## 2. 当前修补前的控制盘点

| 机制 | 位置 | 作用 | 缺口 |
|---|---|---|---|
| 注册费/防女巫质押 | 早期设计中的 `AgentRegistry.registrationFee` | 提高注册成本 | 演示环境默认 **0**，且支付只能提高成本，不能证明唯一性 |
| 一地址一票 | `SchellingVoting.commitVote` 的 `hasCommitted[msg.sender]` | 同一地址只能投一票 | 无法阻止**多地址**投票 |
| 资格快照 | 使用 `firstAgentIdPlusOne` 的 `isRegisteredSubjectAtCount` | 只有交易创建前注册的主体可投票 | 无法区分“一个真人”与“多个钱包” |
| 获批找回之外责任主体保持稳定 | 普通 NFT 转让不改变 `responsibleParty` | NFT 转让不移动法律/记账责任；获批 PoH 找回会有意迁移责任钱包 | 不能阻止多个钱包分别注册 |

**修补前的关键事实**：`registerAgent` 没有唯一性约束，同一钱包可无限铸造 Agent ID；旧测试套件甚至用同一地址注册多个角色。

---

## 3. 绕过路径与缓解措施

### 路径 1：同一钱包重复注册（低难度，已修复）
同一私钥反复调用 `registerAgent`，每次铸造一个新 ID。

**缓解**：`_registerAgent` 现在要求 `!registeredSubjects[msg.sender]`。`registeredSubjects` 是终身墓碑，因此同一责任主体终身只能领取一个社区 ID，注销后或找回退役后也不能重领。

### 路径 2：多钱包女巫（根本问题，只能缓解，未根除）
运营者创建 N 个 EOA、合约钱包或 ERC-4337 钱包，每个地址注册一次。EVM 无法判断互不关联的地址是否属于同一运营者。

**缓解**：
- 标准 PoH 注册押金通过 `REGISTRATION_DEPOSIT` 默认设为 **0.01 ETH**；普通通道要求 `registrationDeposit × 3`（默认即 0.03 ETH），提高一次性身份成本；
- PoH 注册或 `bindPoH` 必须消费唯一的人类证明 nullifier；
- 直接拥有最大治理/保险杠杆的两个角色——担保人和陪审员——必须通过 `isPoHVerified`。

**残余暴露**：同一运营者仍可用互不关联的钱包创建多个普通买方/卖方身份。这些身份不能担保或陪审，但仍可能伪造双边活动，需要经济成本、交易对手审查与链下监控共同抑制。

### 路径 3：人类证明（World ID 双通道已实现，真实接入待验证）
纯链上系统无法区分“一个真人”和“多个钱包”，只能提高成本。人类唯一性依赖一个结果可在链上验证的外部证明系统。

已实现的 PoH 层见 [World ID 接入](../world-id-integration.zh-CN.md)：
- `WorldIDPoHVerifier` 是面向已弃用 World ID V1/Contracts 3.0 的旧版适配器设计。其消费式注册/升级和非消耗式同人找回模型仅可作为设计输入，必须由兼容 v4 的适配器替代；
- **双通道注册**：普通通道押金 ×3、无找回、不能担保/陪审；PoH 通道采用标准押金并解锁全部角色，买卖双方仍可低门槛进入；
- `bindPoH` 消费未使用 nullifier，建立锚点、解锁特权角色与找回，并退回押金差额；
- `registerAgentVerified` 要求有效且未使用的 nullifier；`usedPoHNullifiers` 在 router 消费之外提供 registry 级防重放；
- `GuaranteeEscrow.guarantee` 与 `SchellingVoting.commitVote` 强制执行 PoH 角色门禁。

> ⚠️ `WorldIDPoHVerifier` 不等于 `AnvilDevPoHVerifier` 或 `MockPoHVerifier`。本地 Anvil 与 CI mock 只演练合约状态流转，不验证真实 World ID 证明。App `app_01728cabff1e05950af1ff18c06c9d38` 与 RP `rp_fd884ac4342cc4d1` 已注册。Base Sepolia 使用同源 `/api/world-id`、官方 v4 Developer Portal API、仅服务器保存的可信证明人密钥和已绑定 Registry 的适配器 `0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF`。PoH 注册和担保人/陪审门禁已通过后端证明启用，并非 World 证明直接链上验证；`verifySameIdentity` 返回 `false`，找回采用全部守护人 + 48 小时否决窗。

### 路径 4：ID 买卖/借用（由身份语义缓解）
Agent ID 是 ERC-721，攻击者可以买入或租用高信誉 NFT。

**当前行为**：普通 NFT 转让只改变 token 控制权，不改变责任主体、投票资格或记账身份。`commitVote` 按 `msg.sender` 核对主体快照，因此买家无法用购得 ID 以自己的主体身份投票，也不能重定向信誉。获批 PoH 找回是明确例外：它会迁移责任钱包，同时保留同一 Agent ID 与信誉历史。

**残余暴露**：链下共享私钥或托管安排仍可让他人通过已注册主体的钱包行动。协议无法可靠区分授权使用与凭据共享。

### 路径 5：零押金配置（配置风险，默认值已加固）
押金为零的部署会让普通身份创建免费。

**缓解**：`Deploy.s.sol` 将 `REGISTRATION_DEPOSIT` 默认设为 `0.01 ether`，运营者可显式覆盖；普通注册收取配置值的三倍。

**残余暴露**：owner 仍可配置无效的低值；固定 ETH 金额的威慑力也会随币价波动。

### 路径 6：快照临界注册（允许的参与方式，并非漏洞）
主体可在交易创建前一刻注册，从而进入该交易的陪审资格快照。这符合开放参与设计。注册时点、交易三方排除、PoH 与陪审质押共同约束风险，但陪审员仍不是随机抽选。

---

## 4. 已实现变更与验证

| 文件 | 变更 |
|---|---|
| `contracts/src/AgentRegistry.sol` | 终身一 ID 检查；PoH 双通道；`bindPoH`；24h/48h 否决窗分级找回；`isPoHVerified` |
| `contracts/src/WorldIDPoHVerifier.sol` | World ID 适配器：消费式注册/升级验证与非消耗式同人找回验证 |
| `contracts/src/GuaranteeEscrow.sol`、`contracts/src/SchellingVoting.sol` | 担保人/陪审员 PoH 门禁 |
| `contracts/script/Deploy.s.sol` | `REGISTRATION_DEPOSIT` 默认 `0.01 ether`；`POH_VERIFIER`（`0` 表示不配置外部 PoH；Anvil 自动部署开发验证器） |
| `contracts/test/mocks/MockPoHVerifier.sol` | 测试验证器：非空证明、nullifier 一次性消费、可强制同人证明失败以覆盖 G 路径 |
| `contracts/test/AgentRegistry.t.sol` | 双通道押金、`bindPoH`、S/G 阈值与窗口、角色门禁、降级和重放防护 |
| `contracts/test/WorldIDPoHVerifier.t.sol` | 适配器参数转发、非消耗校验、假 router/Semaphore 验证器拒绝路径 |
| `deployments/31337.json`、`frontend/lib/*.ts` | 因 registry runtime bytecode 变化重新生成 |

当前验证基线：`forge test` **165 项合约测试通过**；`npm test` 69/69 通过；manifest 与 ABI `--check` 通过。

### 分级找回属性

- 普通注册：押金 ×3、无找回、不能担保/陪审；
- PoH 注册：标准押金、支持找回与特权角色；`bindPoH` 可升级普通身份并退差额；
- **S 路径**：同设备、非消耗式 World ID 证明 → 至少 1 位守护人 + 24h 否决窗；
- **G 路径**：同人证明缺失或失败 → 全守护人 + 48h 否决窗；
- 找回执行期 7 天，迁移 NFT 控制权、责任主体、押金、资格快照、守护人和 nullifier 锚点，信誉不清零；
- 找回与注销都要求 escrow `openTradeCount` 和 voting `openCommitmentCount` 为零；
- Local Anvil 为演示/E2E 部署 `AnvilDevPoHVerifier`；公共链不得配置旧版适配器，必须使用已部署、审查并校验的 World ID v4 适配器。

---

## 5. 残余风险

1. **World ID 唯一性按设备**：同一人类多台设备可获多身份，链上实际属性是“一设备一 ID”；押金、信誉和守护人只是第二道防线。
2. **后端证明信任**：旧版适配器已过时；线上适配器信任官方 v4 Developer Portal API 检查后的服务器签名。后端或证明人密钥被攻破可能签发虚假 PoH 证明，因此这不是 World 证明直接链上验证。
3. **验证器治理风险**：`setPoHVerifier` 由 owner 控制；owner 被攻破或作恶可替换验证器。
4. **找回信任假设**：S 路径需要原 World ID 设备；G 路径安全取决于守护人诚实度与 48h 否决窗内的在线率，守护人合谋可盗号。
5. **关联钱包不可见**：同一实体仍可创建多个普通买方/卖方身份。PoH 角色门禁缩小了最高危攻击面，但没有消除虚假交易或刷信誉。
6. **陪审员并非随机抽选**：即使有 PoH，协同参与者仍可定向进入案件并堆票；随机抽选与额外质押仍是后续方向。
7. **凭据共享与 ID 租赁**：普通 NFT 转让不会转移责任主体或投票权，但链上无法识别私钥共享或托管控制；获批找回仍是独立的、受守护人门禁控制的身份迁移路径。
8. **固定押金经济性**：ETH 计价押金的威慑力随币价变化，运营者需定期复核。
9. **World ID 链下假设**：设备签发、官方基础设施可用性、组成员关系与上游政策变化均不受 AgentTrust 控制。

---

## 6. 后续方向

- 实现 v4 适配器，并完成 [World ID 接入](../world-id-integration.zh-CN.md)中的 Base Sepolia 端到端清单；通过前不得宣称 PoH 已上线或具备生产可用性；
- 增加随机陪审抽选与二次/附加质押，提高堆票成本；
- 对低信誉主体引入递进押金或投票质押要求；
- 对可疑资金来源与注册时间做链下聚类，作为前端提示层，但不把启发式判断当作同一身份的证明。

---

[← 返回功能走查](../feature-walkthrough.zh-CN.md) · [World ID 接入](../world-id-integration.zh-CN.md) · [项目 README](../../README.zh-CN.md)
