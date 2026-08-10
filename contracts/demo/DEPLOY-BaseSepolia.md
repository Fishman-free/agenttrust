# 真实部署准备：Base Sepolia 测试网

> **状态**：🚧 待环境具备后执行。本文档是部署前的**检查清单 + 分步流程**。
> **约束**：当前开发环境（中国大陆，仅 VPN，无加密货币钱包/测试币）暂不具备执行条件。全部步骤已按「断点可续」设计——前置条件就绪后从断点继续即可，无需重做已完成部分。

---

## 1. 目标

把 AgentTrust 四合约（AgentRegistry / GuaranteeEscrow / SchellingVoting / ReputationHub）部署到 **Base Sepolia 测试网**，前端静态托管于 GitHub Pages（`NEXT_PUBLIC_CHAIN=base-sepolia` 分支）。

## 2. 前置条件检查清单

| # | 前置条件 | 当前状态 | 获取方式 |
|---|---|---|---|
| 1 | **测试网钱包私钥**（部署者/owner） | ❌ 缺失 | MetaMask / Rabby 新建钱包 → Base 网络 → 导出私钥 |
| 2 | **Base Sepolia 测试 ETH**（Gas 费） | ❌ 缺失 | faucet：`https://faucet.quicknode.com/base/sepolia`、`https://base.org/faucets` |
| 3 | Foundry（forge / cast / anvil） | ✅ 已装（`~/.foundry/bin`） | — |
| 4 | 合约测试全绿（38 通过） | ✅ 已确认 | `NO_PROXY="127.0.0.1,localhost,::1" forge test` |
| 5 | RPC 可达 `https://sepolia.base.org` | ⚠️ 视网络 | 大陆网络需确认可访问（必要时走代理/VPN） |
| 6 | GitHub 远程仓库可 push | ✅ 已配代理 | `git config http.https://github.com.proxy http://127.0.0.1:7890` |

> **执行断点**：只需 #1 #2 就绪 + #5 网络可达，即可从「步骤 1」继续。

## 3. 安全原则（硬性）

- **私钥绝不进 git、绝不出现在对话/截图**。
- 私钥写入 `contracts/.env`（`.gitignore` 已忽略 `.env`），Foundry 自动加载 `vm.envUint("PRIVATE_KEY")`。
- 若在交互终端输入：用 `read -s`（不回显），不用明文 echo。
- 部署完成后可立即轮换/冷存储该私钥（测试网私钥泄露影响仅限测试币）。

## 4. 分步部署流程

### 步骤 1：写入私钥（不提交 git）

```bash
cd contracts
printf 'PRIVATE_KEY=0x<你的测试网私钥，不带空格>\n' > .env
# 确认 .env 已被 gitignore（git check-ignore .env 应返回该路径）
git check-ignore .env
```

### 步骤 2：部署四合约到 Base Sepolia（带合约验证）

```bash
cd contracts
export PATH="$HOME/.foundry/bin:$PATH"
NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast --verify \
  --etherscan-api-key $BASESCAN_API_KEY     # Base 用 basescan API key（可跳过 --verify 先部署）
```

部署脚本自动完成（`script/Deploy.s.sol`）：
1. 顺序部署：AgentRegistry → ReputationHub → GuaranteeEscrow → SchellingVoting
2. Hub 授权 Escrow/Voting 写入信誉
3. **Escrow 所有权移交 Voting**（社区裁决可驱动 escrow，论文版语义）

### 步骤 3：记录四合约地址

部署记录位于 `broadcast/Deploy.s.sol/84532/run-latest.json`（Base Sepolia Chain ID 是 **84532**，不是 Base 主网的 8453）。不要手工复制无名称的地址列表；由 manifest 工具按 `contractName` 提取四个具名部署。

### 步骤 4：生成并验证部署 manifest

在仓库根目录执行：

