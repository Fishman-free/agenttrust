# syntax=docker/dockerfile:1
# AgentTrust 合约工程镜像（foundry 工具链）
# 用途：setup 一次性容器——部署四合约到 anvil 服务，并验证确定性地址。
# 提供 forge / cast / anvil，已编译工程 + 部署脚本。

FROM ghcr.io/foundry-rs/foundry:stable

WORKDIR /app

# 复制整个合约工程（含 lib/ 依赖；openzeppelin 的 remappings 由 forge 自动解析）
COPY . .

# 编译合约（首次会从 svm 自动下载 solc 0.8.24）
RUN forge build

# 部署/校验脚本（setup 服务入口；也保留 forge/cast/anvil 供调试）。
# 注：foundry 镜像以非 root 用户 foundry 运行，/usr/local/bin 不可写，
#     故用 COPY --chmod 在复制时直接设置可执行位（避免 RUN chmod 越权失败）。
COPY --chmod=0755 scripts/deploy.sh /usr/local/bin/agenttrust-deploy.sh

ENTRYPOINT ["/usr/local/bin/agenttrust-deploy.sh"]
