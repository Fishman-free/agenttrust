# AgentTrust · 智能体互信协议

> 为智能体间商务提供 **身份注册、交易担保、争议裁决、信誉记录** 的可信基础设施。
> 区块链方案：四合约部署于本地 anvil 演示链 / Base Sepolia 测试网。

---

## 📌 这是什么

智能体（AI Agent）时代到来，智能体代替人类交易需要解决**互信**问题：怎么保证没有"骗子智能体"？出现骗子智能体后如何追责？

AgentTrust 用区块链智能合约实现一套完整闭环：

| 环节 | 合约 | 说明 |
|---|---|---|
| 🪪 **身份** | `AgentRegistry` | 给智能体铸造 ERC-721 Agent ID，绑定责任主体（owner），注册质押防女巫 |
| 🛡️ **担保** | `GuaranteeEscrow` | 交易资金进 escrow 托管；担保人质押担保；违约自动罚没 |
| ⚖️ **裁决** | `SchellingVoting` | 争议由社区质押投票裁决（Schelling 点收敛：说真话是占优策略） |
| 📊 **信誉** | `ReputationHub` | 交易结果链上存证，多维信誉档案，不可篡改、禁止自评 |

设计对齐行业标准 **ERC-8004（Trustless Agents）**。

---

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| 合约 | Solidity 0.8.24 + Foundry + OpenZeppelin v5 |
| 前端 | Next.js 16 + wagmi v3 + viem v2 + Tailwind v4 |
| 链 | 本地 anvil（演示）/ Base Sepolia（测试网） |
| 测试 | Foundry 38 个合约测试（TDD） |

---

## 🚀 快速开始

### 环境要求

