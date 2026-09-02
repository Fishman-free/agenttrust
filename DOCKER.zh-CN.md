# AgentTrust 一键 Docker 启动

[English](DOCKER.md) | **简体中文**

本项目通过 `docker compose up` 一条命令启动完整本地开发环境——**无需手动安装 Node.js / Foundry / anvil**（Docker 之外零依赖）。

```
浏览器打开 http://localhost:3000
```

## 前置要求

- **Docker**（Docker Desktop，含 Docker Compose）
- 首次构建会拉取 Foundry 与 Node/nginx 镜像，需能访问 Docker Hub / ghcr.io
- `contracts/lib/openzeppelin-contracts` submodule。Compose 构建会把 `contracts/` 复制进合约镜像并执行 `forge build`，submodule 未初始化会导致构建失败。clone 后执行一次：

```bash
git submodule update --init --recursive
```

> **Windows 注意**：若宿主机配置了系统代理，`cast`/`forge` 访问 localhost 可能报 502。
> 本 compose 的 `setup` 容器**在容器内网**访问 `anvil` 服务，不经过宿主代理，不受影响；
> 浏览器连 `http://127.0.0.1:8545` 是浏览器直连，同样不受影响。

## 一键启动

```bash
docker compose up -d --build     # 后台构建并启动
docker compose ps                # 三个服务：anvil/setup/frontend
```

等待 `frontend` 变 `healthy` 后，浏览器打开 **http://127.0.0.1:3000**。RPC 与前端端口均只绑定宿主回环地址，不对局域网暴露：

```bash
docker compose ps   # 看到 frontend 状态为 healthy 即可
```

## 验证

```bash
# 前端页面（返回 HTML）
curl http://localhost:3000

# anvil RPC（返回 JSON，含 chainId 等）
curl http://localhost:8545

# 查看部署日志（确认四合约部署 + 校验通过）
docker compose logs setup
```

权威合约测试结果为：**183 tests passed, 0 failed, 0 skipped**。Compose 只负责运行环境；测试命令见 [`README.zh-CN.md`](README.zh-CN.md)。

## 工作原理

| 服务 | 说明 |
|---|---|
| `anvil` | 固定 Foundry v1.7.1；`127.0.0.1:8545`；用 `--state /home/foundry/state.json --state-interval 1` 持久化到命名卷 |
| `setup` | 一次性容器：部署或复用四个具名合约，并按 manifest 校验 runtime bytecode hash、Voting 参数、依赖 getter、Hub 授权和 Escrow 所有权；**成功后退出** |
| `frontend` | 静态导出前端（nginx），仅映射 `127.0.0.1:3000`；`/healthz` 同时要求 nginx 可用和 setup 原子写入 readiness marker |

### 网络模型（两个不同的 8545）

| 谁连链 | 连哪 | 为什么 |
|---|---|---|
| `setup` 容器（部署） | `http://anvil:8545` | compose 内网服务名，跨容器访问 |
| 浏览器（前端页面） | `http://127.0.0.1:8545` | 浏览器在宿主机，anvil 已映射到宿主 8545 |

浏览器 RPC 来自 `deployments/31337.json` 生成的 `frontend/lib/deployments.ts`，当前为 `http://127.0.0.1:8545`。

### 合约地址与状态

`deployments/31337.json` 记录本地规范确定性地址；[`deployments/84532.json`](deployments/84532.json) 记录已部署并通过 RPC 校验的 Base Sepolia 核心合约。`frontend/lib/config.ts` 不保存地址字面量，只选择生成的 manifest。Docker Compose 仍仅用于本地，不会部署或修改公共测试网。

```bash
node scripts/deployment-manifest.mjs --write  # generate 的别名；修改 manifest 后重建 TypeScript
node scripts/deployment-manifest.mjs --check  # check 的别名；CI 校验 schema、元数据、规范地址与生成文件同步
```

`setup` 会从 `broadcast/Deploy.s.sol/31337/run-latest.json` 要求每个 `contractName` **恰好一条 `CREATE`**，并要求地址与 manifest 逐一匹配。manifest 还记录 runtime bytecode hash、构造参数，以及 broadcast 可提供的 deployer、交易哈希和区块号。随后用 `cast` 校验四份 runtime hash、Escrow/Voting 依赖、Voting 的 `caseStake`/`commitWindow`/`revealWindow`、Hub 两项 writer 授权以及 Escrow 所有权。

