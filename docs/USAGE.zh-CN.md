# AgentTrust 使用说明

[English](USAGE.md) | **简体中文**

> **面向对象**：想快速体验智能体互信协议的研究者、演示者，以及准备本地运行或二次开发的工程师。
> **读完本文你将能**：一键启动演示环境 → 配置钱包 → 走通「身份注册 → 担保交易 → 争议裁决 → 信誉查询」完整闭环。
> **在线地址**：https://github.com/Fishman-free/multiagent/blob/main/docs/USAGE.zh-CN.md

---

## 1. AgentTrust 是什么

智能体（AI Agent）代替人类交易时，最大的障碍是**互信**：如何确认对方不是"骗子智能体"？出现违约后如何追责？

AgentTrust 用四个智能合约构成一条完整信任闭环，全部状态与结果**链上可核验**：

| 环节 | 合约 | 职责 |
|---|---|---|
| 🪪 身份 | `AgentRegistry` | 铸造 ERC-721 Agent ID，绑定责任主体（owner），注册防女巫；普通 NFT 转让不改写责任主体，获批的 PoH 找回会迁移责任钱包并保留 ID/历史 |
| 🛡️ 担保 | `GuaranteeEscrow` | 交易资金托管（escrow）、担保人质押担保、违约自动罚没、pull-payment 提现 |
| ⚖️ 裁决 | `SchellingVoting` | 争议由社区质押投票裁决（Schelling 点收敛：说真话是占优策略） |
| 📊 信誉 | `ReputationHub` | 交易结果链上存证，多维信誉档案，不可篡改、禁止自评 |

**四大产品优势**：

1. **链上可核验**——身份、资金、裁决、信誉全部上链，任何人可独立验证，无中心化背书。
2. **资金安全**——交易本金进 escrow 托管；卖方违约时担保质押被罚没补偿买方。
3. **去中心化裁决**——争议由社区 commit–reveal 秘密投票，公开可审计，无单点裁判。
4. **责任可追溯**——智能体无民事主体资格，责任由注册时绑定的真实主体承担，违约可追责。

> 演示环境运行在本地 anvil 测试链（Chain ID 31337），所有代币**无真实价值**，仅用于模拟。

---

## 2. 系统构成与关键参数

### 2.1 交易状态机（10 个状态）

```
已创建 CREATED ──卖家接受──▶ 已接受 ACCEPTED ──买家托管──▶ 已托管 FUNDED
                                                               │ 担保人质押报价
已放款 RELEASED ◀──买家确认── 已交付 DELIVERED ◀──卖家接受── 担保已报价 GUARANTEE_OFFERED
                 │                                                        ▲
                 └──卖家交付──── 担保生效 GUARANTEED ─────────────────────┘
已交付 DELIVERED ──支付争议保证金──▶ 争议中 DISPUTED ──裁决──▶ 已裁决 RESOLVED
任意非终态 ──超时窗口到期──▶ 已作废 VOIDED（按阶段退款）
```

- 前端交易页会**实时高亮**当前所处状态，并只展示该状态允许的操作。
- 每个状态都有超时窗口，任何账户可在到期后调用对应 timeout 动作推进（链上会校验是否真正到期）。

### 2.2 关键参数（本地演示链）

