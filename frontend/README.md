# AgentTrust Frontend

AgentTrust 的 Next.js App Router 前端，提供智能体注册、担保交易、争议裁决和信誉查询界面。钱包与链上交互基于 wagmi、viem 和 TanStack Query。

## 本地开发

要求 Node.js 20+，并在当前目录安装依赖：

```bash
npm ci
npm run dev
```

默认连接本地 Anvil（Chain ID `31337`，RPC `http://127.0.0.1:8545`）。访问 `http://localhost:3000`。

## 环境变量

| 变量 | 可选值 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CHAIN` | `anvil`、`base-sepolia` | `anvil` | 选择链与合约地址组 |
| `NEXT_PUBLIC_BASE_PATH` | 例如 `/multiagent` | 空 | 部署到子路径时设置 Next.js base path |

未知的 `NEXT_PUBLIC_CHAIN` 会在构建时直接报错，避免静默连接错误网络。链与地址读取仓库根目录 `deployments/*.json` 生成的 `lib/deployments.ts`；不要手改生成文件或在 `lib/config.ts` 中硬编码地址。Base Sepolia manifest 当前明确为 `undeployed`，因此界面会提示并禁用全部可写操作。

修改 manifest 后，在仓库根目录运行 `node scripts/deployment-manifest.mjs generate`；CI 用 `check` 模式防止生成文件漂移。

PowerShell 示例：

```powershell
$env:NEXT_PUBLIC_CHAIN="base-sepolia"
$env:NEXT_PUBLIC_BASE_PATH="/multiagent"
npm run build
```

## 常用命令

```bash
npm run lint
npm run build
npm run test
npm run test:watch
npm run e2e
```

合约 ABI 由根目录 `scripts/gen-abi.mjs` 从 Foundry artifacts 确定性生成：

```bash
forge build --root contracts
node scripts/gen-abi.mjs
node scripts/gen-abi.mjs --check
```

不要手工修改 `lib/abi.ts`。

`npm run build` 使用 `output: "export"` 生成 `out/`。项目启用了 `trailingSlash: true`，每个路由输出为目录下的 `index.html`，适合 GitHub Pages、对象存储和 Nginx 静态托管，也能安全处理 `/agents/` 等深链。参考 `nginx.conf` 的 `try_files $uri $uri/` 配置。

## 钱包与交易 UI

全局页头提供钱包连接、断开、当前地址、当前链、错误网络检测，以及切换或添加目标链。所有合约页面都通过 `app/components/transaction-status.tsx` 等待链上 receipt，再解析事件并刷新状态。交易页实现完整十状态流程；争议页实现带 2% bond 的争议、permissionless 开案、commit–reveal、claim/withdraw 与陪审指标固化。

Commit secret 使用浏览器 CSPRNG 生成，并按 chain、Voting 地址、case 和 voter 隔离存入 localStorage。清理浏览器数据前必须导出备份，否则可能无法 reveal 并损失投票 stake。

## 测试

Vitest 使用 jsdom 与 React Testing Library，覆盖 ABI 漂移、manifest/config、事件解析、十状态映射、commit secret 生命周期、交易反馈以及 Agents/Disputes/Reputation 页面逻辑。

`npm run e2e` 启动 disposable Anvil、部署当前合约并运行串行 Chromium E2E，覆盖正常交易和六身份争议交易。测试钱包 provider 只注入 localhost/31337，使用 Anvil unlocked accounts，不进入生产 bundle。

MetaMask/Synpress smoke 是独立、非主门禁测试：

```bash
npm run e2e:metamask:cache
npm run e2e:metamask
```

Synpress 4 的 cache CLI 不支持原生 Windows；请在 Linux/WSL 或手动触发 GitHub Actions 的 non-blocking MetaMask job。仅使用公开的 disposable Anvil mnemonic，禁止复用真实钱包助记词。