```bash
node scripts/deployment-manifest.mjs --write \
  --chain-id 84532 \
  --broadcast contracts/broadcast/Deploy.s.sol/84532/run-latest.json \
  --rpc-url https://sepolia.base.org

# cast 会检查 runtime hash、部署 receipt、Voting 参数、构造依赖、Hub 授权与 Escrow 所有权
node scripts/deployment-manifest.mjs --check \
  --chain-id 84532 \
  --rpc-url https://sepolia.base.org
```

`--write`/`--check` 分别是 `generate`/`check` 的计划兼容别名。写入命令要求 broadcast 对四个合约各有且仅有一条具名 `CREATE`，并要求同时提供 RPC，以捕获和核验 runtime bytecode hash；构造参数、deployer、交易哈希和可用的区块号也会写入 manifest。命令更新 `deployments/84532.json` 并重建 `frontend/lib/deployments.ts`。不要手改生成模块，也不要把地址重新硬编码进 `frontend/lib/config.ts`。

### 步骤 5：本地验证（可选，建议先做）

```bash
cd frontend
NEXT_PUBLIC_CHAIN=base-sepolia npm run build     # 确认无编译错误
# 本地联调：NEXT_PUBLIC_CHAIN=base-sepolia npm run dev  → 连 MetaMask(Base Sepolia) 跑一遍注册/担保
```

### 步骤 6：GitHub Pages 重新部署

当前 Pages 工作流被刻意限制为 **84532 未部署时的只读研究预览**。完成上面的链上 wiring 校验和审查后，先把 `.github/workflows/deploy-pages.yml` 的只读状态门改为已部署门，再发布：

```bash
git add deployments/84532.json frontend/lib/deployments.ts .github/workflows/deploy-pages.yml
git commit -m "feat: Base Sepolia 部署地址接入前端"
git push
```

在门禁修改前，工作流不会把一个已部署 manifest 误标为“只读预览”发布。

### 步骤 7：链上验证

- 区块浏览器确认四合约已 verify（源码可读）：`https://sepolia.basescan.org/address/<地址>`
- 门户验证：打开 `https://<你的用户名>.github.io/multiagent/`，MetaMask 切 Base Sepolia，跑「注册 Agent → 创建担保交易」最小闭环。
- 手动 cast 抽查：

```bash
export PATH="$HOME/.foundry/bin:$PATH"
NO_PROXY="127.0.0.1,localhost,::1" cast call $REGISTRY "nextAgentId()" --rpc-url https://sepolia.base.org
```

## 5. Gas 估算（粗略，供预算测试币）

| 项 | 估算 Gas | 备注 |
|---|---|---|
| 4 合约部署 | ~2.5–3.5M | Registry(ERC721)+Hub+Escrow+Voting |
| Hub 授权 ×2 + Escrow 所有权转移 | ~0.1M | 部署脚本内完成 |
| **合计** | ~3–4M Gas | Base Sepolia 低费率，通常 < 0.001 ETH 足够 |

> 实际以 `forge script --estimate-gas` 或部署输出为准。建议准备 ≥ 0.005 ETH 测试币覆盖余量。

## 6. 风险与回退

| 风险 | 应对 |
|---|---|
| RPC 不可达（大陆网络） | 走代理/VPN；或改用公共 RPC（`https://base-sepolia.public.blastapi.io` 等） |
| 部署后地址填错 | manifest 工具按四个 `contractName` 提取，并用可选 RPC 校验拒绝错误 wiring |
| 前端部署后地址未生效 | 运行 manifest `check`，检查 GitHub Actions 日志确认 `NEXT_PUBLIC_CHAIN=base-sepolia` 生效；清除 Pages 缓存后强刷 |
| Gas 不足 | faucet 补领后再 `forge script --resume` 或重新部署 |
| 私钥泄露（测试网） | 影响仅限测试币；更换新私钥重走本流程 |

## 7. 衔接

- 本流程与 README「常见问题 Q6」、`contracts/demo/DEMO.md` 附注一致，本文档为完整版。
- 主网（Base）部署：同流程，仅 RPC 换 `https://mainnet.base.org` + 真实私钥 + 更严格审计（另立文档）。