| 参数 | 值 | 说明 |
|---|---|---|
| 争议保证金（bond） | 交易金额的 **2%**（向上取整） | 发起争议时支付，链上精确读取 |
| 注册押金 | **0.01 ETH**（默认，`REGISTRATION_DEPOSIT` 可配） | 可全额退还的防女巫押金：注销时自动转入待提取余额；**两个注册通道押金一致** |
| 社区 ID 唯一性 | **一人一 ID** | 同一责任主体（钱包）终身只能领取一个社区 ID，重复注册会被链上拒绝 |
| 人类验证（PoH） | **World ID 双通道** | PoH 注册/`bindPoH` 升级解锁找回、担保人、陪审员资格；普通注册可买卖但无找回、不能担保/陪审 |
| 找回（PoH 身份） | World ID + 守护人分级 | 同人证明 + 1 守护人（**24h** 否决窗）；无同人证明则全守护人批准（**48h** 否决窗）；7 天执行窗，信誉不清零 |
| 陪审质押（caseStake） | **0.1 ETH / 人** | commit 投票时随承诺一起质押；陪审员须完成人类验证 |
| 举证窗口 | 争议后 **1 天** | 买卖双方各提交一份证据（IPFS 内容哈希 + 链上摘要，可覆盖更新）；未举证仅标记 |
| 开案时限 | 争议后 **2 天** | 举证窗口结束后方可 `openCase`（任何人可调），超时走超时作废 |
| 投票窗口 | 志愿 commit **1 天** + 随机 commit **1 天** + reveal **1 天** | 本地可用 `evm_increaseTime` 快进（见 §6.3） |
| 裁决门槛 | 多数方 ≥ **2/3** 且有效票 ≥ **3** | 满足才产生有效裁决 |
| 默认信誉分 | **50**（0–100） | 无记录的新智能体 |
| 信誉公式 | `100 − (100×违约次数 + 50×争议败诉) / 总样本数` | 完成交易不扣分，违约重罚、败诉轻罚；**买卖双方均记账**（买方分数仅展示、不参与定价） |
| 新智能体担保条件 | 最低覆盖率 **75%**、参考保费率 **7.5%** | 由 50 分信誉映射而来，页面直接读链上报价 |
| 保费分档 | ≤1 ETH **+0**；1–10 ETH **+1%**；>10 ETH **+2.5%，每多 10 ETH 再 +0.5%** | 附加在信誉基准费率上（风险集中定价），总费率不超过 20% 封顶 |
| 担保人敞口上限 | **5 ETH / 主体**（`MAX_OPEN_STAKE` 可配） | 担保人所有未结质押之和超限时新报价被拒；交易页显示剩余可担保额度 |
| 保费上限 | 交易金额的 **20%** | 超出会被链上拒绝 |
| 陪审资格 | 样本 <3 视为合格；之后揭示率须 ≥ **80%** | 争议页显示资格快照 |

---

## 3. 快速开始

### 方式 A：Docker 一键启动（推荐，零链上依赖）

**前置要求**：仅需 Docker Desktop（含 Compose）。

```bash
# 仓库根目录
docker compose up -d --build     # 构建并启动 anvil + setup + frontend
docker compose ps                # 等 frontend 变为 healthy
```

浏览器打开 **http://localhost:3000** 即可使用。

- `setup` 显示 `Exited (0)` 是**正常现象**——它是一次性部署容器：部署四个合约、逐项校验 runtime bytecode、依赖、授权与所有权，成功后退出。
- 停服：`docker compose down`（保留链状态，再次 up 会复用并重新校验）；彻底重置：`docker compose down --volumes`。

### 方式 B：手动启动（需要 Node.js >=20.9 + Foundry）

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
npm run dev                      # 打开 http://localhost:3000
```

> **Windows**：环境变量改用 `$env:NO_PROXY="..."`，`deploy.sh` 用 Git Bash 执行。
> **代理机器**：所有连 localhost 的链上命令必须带 `NO_PROXY="127.0.0.1,localhost,::1"`，否则会 502。

### 启动成功标志

| 检查 | 预期 |
|---|---|
| `docker compose ps` | `anvil` healthy、`setup` Exited (0)、`frontend` healthy |
| `curl http://localhost:3000/healthz` | 200 |
| 首页右上角网络徽章 | 绿色圆点 + `Local Anvil`（而非"Research Preview"） |

---

> **权威测试基线**：**183 tests passed, 0 failed, 0 skipped**。

## 4. 钱包准备（MetaMask）

1. 安装 MetaMask 浏览器扩展。
2. **添加网络**：网络名 `Local Anvil` · RPC `http://127.0.0.1:8545` · Chain ID `31337` · 符号 `ETH`。
3. **导入测试账户**（anvil 默认账户，各含 10000 ETH）：

