# 防女巫分析：一个智能体如何被限制为只有一个社区 ID

> 问题：智能体（或其运营者）如何绕过注册机制、领取多个社区 ID？
> 本文梳理现有机制、逐一列出绕过路径，并记录本次修补的内容与残余风险。

---

## 1. 社区 ID 的唯一性诉求

AgentTrust 的社区 ID（ERC-721 Agent ID）是智能体参与交易、担保、投票与信誉积累的**唯一身份凭据**。若一个实体可以领取多个社区 ID，则可以：

- **操纵陪审**：多身份投票，扭曲 Schelling 裁决（协议要求"多数 ≥2/3 且有效票 ≥3"，多 ID 会稀释真实多数）；
- **刷信誉**：用多个身份互相交易，伪造"完成交易"与"争议胜诉"记录；
- **逃避罚没**：把违约行为分散到低成本身份上，销毁后另起炉灶；
- **伪造成交量**：制造虚假的市场繁荣，误导担保人定价。

因此"一人一 ID"是协议信任基石的先决条件。

---

## 2. 修补前的机制盘点

| 机制 | 位置 | 作用 | 缺口 |
|---|---|---|---|
| 注册费（anti-Sybil 质押） | `AgentRegistry.registrationFee` | 提高注册成本 | 演示环境默认 **0**，且费用只提高成本、不证明唯一性 |
| 一人一票 | `SchellingVoting.commitVote` 的 `hasCommitted[msg.sender]` | 同一地址只能投一票 | 无法阻止**多地址**投票 |
| 资格快照 | `isRegisteredSubjectAtCount`（`firstAgentIdPlusOne`） | 只有交易创建前注册的主体可投票 | 无法区分"一个真人"与"一万个钱包" |
| 责任主体不可变 | `responsibleParty` 注册时固化 | NFT 转让不改法律责任 | 不能阻止多钱包注册 |

**关键事实**：修补前 `registerAgent` **没有任何唯一性约束**——同一钱包可以无限次铸造 Agent ID（测试套件甚至用同一地址注册多个角色）。

---

## 3. 绕过路径（攻击面清单）

### 路径 1：同一钱包重复注册（低难度，已修复）
同一私钥反复调用 `registerAgent`，每次铸造一个新 ID。零成本、零技术门槛。

**修补**：`_registerAgent` 增加 `require(!registeredSubjects[msg.sender], "主体已注册")`——一个责任主体终身只能领取一个社区 ID。

### 路径 2：多钱包女巫（高难度、高危害，核心问题）
为每个 ID 生成一个全新 EOA（或合约钱包/ERC-4337 钱包），从 N 个地址各注册一次。链上无法区分这些地址是否属于同一实体。

**修补（缓解，非根除）**：
- 注册质押默认 **0.01 ETH**（`Deploy.s.sol` 读取 `REGISTRATION_FEE` 环境变量，默认 0.01 ether），提高攻击成本；
- **人类证明钩子**（见路径 3）：配置 PoH 预言机后，每个 ID 必须消费一个独一无二的人类证明 nullifier。

### 路径 3：人类证明（PoH）锚定（已落地 World ID 双通道，2026-08-26）
纯链上系统无法区分"一个真人"与"一万个钱包"——这是 EVM 的固有限制，任何纯链上方案都只能**提高成本**而不能**证明唯一**。真实唯一性来自链上人类证明验证器（World ID，直接链上验证、无链下信任方）。

**修补**：`AgentRegistry` 的 PoH 层（详见 [`2026-08-26-world-id-poh-tiered-recovery-design.md`](../superpowers/specs/2026-08-26-world-id-poh-tiered-recovery-design.md)）：
- `WorldIDPoHVerifier` 适配器：注册/升级走官方 `WorldIDRouter.verifyProof`（一次性消费）；找回走**非消耗式同人校验**（nullifierHash 锚点相等 + signal 绑定新钱包）；
- **双通道注册**：普通通道（押金 ×3、无找回、不能担保/陪审）与 PoH 通道（标准押金、全能）并存，冷启动不受 World ID 门槛影响；
- `bindPoH` 随时升级：消费一个未使用 nullifier 即锚定，自动退回押金差额；
- `registerAgentVerified` 必须消费有效且未使用过的 nullifier；注册表本地记录 `usedPoHNullifiers` 作为第二道防线；
- **角色门禁**：担保人（`GuaranteeEscrow.guarantee`）与陪审员（`SchellingVoting.commitVote`）必须 PoH 验证——女巫最想渗透的两个角色被 World ID 保护；买卖双方不受限。

### 路径 4：ID 买卖 / 借用（已由设计缓解）
ERC-721 可转让，攻击者可以买入或租用高信誉 ID。

**现状（无需修补，说明即可）**：投票资格与责任主体都按**注册时的地址**核验（`responsibleParty` 不可变、`commitVote` 按 `msg.sender` 查注册快照），转让 NFT 只转移"控制权"，不转移投票权与责任。买来的 ID 无法为买家投票，也不会为卖家之外的任何人积累信誉。

