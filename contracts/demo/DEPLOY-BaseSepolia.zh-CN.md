# Base Sepolia 部署指南

[English](./DEPLOY-BaseSepolia.md) | **简体中文**

> **当前状态：尚未部署。** `deployments/84532.json` 的状态是 `"undeployed"`，地址均为零地址。本文是部署准备与执行指南，不代表已有线上部署。
>
> 合约未经独立审计，不应视为可用于生产环境。

## 1. 部署模型

Base Sepolia 的 Chain ID 是 **84532**。部署分为两部分：

1. **由 manifest 跟踪的四个核心合约：**`AgentRegistry`、`ReputationHub`、`GuaranteeEscrow` 和 `SchellingVoting`。`script/Deploy.s.sol` 负责部署并完成 wiring，`deployments/84532.json` 负责跟踪。
2. **单独部署和配置的一个适配器：**`WorldIDPoHVerifier`。它不在四合约 manifest 中。必须先单独部署，再在执行 `Deploy.s.sol` 时通过必需的 `POH_VERIFIER` 传入其地址。

`AnvilDevPoHVerifier` 仅供本地测试。只有在本地 Anvil 链 `31337` 且未设置 `POH_VERIFIER` 时，`Deploy.s.sol` 才会自动创建它。绝不能将其部署或配置到 Base Sepolia、其他公共网络或任何承载价值的网络。

前端可通过 `NEXT_PUBLIC_CHAIN=base-sepolia` 导出到 GitHub Pages，但 manifest 状态为 `undeployed` 时，必须保持明确的不可用/只读状态。

## 2. 前置条件

- **Node.js >=20.9**。
- Foundry（`forge`、`cast`、`anvil`）。
- 专用测试网部署钱包及其私钥。
- 用于 Gas 的 Base Sepolia 测试 ETH。
- Base Sepolia RPC，例如 `https://sepolia.base.org`。
- 如需在部署时使用 `--verify`，准备 BaseScan API key。
- World Developer Portal staging `app_id`，以及单一 action，例如 `agenttrust-identity`。
- 与 staging 配置匹配的 World ID group ID；必须在 Portal 和官方文档中确认。
- 合约测试全部通过。权威基线为：**146 tests passed, 0 failed, 0 skipped across 10 suites**：

```bash
NO_PROXY="127.0.0.1,localhost,::1" forge test --root contracts
```

常用资源：

- Base Sepolia 水龙头：`https://faucet.quicknode.com/base/sepolia`、`https://base.org/faucets`
- Base Sepolia 浏览器：`https://sepolia.basescan.org`
- Base Sepolia WorldIDRouter：`0x379c62556c665f1edd25f2c2a0f76bc70a53b2e4`
- World ID 地址簿：`https://docs.world.org/world-id/reference/address-book`

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

### 步骤 2：单独部署真实 World ID 适配器

在仓库根目录仅在本地设置部署参数，然后部署 `WorldIDPoHVerifier`：

```bash
set -a
. contracts/.env
set +a
export WORLD_ID_ROUTER=0x379c62556c665f1edd25f2c2a0f76bc70a53b2e4
export WORLD_ID_GROUP_ID=<已确认的-group-id>
export WORLD_ID_APP_ID='<staging-app-id>'
export WORLD_ID_ACTION='agenttrust-identity'

forge create contracts/src/WorldIDPoHVerifier.sol:WorldIDPoHVerifier \
  --rpc-url https://sepolia.base.org \
  --private-key "$PRIVATE_KEY" \
  --constructor-args "$WORLD_ID_ROUTER" "$WORLD_ID_GROUP_ID" "$WORLD_ID_APP_ID" "$WORLD_ID_ACTION"
```

将部署得到的适配器地址记录为 `POH_VERIFIER`。注册与找回必须使用同一个 `action`，这是建立 nullifierHash 身份锚点的前提。在真实 Base Sepolia/IDKit 集成校验完成前，不能宣称 PoH 通道已经验证。

### 步骤 3：部署并配置四个核心合约