| 账户 | 私钥 | 演示中的角色建议 |
|---|---|---|
| #0 | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` | 买家 |
| #1 | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` | 卖家 |
| #2 | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` | 担保人 |

> 争议演示需要 8 个不同主体（买家/卖家/担保人 + 5 名 juror：2 名志愿 + 3 名随机，对应 0.1 ETH 争议的 5 席陪审团），可继续导入 anvil 账户 #3–#7（`anvil` 启动日志会打印全部私钥）。
> **切换身份** = 在 MetaMask 中切换当前账户；页面会跟随显示当前账户对应的可用操作。

---

## 5. 门户使用指南

门户共四个功能页 + 一个落地页。右上角钱包控件负责连接/断开/切换网络。

### 5.1 智能体页 `/agents` —— 注册身份

**功能**：铸造 ERC-721 Agent ID，把智能体与责任主体（钱包地址）链上绑定。

**操作步骤**：

1. 点击"连接钱包"（页首或页内均可）；
2. 填写智能体名称（如 `DataAgent`）、能力描述、MCP/A2A 端点；
3. 填写 **2–3 位守护人**（紧急联系人地址，找回身份用）；
4. 选择注册通道：默认**普通注册**（押金 0.01 ETH、无找回、不能担保/陪审）；勾选"使用 World ID 人类验证注册"后填入 nullifier 与证明（测试网可填 `0x01` 模拟）走 **PoH 注册**（同样押金、全能）；
5. 点击"注册"，在钱包中确认交易；
6. 成功后页面显示新 Agent ID（从 0 递增），列表即时刷新。

**身份管理**（注册后同页可用）：

- **绑定 PoH（升级）**：普通注册用户会在页面看到风险警示——丢失私钥无法找回、不能担保/陪审。在警示区填入 nullifier 与证明（测试网可模拟），点击"绑定 PoH（升级为已验证身份）"即可随时升级；两个通道押金一致，无需补缴或退款。
- **注销并退还押金**：名下没有未了结交易/陪审义务时，一键注销——Agent ID 永久退役、押金自动转入待提取余额，再点"提取待提取余额"到账；注销后该钱包终身不能再注册。
- **找回**（仅 PoH 身份）：私钥丢失时，新钱包可携带 World ID 同人证明发起找回（需命令行工具，见 `docs/world-id-integration.md`）——同人证明成功则任一守护人批准 + **24 小时**否决窗；设备也丢失（无同人证明）则需**全部守护人**批准 + **48 小时**否决窗。守护人在本页输入被守护人地址即可"批准找回"；原钱包在否决窗口内可"否决找回"。找回成功后责任钱包、NFT 控制权、信誉和押金迁移到新钱包，同时保留原 Agent ID 与完整历史。

**注意**：普通 ERC-721 转让只改变 NFT 持有人，不会改写责任主体。只有获批并执行的 PoH 找回才会把责任钱包迁移到新钱包，同时保留 Agent ID、信誉与完整历史。

### 5.2 交易页 `/trade` —— 担保交易闭环

**功能**：创建、接受、托管、担保、交付、确认、超时与提现，全流程按链上状态推进。

**三块面板**：

| 面板 | 用途 |
|---|---|
| ① 创建交易（买家） | 填买卖双方 Agent ID、金额、最高保费 → 实时显示 `quoteGuaranteeTerms` 链上报价 → 创建 |
| ② 查询并推进交易 | 输入 Trade ID 查看 10 状态高亮、交易明细，按当前状态执行对应操作 |
| ③ 提取余额 | 显示 `pendingWithdrawals` 可提取余额，一键提现 |

**操作要点**：

- 担保人质押额 = 交易金额 × 覆盖率，**必须**与表单输入一致（页面显示链上精确值）；
- 保费由**卖家**承担（结算时从卖家所得中扣除），担保人只质押本金；
- 状态 `DELIVERED` 时买卖双方可将争议带往争议页（页面提供直达链接）；
- 每步操作都会显示"为何不可用"的具体原因（如"仅卖家责任主体可接受交易"）。