### 路径 5：零注册费配置（配置问题，已修复）
演示环境 `registrationFee = 0`，女巫完全免费。

**修补**：部署脚本默认设置 `0.01 ether`，运营者可显式覆盖（如生产环境设更高）。

### 路径 6：快照临界注册（合法参与，非漏洞）
主体在交易创建前一刻注册以获取陪审资格。这是"开放参与"的设计选择，一人一票约束仍然成立；风险由"资格快照 + 交易相关方排除"控制。

---

## 4. 修补清单

| 文件 | 变更 |
|---|---|
| `contracts/src/AgentRegistry.sol` | 一人一 ID `require`；PoH 双通道 + `bindPoH` + 分级找回（24h/48h 否决窗）+ `isPoHVerified` |
| `contracts/src/WorldIDPoHVerifier.sol` | World ID 适配器：消费式验证（注册/升级）与非消耗式同人校验（找回） |
| `contracts/src/GuaranteeEscrow.sol`、`SchellingVoting.sol` | 担保人/陪审员 PoH 门禁 |
| `contracts/script/Deploy.s.sol` | `REGISTRATION_DEPOSIT`（默认 0.01 ether）+ `POH_VERIFIER`（0=关闭；anvil 自动部署开发验证器） |
| `contracts/test/mocks/MockPoHVerifier.sol` | 测试预言机：非空证明有效、nullifier 只可消费一次、同人证明可强制失败（覆盖 G 路径） |
| `contracts/test/AgentRegistry.t.sol` | 双通道押金、bindPoH、S/G 两路径阈值与窗口、门禁、降级、重放防护 |
| `contracts/test/WorldIDPoHVerifier.t.sol` | 适配器参数转发、非消耗校验、失败拒绝（假路由/假 Semaphore 验证器） |
| `deployments/31337.json`、`frontend/lib/*.ts` | 重新生成（registry runtime bytecode 变化） |

验证：`forge test` **130/130 通过**（含义务计数不变式）；`npm test` 69/69 通过；manifest/ABI `--check` 全绿。

### 4.2 双通道与分级找回（已实现，2026-08-26）

按 [`2026-08-26-world-id-poh-tiered-recovery-design.md`](../superpowers/specs/2026-08-26-world-id-poh-tiered-recovery-design.md) 落地：

- 普通注册 = 押金 ×3 + 无找回 + 不能担保/陪审；PoH 注册 = 标准押金 + 全能；`bindPoH` 随时升级并退押金差额；
- **分级找回**：同人证明（同一设备 World ID，非消耗式）→ ≥1 守护人 + 24h 否决窗；证明缺失/失败 → 全守护人 + 48h 否决窗；7 天执行期；
- 找回迁移：NFT、责任主体、押金、资格快照、守护人、nullifier 锚点全部迁移，信誉不清零；
- 义务安全门：找回/注销要求 Escrow `openTradeCount` 与 Voting `openCommitmentCount` 均为零；
- 本地 Anvil 自动部署 `AnvilDevPoHVerifier` 供演示/E2E；生产链用 `POH_VERIFIER` 指向 `WorldIDPoHVerifier`。

验证：`forge test` **130/130 通过**；`npm test` 69/69；manifest/ABI 重新生成。

---

## 5. 残余风险（诚实声明）

1. **World ID 唯一性按设备**：同一人类多台设备可获多个身份，"一人一 ID"在链上实际是"一设备一 ID"；押金 + 信誉 + 守护人为第二道防线（协议边界，写入 [`docs/world-id-integration.md`](../world-id-integration.md)）。
2. **PoH 验证器自身风险**：`WorldIDPoHVerifier` 依赖官方路由与 Semaphore 验证器；`setPoHVerifier` 权限在 owner，属治理风险点；适配器哈希方案与 IDKit 的最终一致性需在申请 app_id 后做一次 Base Sepolia 集成校验。
3. **找回的安全边界**：S 路径的"同人"保证仅在注册设备仍可用时成立；G 路径安全 = 守护人可信度 × 48h 在线率，守护人合谋可盗号（与所有社交恢复方案同级的固有风险）。
4. **链上不可识别关联地址**：同一实体用互不相关钱包仍可走普通通道获得多个买卖身份（不能担保/陪审，攻击面已被角色门禁压缩）。
5. **陪审并非随机抽选**（已知限制）：即便 PoH 落地，攻击者仍可定向堆票；长期方向是随机抽选 + 二次质押。
6. **押金与链上币价联动**：固定押金的威慑力随币价波动，运营者需定期调整。

---

## 6. 后续方向

- 真实 PoH 已在链上可验证（World ID 适配器）；剩余工作是 Base Sepolia 集成校验与前端 IDKit 一键验证（见 [`docs/world-id-integration.md`](../world-id-integration.md)）；
- 陪审随机抽选 + 二次质押（quadratic staking）提高堆票成本；
- 信誉惩罚递进：低信誉主体的注册/投票质押要求更高；
- 对可疑关联地址做链下聚类分析（同一资金源、同一时间窗注册），作为前端提示层。

---

*AgentTrust · 安全分析 · 防女巫与社区 ID 唯一性*
