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

### 路径 3：无人类证明（PoH）锚定（结构性缺口，已补钩子）
纯链上系统无法区分"一个真人"与"一万个钱包"——这是 EVM 的固有限制，任何纯链上方案都只能**提高成本**而不能**证明唯一**。真实唯一性必须来自链下预言机（World ID / Gitcoin Passport / TEE 硬件证明等）。

**修补**：`AgentRegistry` 新增可选 PoH 层：
- `IAgentProofOfPersonhood` 接口 + `setPoHVerifier`（仅 owner，可设 `address(0)` 关闭）；
- `registerAgentVerified(name, desc, endpoint, nullifier, proof)`：注册必须消费一个有效且**未使用过**的 nullifier；
- 注册表本地记录 `usedPoHNullifiers`，作为预言机被绕过的第二道防线；
- PoH 开启后，普通 `registerAgent` 路径被禁用，强制走人类证明。

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
| `contracts/src/AgentRegistry.sol` | 一人一 ID `require`；`IAgentProofOfPersonhood` 接口；`pohVerifier`/`usedPoHNullifiers`；`registerAgentVerified`；`setPoHVerifier` |
| `contracts/script/Deploy.s.sol` | `REGISTRATION_FEE` 环境变量（默认 0.01 ether） |
| `contracts/test/mocks/MockPoHVerifier.sol` | 测试预言机：非空证明有效、nullifier 只可消费一次 |
| `contracts/test/AgentRegistry.t.sol` | 新增 3 个测试：同主体二重注册拒绝、人类证明跨钱包唯一、验证器权限 |
| `contracts/test/GuaranteeEscrow.t.sol`、`SchellingVoting.t.sol` | 适配一人一 ID 语义 |
| `deployments/31337.json`、`frontend/lib/deployments.ts` | 重新生成（registry runtime bytecode 变化） |

验证：`forge test` **97/97 通过**；`npm test` 67/67 通过；manifest `--check` 全绿。

---

## 5. 残余风险（诚实声明）

1. **质押只能提高成本**：资金充裕的攻击者仍可买大量身份；唯一性的硬保证依赖 PoH 预言机。
2. **PoH 预言机自身风险**：预言机可信度、隐私（生物特征）、覆盖人群都是外部依赖；`setPoHVerifier` 权限在 owner，属治理风险点。
3. **链上不可识别关联地址**：同一实体用互不相关钱包（不共享 nullifier 时）仍可绕过 PoH——除非预言机按"人"发证明且一人一证。
4. **陪审并非随机抽选**（已知限制）：若攻击者绕过 ID 唯一性，仍可定向堆票；长期方向是随机抽选 + 二次质押（见设计规格 §5）。
5. **注册费与链上币价联动**：固定 0.01 ETH 的威慑力随币价波动，运营者需定期调整。

---

## 6. 后续方向

- 接入真实 PoH 预言机（World ID / Gitcoin / 政府或机构 DID）；
- 陪审随机抽选 + 二次质押（quadratic staking）提高堆票成本；
- 信誉惩罚递进：低信誉主体的注册/投票质押要求更高；
- 对可疑关联地址做链下聚类分析（同一资金源、同一时间窗注册），作为前端提示层。

---

*AgentTrust · 安全分析 · 防女巫与社区 ID 唯一性*