### 5.3 争议页 `/disputes` —— 社区裁决

**功能**：举证 → 支付精确保证金开案 → 社区 commit/reveal 投票 → 结算 → 领取 → 固化陪审指标。

**操作流程**：

1. **发起争议**：输入 Trade ID（仅买卖双方责任主体可发起），支付链上读取的精确 bond（交易金额 2%）；
2. **举证（单轮，1 天窗口）**：争议双方各提交一份证据（IPFS 内容哈希锚定 + 链上文字摘要，窗口内可覆盖更新；未举证只标记"未举证"，不自动处罚）。页面提供"上传证据到 IPFS"入口（粘贴自己的 Pinata JWT 即可 pin 文件），或自行托管后粘贴 CID/32 字节摘要；证据区自动渲染双方证据卡片（摘要、CID、网关链接）并提供**哈希校验按钮**，同时展示双方信誉分、四计数器与最近交易，供陪审员裁决参考。⚠️ 文件无人托管会从 IPFS 网络消失——链上摘要与哈希永久保留；
3. **无许可开案**：举证窗口（1 天）结束后、2 天内，任何人可调用 `openCase`，开案后自动载入 Case ID（证据随之冻结）；
4. **投票**（陪审团规模随金额分档 5/7/9/11/13 席，半志愿半随机）：志愿窗口（1 天）内志愿陪审员先到先得占前半席位，各自选择立场 →"生成秘密并提交承诺"（自动安全生成 salt 并本地备份，质押 0.1 ETH）；志愿窗口结束后任何人可点"抽取随机陪审团"，被抽中者在随机窗口（1 天）内提交承诺 → 揭示阶段用同一 secret 揭示；
5. **结算**：reveal 窗口结束后任何人可 `settle`；有效裁决需多数方 ≥2/3 且有效票 ≥3；
6. **领取**：胜方/已揭示弃权者可 `claim`，再 `withdraw` 提取；败方与未揭示者质押被罚没；
7. **固化指标**：`finalizeJurorMetrics` 把揭示率/共识一致率写入责任主体陪审档案。

> ⚠️ **重要**：投票秘密保存在浏览器 localStorage，**清缓存/换浏览器会导致无法揭示并损失 0.1 ETH 质押**。提交后请立即用页面"复制秘密备份"导出 JSON 妥善保存。
> ⚠️ juror 必须在交易创建前注册（资格在创建时快照），且不能是交易相关方。

### 5.4 信誉页 `/reputation` —— 链上档案

**功能**：输入 Agent ID，查看业务信誉与责任主体的陪审信誉。

| 板块 | 内容 |
|---|---|
| 信誉分 | 0–100，新智能体默认 50；公式见 §2.2 |
| 业务统计 | 完成交易 / 违约次数 / 争议胜诉 / 争议败诉 |
| 链上身份 | 当前责任主体、当前 NFT 所有者（普通转让不改责任主体；PoH 找回会迁移责任钱包） |
| 陪审信誉 | 已结案样本、已揭示投票、弃权、揭示率、共识一致率、当前陪审资格 |

**解读**：共识一致只表示"与协议有效裁决一致"，不代表客观真相；数据由 ReputationHub 链上记录，禁止自评、不可篡改。

---

## 6. 完整演示剧本

### 6.1 剧本 A：三主体正常交易（约 3 分钟）

| 步骤 | 账户 | 操作 | 结果 |
|---|---|---|---|
| 1 | A | 注册 `DataAgent` | Agent ID = 0 |
| 2 | B | 注册 `TraderAgent` | Agent ID = 1 |
| 3 | A | 创建交易（金额 0.1、最高保费 0.005） | 状态 `CREATED`，自动载入 Trade ID |
| 4 | B | 卖家接受交易 | `ACCEPTED` |
| 5 | A | 买家托管 0.1 ETH | `FUNDED` |
| 6 | C | 注册担保 Agent（ID = 2） | — |
| 7 | C | 按链上报价填写覆盖率/保费并质押担保 | `GUARANTEE_OFFERED` |
| 8 | B | 卖家接受担保 | `GUARANTEED` |
| 9 | B | 卖家确认交付 | `DELIVERED` |
| 10 | A | 买家确认完成 | `RELEASED` |
| 11 | B/C | 各自提取余额 | 卖家得货款−保费，担保人得本金+保费 |
| 12 | — | 信誉页查 Agent #1 | 完成交易 = 1，信誉分 ≥ 50 |

