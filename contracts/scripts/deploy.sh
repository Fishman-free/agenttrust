#!/bin/sh
# AgentTrust 合约部署脚本（setup 一次性容器入口）
#
# 职责：
#   1. 等待 anvil 就绪（depends_on 健康检查已保证，此处再兜底）
#   2. 幂等：确定性地址已部署则跳过（anvil 每次全新启动地址恒定）
#   3. forge script 部署四合约（Registry → Hub → Escrow → Voting，含授权 + 所有权移交）
#   4. 从 broadcast 记录动态提取部署地址，逐个 cast 校验合约代码非空
#
# 关键网络设计：
#   本容器在 compose 内网中，经服务名访问 anvil → http://anvil:8545
#   浏览器侧（宿主机）连的是映射端口 http://127.0.0.1:8545，见 frontend/lib/config.ts
set -e

RPC_URL="${RPC_URL:-http://anvil:8545}"
PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

# 与 frontend/lib/config.ts 的 anvil 分支保持一致的确定性地址（anvil 特性：全新链首 4 笔部署地址恒定）
REGISTRY=0x5fBDB2315678afecb367f032d93F642f64180aa3
HUB=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
ESCROW=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
VOTING=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9

echo "============================================================"
echo " AgentTrust 合约部署"
echo " RPC:        $RPC_URL"
# 注：foundry 基础镜像是 alpine（dash），不支持 Bash 的 ${VAR:0:6} 截断，用管道截取
echo " PRIVATE_KEY: $(echo "$PRIVATE_KEY" | cut -c1-6)…$(echo "$PRIVATE_KEY" | cut -c59-64)"
echo "============================================================"

# 等待 anvil 就绪（兜底，避免竞态）
i=0
until cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "错误：anvil 未就绪（$RPC_URL）" >&2
    exit 1
  fi
  echo "  等待 anvil 启动... ($i)"
  sleep 2
done
echo "==> anvil 就绪，chain id: $(cast chain-id --rpc-url "$RPC_URL")"

# 幂等：若确定性地址已含合约代码，说明此前已部署（如 stop/start 复用链数据），直接跳过
if [ -n "$(cast code "$REGISTRY" --rpc-url "$RPC_URL" 2>/dev/null)" ] && \
   [ "$(cast code "$REGISTRY" --rpc-url "$RPC_URL" 2>/dev/null)" != "0x" ]; then
  echo "==> 检测到合约已部署，跳过（幂等）。地址如下："
  echo "   AgentRegistry     $REGISTRY"
  echo "   ReputationHub     $HUB"
  echo "   GuaranteeEscrow   $ESCROW"
  echo "   SchellingVoting   $VOTING"
  exit 0
fi

echo "==> 开始部署四合约..."
export PRIVATE_KEY
forge script script/Deploy.s.sol \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --private-key "$PRIVATE_KEY" \
  -vv

echo "==> 从 broadcast 记录动态提取地址并校验代码"
RUN_FILE="broadcast/Deploy.s.sol/31337/run-latest.json"
ADDRS=$(grep -o '"contractAddress": *"0x[^"]*"' "$RUN_FILE" 2>/dev/null \
  | grep -o '0x[^"]*' \
  | sort -u \
  | grep -iv '^0x0000000000000000000000000000000000000000$')

[ -n "$ADDRS" ] || { echo "错误：broadcast 记录中未解析到合约地址" >&2; exit 1; }

for a in $ADDRS; do
  code=$(cast code "$a" --rpc-url "$RPC_URL")
  if [ -z "$code" ] || [ "$code" = "0x" ]; then
    echo "错误：地址 $a 未检测到合约代码，部署可能失败" >&2
    exit 1
  fi
  echo "   已部署并校验 ✓  $a"
done

echo "============================================================"
echo " 部署完成。前端 frontend/lib/config.ts 使用以下确定性地址："
echo "   AgentRegistry     $REGISTRY"
echo "   ReputationHub     $HUB"
echo "   GuaranteeEscrow   $ESCROW"
echo "   SchellingVoting   $VOTING"
echo "============================================================"