- **Node.js ≥ 20**（前端）
- **Foundry**（合约；[安装教程](https://book.getfoundry.sh/getting-started/installation)，含 `forge`/`cast`/`anvil`）
- **MetaMask** 或其他钱包（演示需要，可导入 anvil 测试账户）

### 第一步：跑合约测试

```bash
cd contracts
export PATH="$HOME/.foundry/bin:$PATH"          # Windows：foundry 不在 PATH 时
NO_PROXY="127.0.0.1,localhost,::1" forge test -vvv
```

✅ 预期：**38 tests passed, 0 failed**（5 个测试套件）

### 第二步：启动本地演示链 + 部署合约

```bash
# 终端 1：启动本地链（保持运行）
NO_PROXY="127.0.0.1,localhost,::1" anvil --chain-id 31337 --port 8545

# 终端 2：部署四合约（anvil 确定性地址，重复部署地址不变）
cd contracts
export PATH="$HOME/.foundry/bin:$PATH"
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key $PRIVATE_KEY
```

部署后四合约地址（anvil 标准地址，已填入 `frontend/lib/config.ts`）：

| 合约 | 地址 |
|---|---|
| AgentRegistry | `0x5fBDB2315678afecb367f032d93F642f64180aa3` |
| ReputationHub | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| GuaranteeEscrow | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| SchellingVoting | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |

### 第三步：启动前端门户

```bash
cd frontend
npm install
npm run dev
```

打开 **http://localhost:3000**。

> **钱包准备**：MetaMask 添加本地网络 `http://127.0.0.1:8545`（chainId 31337），导入 anvil 测试账户私钥即可获得 10000 ETH 测试资金：
> - 账户 #0：`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
> - 账户 #1：`0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
> - 账户 #2：`0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`

---

## 🎬 5 分钟演示流程

> 完整细节见 [`contracts/demo/DEMO.md`](contracts/demo/DEMO.md)，以下是流程速览。

| 步骤 | 操作 | 预期结果 |
|---|---|---|
| 1️⃣ | 钱包 A 注册智能体 **DataAgent** | Agent ID = 0 |
| 2️⃣ | 钱包 B 注册智能体 **TraderAgent** | Agent ID = 1 |
| 3️⃣ | 钱包 B 创建担保交易（买家=1，卖家=0，金额 0.1 ETH）→ 付款 | 交易进入"已付款" |
| 4️⃣ | 任一钱包做**担保人**：覆盖率 100%、保费 0.005 ETH → 质押 0.1 | 交易进入"已担保" |
| 5️⃣ | 钱包 A 交付 → 钱包 B 确认 | 卖家收 **0.095**，担保人收 **0.105** |
| 6️⃣ | 再建一笔交易 → 争议 → 开设投票案 → 3 钱包投票（2 支持买家 / 1 支持卖家）→ 结算 | 买家拿回本金+罚没担保金，少数派投票质押被罚没 |
| 7️⃣ | 信誉页输入卖家 Agent ID | 看到信誉分变化（1 完成 + 1 败诉 = 75） |

---

## 📖 使用教程：门户四个页面

| 页面 | 路径 | 功能 |
|---|---|---|
| **智能体** | `/agents` | 连接钱包 → 填名称/描述/端点 → 注册（付注册费）；查看已注册列表 |
| **交易** | `/trade` | 创建交易 → ① 付款 → ② 担保（覆盖率+保费）→ ③ 交付 → ④ 确认 |
| **争议** | `/disputes` | 发起争议 → 开设投票案（平台）→ 社区投票（支持买家/卖家）→ 结算 → 领取奖励/退款 |
| **信誉** | `/reputation` | 输入 Agent ID → 查看信誉分 + 多维档案（完成/违约/胜诉/败诉） |

---

## 🔧 常见问题

**Q1: `forge test` 报 502 / 连不上 localhost？**
本机代理导致。所有链上命令必须带 `NO_PROXY="127.0.0.1,localhost,::1"`（见上文命令）。

**Q2: `forge` 命令找不到？**
Foundry 装在 `~/.foundry/bin`，不在 PATH。先执行 `export PATH="$HOME/.foundry/bin:$PATH"`。

**Q3: 前端连不上合约（交易失败/revert）？**
确认 anvil 在运行 + `frontend/lib/config.ts` 的四个地址与部署输出一致。若改了链，同步改 `frontend/lib/wagmi.ts`。

**Q4: 担保按钮失败？**
担保人质押额 = 交易金额 × 覆盖率，必须与表单输入一致。保费由**卖家**承担（交易成功时从卖家所得扣除），担保人只质押本金。

**Q5: 投票质押额不一致导致 revert？**
`SchellingVoting.vote` 要求质押额 == 案件 `stake` 精确一致。开设投票案和投票时保持同一质押额。

**Q6: 部署到真实链（Base Sepolia）？**
见 [`contracts/demo/DEMO.md`](contracts/demo/DEMO.md) 附注：设置测试网私钥（勿提交 git）→ `forge script ... --rpc-url https://sepolia.base.org --broadcast --verify` → 填地址 + 切回 baseSepolia。

---

## 🛡️ 机制设计

**担保人（Guarantor）** = 平台的保险角色：任何人为卖方智能体质押 `交易金额 × 覆盖率`，交易成功拿回本金 + 保费（保费由卖方承担）；若卖方违约/败诉，担保人质押被罚没补偿买方。

**Schelling 点社区投票** = 去中心化裁决：争议发生时，社区成员质押后投票（支持买家/卖家/弃权）。投票窗口结束后结算：多数方 ≥2/3 且有效票 ≥3 → 裁决成立，少数派质押罚没均分给多数派——**与多数一致（说真话）是占优策略**。裁决结果驱动 escrow 资金释放 + 信誉记录。

**信誉档案** = 链上 attestation：交易/裁决结果由合约记录（禁止自评），形成不可篡改的多维档案（完成数/违约数/争议胜负），供担保准入与定价参考。

---

## ⚖️ 合规说明

MVP 使用本地链/测试网代币模拟质押/罚没（**无真实价值**）。境内不发行任何可交易代币/凭证；担保责任由真实主体（agent owner）承担；智能体无民事主体资格，责任归属注册人。长期代币化需海外合规架构（详见[设计规格](docs/superpowers/specs/2026-08-08-agenttrust-design.md) §8）。

---

## 📚 文档

| 文档 | 路径 |
|---|---|
| 设计规格 | `docs/superpowers/specs/2026-08-08-agenttrust-design.md` |
| 实现计划 | `docs/superpowers/plans/2026-08-08-agenttrust-mvp.md` |
| 演示手册 | `contracts/demo/DEMO.md` |
| 论文研究笔记 | `docs/research/2026-08-09-paper-analysis.md` |
| 调研论文库 | `papers/README.md` |

## 📄 论文

**Schelling-Point Reputation Communities: A Decentralized Guarantee and Arbitration Layer for Agent-to-Agent Commerce**（进行中）
