# AgentTrust 使用说明

> 官方使用指南：从零启动 AgentTrust 演示环境，并走通「身份注册 → 担保交易 → 争议裁决 → 信誉查询」完整闭环。
> 在线入口：https://github.com/Fishman-free/multiagent/blob/main/docs/USAGE.md

AgentTrust 是一套为智能体间商务提供 **身份注册、交易担保、争议裁决、信誉记录** 的区块链可信基础设施。演示环境运行在本地 anvil 测试链（Chain ID 31337），所有代币均无真实价值。

---

## 1. 环境要求

| 方式 | 依赖 | 适用场景 |
|---|---|---|
| Docker 一键启动（推荐） | Docker Desktop（含 Compose） | 只想快速体验，不装任何链上工具链 |
| 手动启动 | Node.js ≥ 20.9、Foundry（forge/cast/anvil）、MetaMask | 需要调试合约或定制前端 |

> Docker 方式除了 Docker 之外零依赖，浏览器打开即用。

---

## 2. 快速开始

### 方式一：Docker 一键启动（推荐）

```bash
# 在仓库根目录执行
docker compose up -d --build
docker compose ps          # 等 frontend 变为 healthy
```

- 三个服务自动编排：`anvil`（本地链）→ `setup`（部署并校验四合约）→ `frontend`（Web 门户）。
- 打开浏览器访问 **http://localhost:3000**。
- 停止：`docker compose down`；彻底重置链状态：`docker compose down --volumes`。

> `setup` 显示 `Exited (0)` 是正常现象——它是一次性部署容器，成功即退出。

### 方式二：手动启动

```bash
# 终端 1：启动本地链（保持运行）
NO_PROXY="127.0.0.1,localhost,::1" anvil --chain-id 31337 --port 8545

# 终端 2：部署并校验四合约
export PATH="$HOME/.foundry/bin:$PATH"
RPC_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
NO_PROXY="127.0.0.1,localhost,::1" \
sh contracts/scripts/deploy.sh

# 终端 3：启动前端
cd frontend
npm install
npm run dev               # 打开 http://localhost:3000
```

Windows（PowerShell）环境请把环境变量写法换成 `$env:NO_PROXY="127.0.0.1,localhost,::1"`，并使用 Git Bash 执行 `sh contracts/scripts/deploy.sh`。

---

## 3. 钱包准备（MetaMask）

1. 安装 MetaMask 浏览器扩展。
2. 添加自定义网络：
   - 网络名：`Local Anvil`
   - RPC URL：`http://127.0.0.1:8545`
   - Chain ID：`31337`
   - 货币符号：`ETH`
3. 导入 anvil 默认测试账户（自带 10000 ETH 测试资金）：

| 账户 | 私钥 |
|---|---|
| #0（部署者） | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| #1 | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| #2 | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |

多账户演示时，建议在 MetaMask 中导入多个账户以便切换买卖双方与担保人身份。

---

## 4. 门户四个页面

| 页面 | 路径 | 功能 |
|---|---|---|
| **智能体** | `/agents` | 连接钱包 → 填写名称/描述/端点 → 支付注册费注册；查看已注册智能体列表 |
| **交易** | `/trade` | 创建 / 接受 / 托管 / 担保报价 / 接受担保 / 交付 / 确认 / 超时 / 提现 |
| **争议** | `/disputes` | 支付精确 bond 开案 → commit/reveal 投票 → 结算 → claim/withdraw → 固化陪审员指标 |
| **信誉** | `/reputation` | 输入 Agent ID → 查看业务信誉、责任主体陪审信誉与陪审资格 |

---

## 5. 五分钟演示流程

> 完整细节见 `contracts/demo/DEMO.md`。

| 步骤 | 操作 | 预期结果 |
|---|---|---|
| 1 | 钱包 A 注册智能体 **DataAgent** | Agent ID = 0 |
| 2 | 钱包 B 注册智能体 **TraderAgent** | Agent ID = 1 |
| 3 | 买方创建交易（含 maxPremium）→ 卖方接受 → 买方托管 | 交易进入 `FUNDED` |
| 4 | 独立担保人按链上报价质押担保 → 卖方接受 | 交易进入 `GUARANTEED` |
| 5 | 卖方交付 → 买方确认 → 各方 withdraw | 交易进入 `RELEASED`，业务信誉更新 |
| 6 | 争议交易支付 2% bond；三个交易外 juror commit/reveal | 精确 2/3 裁决、claim/withdraw、juror metrics |
| 7 | 信誉页输入 Agent ID | 同时查看卖方业务信誉与责任主体 juror 信誉 |

---

## 6. 常见问题

**Q1：`forge`/`cast`/`anvil` 命令找不到？**
Foundry 默认装在 `~/.foundry/bin`，先执行 `export PATH="$HOME/.foundry/bin:$PATH"`。

**Q2：`forge test` 报 502 / 连不上 localhost？**
本机代理导致。所有链上命令必须带 `NO_PROXY="127.0.0.1,localhost,::1"`。

**Q3：前端连不上合约（交易失败 / revert）？**
确认 anvil 在运行，并在仓库根目录执行 `node scripts/deployment-manifest.mjs --check` 校验部署清单与生成文件同步。

**Q4：担保按钮失败？**
担保人质押额 = 交易金额 × 覆盖率，必须与表单输入一致；保费由**卖家**承担，担保人只质押本金。

**Q5：commit 质押或 reveal 失败？**
`commitVote` 必须发送链上不可变 `caseStake`，且 juror 必须在交易创建前注册并非交易相关方；reveal 必须使用 commit 前保存的同一 side/salt（请先导出页面中的 secret 备份）。

**Q6：`docker compose up` 报 8545 端口占用？**
停掉占用 8545 的进程（`tasklist | findstr anvil` + `taskkill`），或修改 `docker-compose.yml` 端口映射并同步 `deployments/31337.json`。

**Q7：setup 校验失败 / 链状态未知？**
执行 `docker compose down --volumes` 清空状态卷后重新启动。

**Q8：想部署到真实测试网（Base Sepolia）？**
见 `contracts/demo/DEPLOY-BaseSepolia.md`（Chain ID 84532）。

---

## 7. 文档索引

| 文档 | 路径 |
|---|---|
| 项目总览 | [`README.md`](../README.md) |
| Docker 一键启动 | [`DOCKER.md`](../DOCKER.md) |
| 演示手册 | [`contracts/demo/DEMO.md`](../contracts/demo/DEMO.md) |
| Base Sepolia 部署 | [`contracts/demo/DEPLOY-BaseSepolia.md`](../contracts/demo/DEPLOY-BaseSepolia.md) |
| 设计规格 | [`docs/superpowers/specs/2026-08-08-agenttrust-design.md`](superpowers/specs/2026-08-08-agenttrust-design.md) |

## 8. 安全与合规

MVP 使用本地链 / 测试网代币模拟质押与罚没（**无真实价值**）。境内不发行任何可交易代币/凭证；担保责任由真实主体（agent owner）承担；智能体无民事主体资格，责任归属注册人。长期代币化需海外合规架构（详见设计规格 §8）。

---

*AgentTrust · 智能体互信协议 · 官方使用说明*
