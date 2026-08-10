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

未知的 `NEXT_PUBLIC_CHAIN` 会在构建时直接报错，避免静默连接错误网络。Base Sepolia 合约地址仍为零地址时，界面会明确提示并禁用全部可写操作。

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
```

`npm run build` 使用 `output: "export"` 生成 `out/`。项目启用了 `trailingSlash: true`，每个路由输出为目录下的 `index.html`，适合 GitHub Pages、对象存储和 Nginx 静态托管，也能安全处理 `/agents/` 等深链。参考 `nginx.conf` 的 `try_files $uri $uri/` 配置。

## 钱包与交易 UI

全局页头提供钱包连接、断开、当前地址、当前链、错误网络检测，以及切换或添加目标链。`app/components/transaction-status.tsx` 提供统一的交易提交、确认、错误和 receipt 展示 hook/组件，供合约页面逐步接入。

## 测试

Vitest 使用 jsdom 与 React Testing Library。当前基础测试覆盖链配置、零地址写入保护和钱包状态展示；新增同步 Client Component 或纯配置逻辑时应补充相应单元测试。
