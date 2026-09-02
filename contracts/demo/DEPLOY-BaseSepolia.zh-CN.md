# Base Sepolia 部署指南

[English](./DEPLOY-BaseSepolia.md) | **简体中文**

> **当前状态：**四个核心合约已部署到 Base Sepolia（Chain ID 84532），并通过 RPC-backed manifest 校验。权威地址、bytecode hash、交易、区块和构造元数据见 [`../../deployments/84532.json`](../../deployments/84532.json)。
>
> https://agenttrust.site 已在东京 Caddy 上线且 HTTPS 有效，`www` 重定向到主域名。GitHub Pages 部署门禁工作流已修改但尚未合并。合约未经审计、仅限测试网，不具备生产可用性。
>
> World ID app `app_01728cabff1e05950af1ff18c06c9d38` 与 RP `rp_fd884ac4342cc4d1` 已注册。由于 Base Sepolia 没有 v4 直接验证器，同源 `/api/world-id` 使用官方 v4 Developer Portal API 与仅保存在服务器的可信证明人密钥。`WorldIDV4AttestationVerifier`（`0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF`）已绑定 Registry。PoH 注册及担保人/陪审门禁已通过该后端信任模型启用，并非 World 证明直接链上验证。`verifySameIdentity` 返回 `false`，找回要求全部守护人 + 48 小时否决窗。

## 1. 部署模型

Base Sepolia 的 Chain ID 是 **84532**。当前部署包含四个由 manifest 跟踪的核心合约：`AgentRegistry`、`ReputationHub`、`GuaranteeEscrow` 和 `SchellingVoting`。`script/Deploy.s.sol` 已完成部署与 wiring，[`../../deployments/84532.json`](../../deployments/84532.json) 是唯一权威地址来源。

World ID 与四合约 manifest 分开记录。旧版 `WorldIDPoHVerifier` 不得针对已弃用的 V1/Contracts 3.0 接口部署。当前 v4 集成使用 [`../../deployments/84532-world-id.json`](../../deployments/84532-world-id.json) 记录的后端证明适配器；该适配器已部署并绑定，同时明确引入受信任的服务器证明人。

`AnvilDevPoHVerifier` 仅供本地测试。只有在本地 Anvil 链 `31337` 且未设置 `POH_VERIFIER` 时，`Deploy.s.sol` 才会自动创建它。绝不能将其部署或配置到 Base Sepolia、其他公共网络或任何承载价值的网络。

前端可通过 `NEXT_PUBLIC_CHAIN=base-sepolia` 导出。已部署 manifest 允许核心合约写入，但 GitHub Pages 要等工作流合并后才可写入；自定义域名 `https://agenttrust.site` 已在东京 Caddy 上线且 HTTPS 有效。PoH 注册及担保人/陪审门禁已通过可信后端证明启用；这不代表未经审计的测试网部署已具备生产可用性。

## 2. 前置条件

- **Node.js >=20.9**。
- Foundry（`forge`、`cast`、`anvil`）。
- 专用测试网部署钱包及其私钥。
- 用于 Gas 的 Base Sepolia 测试 ETH。
- Base Sepolia RPC，例如 `https://sepolia.base.org`。
- 如需在部署时使用 `--verify`，准备 BaseScan API key。
- 仅供未来 PoH 工作：现有 World ID app 为 `app_01728cabff1e05950af1ff18c06c9d38`；设计替代适配器前，必须核对当前 v4 Portal、action 和证明要求，不得复用旧版 V1/Contracts 3.0 假设。
- 合约测试全部通过。权威基线为：**183 tests passed, 0 failed, 0 skipped**：

```bash
NO_PROXY="127.0.0.1,localhost,::1" forge test --root contracts
```

常用资源：

- Base Sepolia 水龙头：`https://faucet.quicknode.com/base/sepolia`、`https://base.org/faucets`
- Base Sepolia 浏览器：`https://sepolia.basescan.org`
- World ID 文档：`https://docs.world.org/`——必须使用当前 v4 文档；项目此前引用的旧版 router/interface 已弃用

## 3. 安全要求