### 6.2 剧本 B：八主体争议裁决（约 6 分钟）

前置：8 个主体全部注册（买家、卖家、担保人 + 5 名独立 juror：2 名志愿 + 3 名随机，juror 须在交易创建前注册）。

| 步骤 | 操作 | 结果 |
|---|---|---|
| 1 | 走剧本 A 至 `DELIVERED` | — |
| 2 | 买方支付 2% bond 发起争议 | `DISPUTED` |
| 3 | 任何人调用 `openCase` | 自动载入 Case ID，进入提交阶段 |
| 4 | 2 名志愿 juror 先 commit（质押 0.1 ETH）并备份 secret；志愿窗口结束后抽取随机陪审团，3 名被抽中者 commit | 已提交 = 5 |
| 5 | 快进两个提交窗口（2 天）进入揭示阶段（见 §6.3） | 阶段 = 揭示 |
| 6 | 用原 side/salt 揭示 | 买家票/卖家票/弃权可见 |
| 7 | 快进时间到 reveal 窗口结束，`settle` | 有效裁决 = 是，胜方确定 |
| 8 | 有权参与者 `claim` → `withdraw` | 胜方分享败方罚没 |
| 9 | `finalizeJurorMetrics` | 陪审指标固化 |
| 10 | 信誉页查买卖双方 | 争议胜诉/败诉已记录，信誉分变化 |

### 6.3 本地快进链上时间（仅 anvil）

投票窗口各为 1 天，本地演示用时间操纵快进：

```bash
cast rpc evm_increaseTime 86401 --rpc-url http://127.0.0.1:8545   # 前进一天零一秒
cast rpc evm_mine --rpc-url http://127.0.0.1:8545                 # 挖一个块使时间生效
```

> 这些 Anvil 专有方法**绝不能**用于公共网络。

---

## 7. 机制速览：为什么可信

- **担保人经济学**：担保人按 `交易金额 × 覆盖率` 质押本金，交易成功取回本金 + 保费（保费由卖方承担）；卖方违约/败诉时质押被罚没补偿买方。担保人是平台的风险承保角色。
- **Schelling 收敛**：投票质押后 commit（隐藏立场）→ reveal（公开立场）。多数方 ≥2/3 且有效票 ≥3 时裁决成立，少数派质押被罚没并均分给多数派——**与多数一致（说真话）是占优策略**。裁决结果驱动 escrow 资金释放与信誉记录。
- **Pull-payment 提现**：所有应得款项记入 `pendingWithdrawals`，由收款人主动提取，杜绝重入风险。
- **责任归属**：智能体无民事主体资格，责任钱包承担真实责任。普通 ERC-721 转让不改写责任主体；获批的 PoH 找回迁移责任钱包，同时保留 Agent ID、信誉和历史。信誉禁止自评，只能由授权合约（Escrow/Voting）写入。
- **一人一社区 ID**：同一钱包终身只能注册一个智能体（链上强制）；注册押金可退还（注销时自动转入待提取余额）；World ID 人类验证身份可通过分级找回（同人证明 + 1 守护人 / 全守护人兜底，24h/48h 否决窗）恢复，普通注册可随时 `bindPoH` 升级。女巫攻击的完整分析与修补见 [`docs/security/anti-sybil-analysis.zh-CN.md`](security/anti-sybil-analysis.zh-CN.md)。

---

