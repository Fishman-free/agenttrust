# AgentTrust 论文深度研究笔记

> **日期**：2026-08-09
> **研究对象**：
> - 学术论文初稿：《基于区块链的智能体交互安全性研究》（PDF，13 页，完整文本见 `paper-extract.txt`）
> - 调研底稿：《基于区块链技术的智能体之间交互安全性研究 —— 深度调研报告》（`01_深度调研报告(1).md`）
> - 关联代码：AgentTrust 四合约 MVP（`contracts/`，94 测试全通过）

---

## 1. 文档定位

| | PDF 论文 | 调研报告 |
|---|---|---|
| 性质 | 学术论文初稿（精炼版） | 调研底稿（详实版） |
| 核心产物 | **ITA 三层信任架构**（身份-信任-责任） | 对用户模型的逐环节评估 + 分阶段路线图 |
| 关系 | 报告的学术化提炼 | 论文的事实基础 |

**关键判断**：两份文档是 AgentTrust 项目的"论文初稿 + 调研底稿"，其 ITA 架构与已实现代码是同一设计的两种形态。

## 2. ITA 三层信任架构（论文核心）

```
Layer 3 责任层：仲裁(Kleros/UMA) · 担保保险(Nexus) · 罚没/吊销
Layer 2 信任层：信誉证明(EAS) · 情境化评分 · 授权委托(VC)
Layer 1 身份层：DID + VC + SBT(EIP-5192/4973) + ERC-4337 + 人格证明
```

**建模质量**：
- 三类主体：智能体 Ai / 认证担保服务商 S / 仲裁执法主体 E
- 六项信任属性：身份真实性、不可抵赖性、可追溯性、公平性、激励兼容、隐私可调
- 四类攻击：女巫攻击、信誉操纵、作恶后逃避、单点权威滥用
- 核心主张：从"中心化信用裁判"→"去中心化信任基础设施运营商与规则制定者"

## 3. 学术严谨性评估

### 3.1 已验证的文献基础（关键引文 4/4 真实）

| arXiv ID | 标题 | 日期 | 作者 |
|---|---|---|---|
| 2607.00245 | Agent-to-Agent Finance: Blockchain Payments and Trust Infrastructure for Autonomous AI Agents | 2026-06-30 | Hui Gong |
| 2608.04626 | Blockchain Empowered Trustworthy Agent Networks | 2026-08-05 | Liehuang Zhu |
| 2605.00073 | AgentReputation: A Decentralized Agentic AI Reputation Framework | 2026-04-30 | Mohd Sameen Chishti |
| 2604.22652 | A dataset of early blockchain-registered AI agents on Ethereum | 2026-04-24 | Yulin Liu |

与项目此前调研代理的文献库交叉印证，技术栈描述准确。

### 3.2 作为顶会/期刊论文的缺口

1. **缺形式化**：六信任属性、四攻击是定性清单，无定理/证明
2. **缺实证（Evaluation）**：全文 0 实验、0 实现、0 案例
3. **创新点未展开**：Schelling 信誉社区（真实增量）无机制细节
4. **引用格式**：`export.arxiv.org/api` 查询接口应换 `arxiv.org/abs/xxx`；[n] 与 URL 混用

## 4. 论文 ↔ 代码精确映射

| 论文 ITA 架构 | 代码实现 | 状态 |
|---|---|---|
| Layer 1 身份层 | `AgentRegistry`（ERC-721 + owner 责任绑定 + 注册质押） | ✅ |
| Layer 2 信任层 | `ReputationHub`（四维档案，情境化多维评分） | ✅ |
| Layer 3 责任层 | `GuaranteeEscrow`（escrow + 担保人质押 + 罚没）+ `SchellingVoting`（社区质押投票） | ✅ |
| 取证链路 | E2E 全链路测试 | ✅ |

**含义**：论文缺的 Evaluation 章节已由代码写好——四合约 + 94 测试 + E2E 业务故事就是"系统实现与实验"素材。

## 5. 论文补齐路径（顶会/期刊水平）

1. **代码补实证**：GuaranteeEscrow 状态机、SchellingVoting 收敛判定、E2E 罚没流程 → System Implementation 章节（合约地址、gas、状态转换图）
2. **形式化补理论**：诚实均衡定理（与多数一致率 >50% 时诚实为占优策略）
3. **Schelling 信誉社区展开为独立创新点**（第四章：社区质押投票 → 担保定价 → 争议裁决 → 信誉更新闭环；调研确认全行业空白）
4. **仿真对比**：Python mesa 验证 2/3 多数 + 罚没在 Sybil/共谋下的稳健性

## 6. 待办衔接

- **T13 真实部署挂起**：用户已选"真实部署 Base Sepolia"，等待用户 `!` 输入私钥后继续
- **论文计划**（writing-plans 第二阶段）：机制形式化 + mesa 仿真 + 论文写作