- 私钥绝不能提交到 git，也不能出现在对话、日志、截图、shell 历史或文档中。
- 使用专用测试网私钥；不要复用控制真实资产的钱包。
- 私钥仅保存到被 git 忽略的 `contracts/.env`，或通过 `read -s` 等不回显方式输入。
- 不要用带明文私钥的 `echo`。
- 部署前必须确认 `.env` 已被忽略。
- 演示中公开的 Anvil 私钥和助记词禁止用于 Base Sepolia。

## 4. 分步部署流程

### 步骤 1：仅在本地保存部署私钥

```bash
cd contracts
printf 'PRIVATE_KEY=0x<你的测试网私钥，不带空格>\n' > .env
# 此命令必须输出 .env，以确认 git 会忽略它。
git check-ignore .env
```

上述命令只是模板：请仅在本地替换占位符，绝不能把生成的文件或私钥粘贴到对话、commit 或截图中。也可使用不回显的交互方式：

```bash
cd contracts
read -rsp "Base Sepolia private key: " PRIVATE_KEY; printf '\n'
printf 'PRIVATE_KEY=%s\n' "$PRIVATE_KEY" > .env
unset PRIVATE_KEY
git check-ignore .env
```

### 步骤 2：部署并绑定 World ID v4 后端证明路径

当前集成通过同源 `/api/world-id` 后端使用 World ID v4 IDKit 和官方 Developer Portal 验证 API。后端签发短期 EIP-712 enrollment attestation，Base Sepolia 上的 `WorldIDV4AttestationVerifier` 负责验签。部署元数据与交易哈希记录在 [`../../deployments/84532-world-id.json`](../../deployments/84532-world-id.json)。

这是**可信后端证明**，并非 World 证明直接链上验证。旧版 V1 adapter 仍禁止使用。当前适配器已启用验证注册、担保人和陪审门禁；其 `verifySameIdentity` 明确返回 `false`，因此找回始终走全守护人 + 48 小时否决路径。

### 步骤 3：核心部署记录（仅在有意替换时重部署）

```bash
cd contracts
export PATH="$HOME/.foundry/bin:$PATH"
# 经审查的 v4 适配器完成前，不要设置 POH_VERIFIER。
NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast --verify \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

当前四合约部署已记录在 manifest 中并通过 RPC 校验；除非有意替换，否则不要重跑此命令。Base Sepolia 未设置 `POH_VERIFIER` 时不会部署本地开发验证器，PoH 通道保持关闭；v4 适配器完成前必须维持此状态。未来有意重部署时若暂缺验证凭据，可先去掉 `--verify` 和 `--etherscan-api-key`，之后再验证源码。

`Deploy.s.sol` 会完成：

1. 按 `AgentRegistry` → `ReputationHub` → `GuaranteeEscrow` → `SchellingVoting` 的顺序部署。
2. 授予 Escrow 和 Voting 对 Hub 的写权限。
3. 配置担保敞口上限、义务预言机和注册押金。v4 后端证明适配器在核心部署完成后单独部署并绑定。
4. 将 Escrow 所有权移交 Voting，使社区裁决可以驱动托管结算。

### 步骤 4：检查 broadcast 并生成四合约 manifest

核心合约的部署记录位于 `contracts/broadcast/Deploy.s.sol/84532/run-latest.json`。Base Sepolia Chain ID 是 **84532**，不是 Base 主网的 8453。不要手工复制无名称地址列表；manifest 工具会为四个核心合约分别提取且仅提取一条具名 `CREATE`。

在仓库根目录执行：

```bash
node scripts/deployment-manifest.mjs --write \
  --chain-id 84532 \
  --broadcast contracts/broadcast/Deploy.s.sol/84532/run-latest.json \
  --rpc-url https://sepolia.base.org

# 检查四个 manifest 合约的 runtime hash、部署 receipt、Voting 参数、
# 构造依赖、Hub 权限和 Escrow 所有权。
node scripts/deployment-manifest.mjs --check \
  --chain-id 84532 \
  --rpc-url https://sepolia.base.org
