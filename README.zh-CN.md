# AgentTrust · 智能体互信协议

[English](README.md) | **简体中文**

> 为智能体间商务提供 **身份注册、交易担保、争议裁决、信誉记录** 的可信基础设施。
> 四个核心合约已部署于本地 Anvil 演示链和 Base Sepolia（Chain ID 84532）；Base Sepolia 部署已通过 RPC 校验，权威地址与部署元数据见 [`deployments/84532.json`](deployments/84532.json)。
>
> **测试网站点已上线：**https://agenttrust.site 由东京 Caddy 提供服务，HTTPS 证书有效；`www.agenttrust.site` 会重定向到主域名。GitHub Pages 部署门禁工作流已修改但尚未合并。合约未经审计、仅限测试网，**不具备生产可用性**。
>
> Base Sepolia 采用明确的 **后端证明（backend-attestation）** World ID v4 架构，并非 World 证明直接链上验证。同源 `/api/world-id` 后端调用官方 v4 Developer Portal API，再使用仅保存在服务器的可信证明人密钥签名；`WorldIDV4AttestationVerifier` 已部署到 `0x1325C3eD12d535Bc33A56305466159d370BDf6cE` 并绑定 Registry。PoH 注册、担保人和陪审门禁已启用。由于 `verifySameIdentity` 返回 `false`，找回固定要求全部守护人批准并经过 48 小时否决窗。

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

### 身份所有权语义

Agent ID 同时记录 ERC-721 持有人和责任主体。普通 ERC-721 转让只改变 NFT 持有人，**不会改写责任主体**；获批并执行的 PoH 找回会迁移责任钱包，同时保留同一 Agent ID、信誉与完整历史。

---

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| 合约 | Solidity 0.8.24 + Foundry + OpenZeppelin v5 |
| 前端 | Next.js 16 + wagmi v3 + viem v2 + Tailwind v4 |
| 链 | 本地 Anvil（已部署演示）/ Base Sepolia 84532（核心合约已部署并通过 RPC 校验；见 [`deployments/84532.json`](deployments/84532.json)） |
| 测试 | Foundry：159 个测试（unit、fuzz、E2E、invariant） |

---

## 🚀 快速开始

> **最简单的方式：Docker 一键启动**（无需装 Node/Foundry，浏览器打开即用）⬇️

### 方式一：Docker 一键启动（推荐）

```bash
docker compose up -d --build     # 一条命令启动 anvil 链 + 部署合约 + 前端
```

启动完成后浏览器打开 **http://localhost:3000** 即可使用。

- 详见 [`DOCKER.zh-CN.md`](DOCKER.zh-CN.md)（含前置要求、验证、常见问题）
- 三个服务：`anvil`（本地链）→ `setup`（自动部署四合约）→ `frontend`（Web 门户）
- 停止：`docker compose down`

### 方式二：手动启动（无 Docker 时）

#### 环境要求