```bash
cd contracts
export PATH="$HOME/.foundry/bin:$PATH"
export POH_VERIFIER=<已部署的-WorldIDPoHVerifier-地址>
NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast --verify \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

本公共测试网流程强制要求 `POH_VERIFIER`。不要省略：在 Base Sepolia 上，未设置该变量不会部署 Anvil 开发验证器，而会让 PoH 通道保持关闭。如果尚未准备验证凭据，可先去掉 `--verify` 和 `--etherscan-api-key` 完成部署，之后再验证源码。

`Deploy.s.sol` 会完成：

1. 按 `AgentRegistry` → `ReputationHub` → `GuaranteeEscrow` → `SchellingVoting` 的顺序部署。
2. 授予 Escrow 和 Voting 对 Hub 的写权限。
3. 配置担保敞口上限、义务预言机、注册押金，并用 `POH_VERIFIER` 设置 `AgentRegistry.pohVerifier`。
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

Manifest 有意只跟踪四个核心合约。应通过受控部署记录保存并审查单独部署的 `WorldIDPoHVerifier` 地址，并直接检查 Registry 配置：

```bash
export REGISTRY=<manifest-中的-AgentRegistry-地址>
cast call "$REGISTRY" "pohVerifier()(address)" --rpc-url https://sepolia.base.org
```

返回地址必须等于 `POH_VERIFIER`。

### 步骤 5：本地构建并测试前端

```bash
cd frontend
NEXT_PUBLIC_CHAIN=base-sepolia npm run build
# 交互检查：
NEXT_PUBLIC_CHAIN=base-sepolia npm run dev
```

将 MetaMask 切换到 Base Sepolia，测试最小的注册/担保交易流程。在宣称 PoH 集成通过前，还必须完成 World ID 注册和同人找回校验。

### 步骤 6：启用并发布 GitHub Pages

当 84532 尚未部署时，Pages 工作流会被刻意限制为明确的只读研究预览。完成链上 wiring、manifest 检查、World ID 集成校验和审查后，先把 `.github/workflows/deploy-pages.yml` 从未部署/只读门禁改为已部署门禁，再发布：

```bash
git add deployments/84532.json frontend/lib/deployments.ts .github/workflows/deploy-pages.yml
git commit -m "feat: 接入 Base Sepolia 部署到前端"
git push
```

修改门禁前，工作流不得把已部署 manifest 以“只读预览”的标签发布。

### 步骤 7：链上验证

- 确认四个核心合约以及单独部署的 `WorldIDPoHVerifier` 均有已验证源码：`https://sepolia.basescan.org/address/<地址>`。
- 打开 `https://<你的用户名>.github.io/multiagent/`，MetaMask 切到 Base Sepolia，至少完成“注册 Agent → 创建担保交易”。
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
| `WorldIDPoHVerifier` | 单独估算 | 单独部署，不计入四合约 manifest |

以 `forge script --estimate-gas` 和实际部署输出为准。应预留充足测试 ETH；估算和网络费用都可能变化。

## 6. 故障与回退

| 问题 | 处理方式 |
|---|---|
| RPC 不可达 | 重试或改用其他可信 Base Sepolia RPC |
| 适配器参数错误 | 停止发布；用已确认的 router、group ID、app ID 和共用 action 重新部署 `WorldIDPoHVerifier` |
| `POH_VERIFIER` 遗漏或错误 | 不要发布；修正变量，必要时重新部署核心合约，并核验 `pohVerifier()` |
| 核心合约地址错误 | 根据具名 broadcast 重新生成，让 manifest 的 RPC 校验拒绝错误 wiring |
| 前端地址未更新 | 运行 manifest `--check`，检查 Actions 日志中的 `NEXT_PUBLIC_CHAIN=base-sepolia`，再清除 Pages 缓存并强制刷新 |
| Gas 不足 | 从水龙头领取更多测试 ETH；可安全续跑时使用 `forge script --resume`，否则重新部署 |
| 测试网私钥泄露 | 视为已泄露，立即更换，并使用新的专用测试网私钥重新部署 |

## 7. 相关文档

- [合约 README](../README.zh-CN.md)
- [本地全链路演示](./DEMO.zh-CN.md)
- [World ID 接入说明](../../docs/world-id-integration.zh-CN.md)
