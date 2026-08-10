# AgentTrust 一键 Docker 启动

本项目通过 `docker compose up` 一条命令启动完整本地开发环境——**无需手动安装 Node.js / Foundry / anvil**（Docker 之外零依赖）。

```
浏览器打开 http://localhost:3000
```

## 前置要求

- **Docker**（Docker Desktop，含 Docker Compose）
- 首次构建会拉取 Foundry 与 Node/nginx 镜像，需能访问 Docker Hub / ghcr.io

> **Windows 注意**：若宿主机配置了系统代理，`cast`/`forge` 访问 localhost 可能报 502。
> 本 compose 的 `setup` 容器**在容器内网**访问 `anvil` 服务，不经过宿主代理，不受影响；
> 浏览器连 `http://127.0.0.1:8545` 是浏览器直连，同样不受影响。

## 一键启动

```bash
docker compose up -d --build     # 后台构建并启动
docker compose ps                # 三个服务：anvil/setup/frontend
```

等待 `frontend` 变 `healthy` 后，浏览器打开 **http://localhost:3000**：

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

## 工作原理

| 服务 | 说明 |
|---|---|
| `anvil` | 本地演示链（foundry 镜像），端口映射 `8545`，暴露给浏览器 |
| `setup` | 一次性容器：`forge script script/Deploy.s.sol --broadcast` 部署四合约到 anvil，并用 `cast` 动态校验部署地址；**成功后退出** |
| `frontend` | 静态导出前端（nginx），端口映射 `3000` |

### 网络模型（两个不同的 8545）

| 谁连链 | 连哪 | 为什么 |
|---|---|---|
| `setup` 容器（部署） | `http://anvil:8545` | compose 内网服务名，跨容器访问 |
| 浏览器（前端页面） | `http://127.0.0.1:8545` | 浏览器在宿主机，anvil 已映射到宿主 8545 |

`frontend/lib/config.ts` 的 anvil RPC 地址 `http://127.0.0.1:8545` 对浏览器侧**本来就是对的**，因此前端代码无需改动。

### 合约地址

anvil 全新启动会产生**确定性地址**，`frontend/lib/config.ts` 的 anvil 分支已内置：

| 合约 | 地址 |
|---|---|
| AgentRegistry | `0x5fBDB2315678afecb367f032d93F642f64180aa3` |
| ReputationHub | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| GuaranteeEscrow | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| SchellingVoting | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |

`setup` 部署后会从 `broadcast/Deploy.s.sol/31337/run-latest.json` **动态提取**实际部署地址并逐个 `cast code` 校验——若异常会以非零码退出，`frontend` 因 `depends_on: service_completed_successfully` 不会启动。

## 常用命令

```bash
# 启动
docker compose up -d --build

# 查看状态 / 日志
docker compose ps
docker compose logs -f frontend
docker compose logs setup

# 彻底停止并清理（回收端口）
docker compose down

# 停止后保留卷（下次启动更快）
docker compose stop
```

## 常见问题

**Q：`docker compose ps` 里 `setup` 显示 `Exited (0)`？**
正常——setup 是一次性服务，部署成功即退出（退出码 0）。`frontend` 依赖其成功完成才会启动。

**Q：浏览器打开页面，连接钱包提示网络切换？**
anvil 链 id 为 31337（Chain ID 31337 / 网络名 "Local Anvil"）。建议使用浏览器插件钱包并自定义 RPC：`http://127.0.0.1:8545`。也可直接使用测试私钥（anvil 默认账户）：
`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

**Q：想用生产测试网（Base Sepolia）？**
该场景为静态部署（如 GitHub Pages），非本 compose 覆盖范围；参考根目录 `README.md` 与 `frontend/lib/config.ts`。

**Q：`docker compose up` 报端口占用 / anvil 容器起不来（8545 冲突）？**
宿主机上若已有进程占用 8545（例如手动启动的本地 `anvil` 或旧版演示进程），会与 Docker 的 anvil 容器端口映射冲突。解决：
1. 先停掉占用 8545 的进程：`tasklist | grep anvil` 找到 PID，`taskkill //PID <PID> //F`
2. 或改 docker-compose.yml 的端口映射（`8545:8545` 改 `8546:8545`），但此时前端 `config.ts` 的 RPC 也要同步改
3. 确认释放后重新 `docker compose up -d`

**Q：首次构建很慢 / 拉镜像失败？**
Foundry 与 Node/nginx 镜像合计较大（约 500MB+），首次 `--build` 需几分钟。若拉取超时，可先手动预热：`docker pull ghcr.io/foundry-rs/foundry:stable`、`docker pull nginx:stable-alpine`。

## 相关文件

- `docker-compose.yml` —— 三服务编排
- `contracts/Dockerfile` + `contracts/scripts/deploy.sh` —— setup 镜像与部署脚本
- `frontend/Dockerfile` + `frontend/nginx.conf` —— 前端镜像（多阶段构建 + nginx 静态服务）