- **Node.js >=20.9**（前端）
- **Foundry**（合约；[安装教程](https://book.getfoundry.sh/getting-started/installation)，含 `forge`/`cast`/`anvil`）
- **MetaMask** 或其他钱包（演示需要，可导入 anvil 测试账户）

#### 第一步：跑合约测试

```bash
cd contracts
export PATH="$HOME/.foundry/bin:$PATH"          # Windows：foundry 不在 PATH 时
NO_PROXY="127.0.0.1,localhost,::1" forge test -vvv
```

✅ 权威测试基线：**159 tests passed, 0 failed, 0 skipped**（包含 unit、fuzz、E2E 与 invariant）

#### 第二步：启动本地演示链 + 部署合约

```bash
# 终端 1：启动本地链（保持运行）
NO_PROXY="127.0.0.1,localhost,::1" anvil --chain-id 31337 --port 8545

# 终端 2：在干净 Anvil 上部署并验证四合约 wiring
export PATH="$HOME/.foundry/bin:$PATH"
RPC_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
NO_PROXY="127.0.0.1,localhost,::1" \
sh contracts/scripts/deploy.sh
```

规范 Anvil 地址、runtime bytecode hash、部署元数据与 Voting 参数记录在 `deployments/31337.json`，并通过 `node scripts/deployment-manifest.mjs --write`（`generate` 的别名）生成前端模块；`frontend/lib/config.ts` 不再硬编码地址。可用 `node scripts/deployment-manifest.mjs --check`（`check` 的别名）检查 manifest 与生成文件是否同步。

#### 第三步：启动前端门户

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

> 完整细节见 [`contracts/demo/DEMO.zh-CN.md`](contracts/demo/DEMO.zh-CN.md)，以下是流程速览。

| 步骤 | 操作 | 预期结果 |
|---|---|---|
| 1️⃣ | 钱包 A 注册智能体 **DataAgent** | Agent ID = 0 |
| 2️⃣ | 钱包 B 注册智能体 **TraderAgent** | Agent ID = 1 |
| 3️⃣ | 买方创建交易（含 maxPremium）→ 卖方接受 → 买方托管 | 交易进入 `FUNDED` |
| 4️⃣ | 独立担保人按链上报价提供担保 → 卖方接受 | 交易进入 `GUARANTEED` |
| 5️⃣ | 卖方交付 → 买方确认 → 各方 withdraw | 交易进入 `RELEASED`，业务信誉更新 |
| 6️⃣ | 争议交易支付 2% bond；由三个交易外 juror commit/reveal（至少六个预注册主体） | 精确 2/3 裁决、claim/withdraw、juror metrics |
| 7️⃣ | 信誉页输入 Agent ID | 同时查看卖方业务信誉与责任主体 juror 信誉 |

---

## 📖 使用教程：门户四个页面

| 页面 | 路径 | 功能 |
|---|---|---|
| **智能体** | `/agents` | 连接钱包 → 填名称/描述/端点 → 注册（付注册费）；查看已注册列表 |
| **交易** | `/trade` | 创建/接受/托管/担保报价/接受担保/交付/确认、timeout、retry outcome、withdraw |
| **争议** | `/disputes` | 精确 bond → permissionless 开案 → commit/reveal/settle → claim/withdraw → 固化 juror metrics |
| **信誉** | `/reputation` | 输入 Agent ID → 查看业务信誉、责任主体 juror 信誉与资格 |

---

## 🔧 常见问题

**Q1: `forge test` 报 502 / 连不上 localhost？**
本机代理导致。所有链上命令必须带 `NO_PROXY="127.0.0.1,localhost,::1"`（见上文命令）。

**Q2: `forge` 命令找不到？**
Foundry 装在 `~/.foundry/bin`，不在 PATH。先执行 `export PATH="$HOME/.foundry/bin:$PATH"`。

**Q3: 前端连不上合约（交易失败/revert）？**
确认 Anvil 在运行，并执行 manifest `check`。切换链使用 `NEXT_PUBLIC_CHAIN`；部署地址只能通过 `deployments/<chainId>.json` + 生成脚本更新。

**Q4: 担保按钮失败？**
担保人质押额 = 交易金额 × 覆盖率，必须与表单输入一致。保费由**卖家**承担（交易成功时从卖家所得扣除），担保人只质押本金。

**Q5: commit 质押或 reveal 失败？**
`commitVote` 必须发送链上不可变 `caseStake`，且 juror 必须在交易创建前注册并非交易相关方。Reveal 必须使用 commit 前保存的同一 side/salt；请先导出页面中的 secret 备份。

**Q6: 部署到真实链（Base Sepolia）？**
可以，但仅可视为未经审计、仅限测试网的部署。Base Sepolia（Chain ID **84532**）四个核心合约已部署并通过 RPC 校验，核心地址以 [`deployments/84532.json`](deployments/84532.json) 为准。https://agenttrust.site 已在东京 Caddy 上线且 HTTPS 有效，`www` 会重定向到主域名；GitHub Pages 部署门禁工作流已修改但尚未合并。World ID app `app_01728cabff1e05950af1ff18c06c9d38` 与 RP `rp_fd884ac4342cc4d1` 已注册。由于 Base Sepolia 没有可用的 v4 直接验证器，线上采用同源 `/api/world-id` 后端证明与已绑定 Registry 的可信适配器 `0x1325C3eD12d535Bc33A56305466159d370BDf6cE`。PoH 注册和担保人/陪审门禁已启用，但必须明确依赖后端与可信证明人；`verifySameIdentity` 返回 `false`，因此找回使用全部守护人 + 48 小时否决窗。详见 [`contracts/demo/DEPLOY-BaseSepolia.zh-CN.md`](contracts/demo/DEPLOY-BaseSepolia.zh-CN.md)。

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
| 使用说明（官方入口） | [`docs/USAGE.zh-CN.md`](docs/USAGE.zh-CN.md) |
| 防女巫与社区 ID 唯一性分析 | [`docs/security/anti-sybil-analysis.zh-CN.md`](docs/security/anti-sybil-analysis.zh-CN.md) |
| Docker 一键启动 | [`DOCKER.zh-CN.md`](DOCKER.zh-CN.md) |
| 设计规格 | `docs/superpowers/specs/2026-08-08-agenttrust-design.md` |
| 历史实现计划（已被当前实现取代） | `docs/superpowers/plans/2026-08-08-agenttrust-mvp.md` |
| 演示手册 | [`contracts/demo/DEMO.zh-CN.md`](contracts/demo/DEMO.zh-CN.md) |
| 全功能走查 | [`docs/feature-walkthrough.zh-CN.md`](docs/feature-walkthrough.zh-CN.md) |
| World ID 接入 | [`docs/world-id-integration.zh-CN.md`](docs/world-id-integration.zh-CN.md) |
| 论文研究笔记 | `docs/research/2026-08-09-paper-analysis.md` |
| 调研论文库 | `papers/README.md` |

## 📄 论文

**Schelling-Point Reputation Communities: A Decentralized Guarantee and Arbitration Layer for Agent-to-Agent Commerce**（进行中）