```

`--write` 和 `--check` 分别是 `generate` 和 `check` 的兼容别名。写入命令会更新 `deployments/84532.json` 并重新生成 `frontend/lib/deployments.ts`。不要手改生成模块，也不要在 `frontend/lib/config.ts` 中硬编码地址。

核心 manifest 有意只跟踪四个合约。独立 World ID manifest 记录 adapter `0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF`、信任模型、attester、RP/action 和部署交易；开放 PoH UI 前已用 `pohVerifier()` 直接核验 Registry 绑定。

### 步骤 5：本地构建并测试前端

```bash
cd frontend
NEXT_PUBLIC_CHAIN=base-sepolia npm run build
# 交互检查：
NEXT_PUBLIC_CHAIN=base-sepolia npm run dev
```

将 MetaMask 切换到 Base Sepolia，核验网络/地址选择、核心读写和 World ID v4 enrollment 流程。验证注册及担保人/陪审门禁使用可信后端证明。不得宣传快速同人找回：当前 adapter 返回 `false`，找回要求全守护人 + 48 小时否决窗。

### 步骤 6：启用并发布 GitHub Pages

核心部署和 manifest 门禁已就绪，但 GitHub Pages 要等待中的工作流合并后才可写入。不要绕过仓库审查，也不要从未合并的工作流手工发布。自定义域名 `https://agenttrust.site` 已在东京 Caddy 上线且 HTTPS 有效，`www` 重定向到主域名。所有公网入口都必须保留“未经审计/仅测试网”和后端证明信任警告。

### 步骤 7：链上验证

- 使用 [`../../deployments/84532.json`](../../deployments/84532.json) 中的地址核验四个核心合约的源码和 runtime bytecode：`https://sepolia.basescan.org/address/<地址>`。
- 各入口实际发布后，再打开由已合并工作流生成的 GitHub Pages URL 和 `https://agenttrust.site`，将 MetaMask 切到 Base Sepolia 并核验非 PoH 行为。部署完成前不得描述为已上线。
- 手动抽查 Registry：

```bash
export PATH="$HOME/.foundry/bin:$PATH"
NO_PROXY="127.0.0.1,localhost,::1" cast call "$REGISTRY" "nextAgentId()" --rpc-url https://sepolia.base.org
cast call "$REGISTRY" "pohVerifier()(address)" --rpc-url https://sepolia.base.org
```

## 5. Gas 规划

| 项目 | 粗略 Gas | 说明 |
|---|---:|---|
| 四个核心合约 | ~2.5–3.5M | Registry + Hub + Escrow + Voting |
| Hub 权限及核心 wiring | ~0.1M | 由 `Deploy.s.sol` 完成 |
| World ID v4 后端证明适配器 | 以实际部署 receipt 为准 | 已单独部署并绑定，记录于 `deployments/84532-world-id.json` |

以 `forge script --estimate-gas` 和实际部署输出为准。应预留充足测试 ETH；估算和网络费用都可能变化。

## 6. 故障与回退

| 问题 | 处理方式 |
|---|---|
| RPC 不可达 | 重试或改用其他可信 Base Sepolia RPC |
| 选用了旧版适配器 | 停止；不要部署 V1/Contracts 3.0 `WorldIDPoHVerifier`，应实现并审查 v4 适配器 |
| verifier 绑定异常 | 核验 `pohVerifier()` 等于 `0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF`；不匹配时停用相关流程并审查 |
| 核心合约地址错误 | 根据具名 broadcast 重新生成，让 manifest 的 RPC 校验拒绝错误 wiring |
| 前端地址未更新 | 运行 manifest `--check`，检查 Actions 日志中的 `NEXT_PUBLIC_CHAIN=base-sepolia`，再清除 Pages 缓存并强制刷新 |
| Gas 不足 | 从水龙头领取更多测试 ETH；可安全续跑时使用 `forge script --resume`，否则重新部署 |
| 测试网私钥泄露 | 视为已泄露，立即更换，并使用新的专用测试网私钥重新部署 |

## 7. 相关文档

- [合约 README](../README.zh-CN.md)
- [本地全链路演示](./DEMO.zh-CN.md)
- [World ID 接入说明](../../docs/world-id-integration.zh-CN.md)