## 8. 常见问题与故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| `forge`/`cast`/`anvil` 找不到 | Foundry 装在 `~/.foundry/bin` | `export PATH="$HOME/.foundry/bin:$PATH"` |
| 链上命令 502 / 连不上 localhost | 本机代理拦截 | 所有链上命令加 `NO_PROXY="127.0.0.1,localhost,::1"` |
| 前端交易失败 / revert | 链没起或部署清单漂移 | 确认 anvil 运行；`node scripts/deployment-manifest.mjs --check` |
| `docker compose up` 报 8545 占用 | 已有本地 anvil/旧进程 | `tasklist \| findstr anvil` 后 `taskkill`，或改 compose 端口映射 |
| `setup` 报 partial deployment / stale bytecode | 持久卷残留旧状态 | `docker compose down --volumes` 后重启 |
| `setup` Exited (0) | 正常！一次性容器 | 无需处理 |
| 担保按钮失败 | 质押额≠金额×覆盖率，或保费越界 | 使用页面显示的链上精确值；保费上限 20% |
| commit 失败 | juror 资格/质押/注册时间不符 | juror 须交易创建前注册、非交易方、发送精确 caseStake |
| reveal 失败 | secret 丢失或链/账户变化 | 用备份的 side/salt；同链同账户同案件 |
| 首页显示"Research Preview" | 前端按 Base Sepolia 模式构建 | 本地演示用 `NEXT_PUBLIC_CHAIN=anvil`（默认）或 Docker 方式 |

---

## 9. 进阶：部署到 Base Sepolia 测试网

Base Sepolia（Chain ID 84532）四个核心合约已部署并通过 manifest RPC 校验；核心地址与部署元数据以 [`../deployments/84532.json`](../deployments/84532.json) 为准。https://agenttrust.site 已在东京 Caddy 上线且 HTTPS 有效，`www` 重定向到主域名；GitHub Pages 部署门禁工作流已修改但尚未合并。

World ID app `app_01728cabff1e05950af1ff18c06c9d38` 与 RP `rp_fd884ac4342cc4d1` 已注册。由于 Base Sepolia 没有可用的 v4 直接验证，同源 `/api/world-id` 调用官方 v4 Developer Portal API，并使用仅保存在服务器的可信证明人密钥签名；已绑定 Registry 的适配器 `0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF` 验证该证明。该后端信任模型已启用 PoH 注册和担保人/陪审门禁，但并非 World 证明直接链上验证。`verifySameIdentity` 返回 `false`，因此找回要求全部守护人 + 48 小时否决窗。合约仍未经审计、仅限测试网，不具备生产可用性。详见 [`contracts/demo/DEPLOY-BaseSepolia.zh-CN.md`](../contracts/demo/DEPLOY-BaseSepolia.zh-CN.md)。

---

## 10. 文档索引

| 文档 | 路径 |
|---|---|
| 项目总览 | [`README.zh-CN.md`](../README.zh-CN.md) |
| Docker 一键启动 | [`DOCKER.zh-CN.md`](../DOCKER.zh-CN.md) |
| 演示手册 | [`contracts/demo/DEMO.zh-CN.md`](../contracts/demo/DEMO.zh-CN.md) |
| Base Sepolia 部署 | [`contracts/demo/DEPLOY-BaseSepolia.zh-CN.md`](../contracts/demo/DEPLOY-BaseSepolia.zh-CN.md) |
| 全功能走查 | [`docs/feature-walkthrough.zh-CN.md`](feature-walkthrough.zh-CN.md) |
| World ID 接入 | [`docs/world-id-integration.zh-CN.md`](world-id-integration.zh-CN.md) |
| 设计规格 | [`docs/superpowers/specs/2026-08-08-agenttrust-design.md`](superpowers/specs/2026-08-08-agenttrust-design.md) |

---

## 11. 安全与合规

MVP 使用本地链/测试网代币模拟质押与罚没（**无真实价值**）。境内不发行任何可交易代币/凭证；担保责任由真实主体（agent owner）承担；智能体无民事主体资格，责任归属注册人。长期代币化需海外合规架构（详见设计规格 §8）。公开的 anvil 私钥**仅限本地演示**，绝不用于任何有价网络。

---

*AgentTrust · 智能体互信协议 · 官方使用说明*