校验成功后，`setup` 才会原子写入共享卷中的 readiness marker；nginx 的 `/healthz` 在 marker 缺失时返回 503。因此健康状态不是单纯的“nginx 进程活着”。任一步失败都会移除 marker，并阻止首次 `frontend` 启动或让已运行前端变为 unhealthy。

## 常用命令

```bash
# 启动
docker compose up -d --build

# 查看状态 / 日志
docker compose ps
docker compose logs -f frontend
docker compose logs setup

# 停止容器并保留 Anvil 状态卷；普通 up 会自动校验 hash/wiring 后安全复用
docker compose down
docker compose up -d

# 停止后保留容器和状态
docker compose stop

# 连同链状态彻底重置（下次会重新部署到规范地址）
docker compose down --volumes
```

## 常见问题

### `setup` 显示 `Exited (0)`
正常——setup 是一次性服务，部署成功即退出（退出码 0）。`frontend` 依赖其成功完成才会启动。

### 钱包要求切换网络
anvil 链 id 为 31337（Chain ID 31337 / 网络名 "Local Anvil"）。建议使用浏览器插件钱包并自定义 RPC：`http://127.0.0.1:8545`。也可直接使用测试私钥（anvil 默认账户）：
`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

### 可以使用 Base Sepolia 吗？
World ID app `app_01728cabff1e05950af1ff18c06c9d38` 与 RP `rp_fd884ac4342cc4d1` 已注册。Base Sepolia（Chain ID 84532）上的四个核心合约已部署并通过 RPC 校验，核心地址以 [`deployments/84532.json`](deployments/84532.json) 为准；本 Compose 仍仅覆盖本地环境。https://agenttrust.site 已在东京 Caddy 上线且 HTTPS 有效，`www` 重定向到主域名；GitHub Pages 部署门禁工作流已修改但尚未合并。Base Sepolia PoH 使用已绑定的 `WorldIDV4AttestationVerifier`（`0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF`）和同源 `/api/world-id` 后端。这是通过 World ID 官方 v4 Developer Portal API 完成的可信后端证明，并非 World 证明直接链上验证。PoH 注册、担保人和陪审门禁已启用；由于 `verifySameIdentity` 返回 `false`，找回采用全部守护人 + 48 小时否决窗。该部署未经审计、仅限测试网，不具备生产可用性。详见 [`contracts/demo/DEPLOY-BaseSepolia.zh-CN.md`](contracts/demo/DEPLOY-BaseSepolia.zh-CN.md)。

### 端口 8545 已被占用
宿主机上若已有进程占用 8545（例如手动启动的本地 `anvil` 或旧版演示进程），会与 Docker 的 anvil 容器端口映射冲突。解决：
1. 先停掉占用 8545 的进程：`tasklist | grep anvil` 找到 PID，`taskkill //PID <PID> //F`
2. 或改 docker-compose.yml 的端口映射（`127.0.0.1:8545:8545` 改为 `127.0.0.1:8546:8545`），并同步修改 `deployments/31337.json` 的 `rpcUrl` 后重新生成模块
3. 确认释放后重新 `docker compose up -d`

### `partial canonical deployment detected`、`stale or unknown runtime bytecode` 或 wiring 校验失败
持久卷保存了不完整、旧版本或未知链状态。执行 `docker compose down --volumes` 清除 Anvil 与 readiness 命名卷，再重新启动。普通 `docker compose down`/`up` 会直接复用且重新校验匹配当前 manifest 的状态，无需额外环境变量；脚本仍拒绝不明状态，以免 nonce 或旧 bytecode 与当前前端不一致。

### 首次构建很慢或镜像拉取失败
Foundry 与 Node/nginx 镜像合计较大（约 500MB+），首次 `--build` 需几分钟。若拉取超时，可先手动预热：`docker pull ghcr.io/foundry-rs/foundry:stable`、`docker pull nginx:stable-alpine`。

## 相关文件

- `docker-compose.yml` —— 三服务编排
- `contracts/Dockerfile` + `contracts/scripts/deploy.sh` —— setup 镜像与部署脚本
- `frontend/Dockerfile` + `frontend/nginx.conf` —— 前端镜像（多阶段构建 + nginx 静态服务）
- [`README.zh-CN.md`](README.zh-CN.md) —— 中文项目总览
- [`docs/USAGE.zh-CN.md`](docs/USAGE.zh-CN.md) —— 中文完整使用说明
- [`docs/feature-walkthrough.zh-CN.md`](docs/feature-walkthrough.zh-CN.md) —— 全功能走查
- [`docs/world-id-integration.zh-CN.md`](docs/world-id-integration.zh-CN.md) —— World ID 接入说明
