# AgentTrust 全链路演示手册

> 环境：本地 anvil 演示链（当前已部署），开发者门户 Next.js。真实链部署流程见文末附注。

本手册对应 `contracts/test/E2E.t.sol` 的业务故事（注册 → 担保交易 → 交付 → 争议 → 社区投票 → 罚没 → 信誉更新），供学期答辩 / 社区上线演示。共 38 个合约测试全通过，本手册是把 E2E 故事搬到「钱包 + 浏览器」的逐步可复现指南。

## 前置：一次启动（anvil + 前端）

```bash
# 1. 启动本地链（终端 1）
# 关键：Windows 代理会导致 cast/forge 502，必须带 NO_PROXY
NO_PROXY="127.0.0.1,localhost,::1" anvil --chain-id 31337 --port 8545

# 2. 部署合约（终端 2，anvil 确定性地址，重复部署地址不变）
# 注意：Deploy.s.sol 内部用 vm.envUint("PRIVATE_KEY") 读取，必须同时导出 PRIVATE_KEY
cd contracts && export PATH="$HOME/.foundry/bin:$PATH" \
  && export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  && NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key "$PRIVATE_KEY"

# 3. 启动前端（终端 3）
cd frontend && npm run dev
# 打开 http://localhost:3000
```

> 若部署地址与 `frontend/lib/config.ts` 不一致，更新该文件（当前已填 anvil 标准地址：0x5fBDB231.../0xe7f1725E.../0x9fE46736.../0xCf7Ed3Ac...）。
> 部署脚本自动完成：Registry → Hub → Escrow → Voting 顺序部署、Hub 授权 Escrow/Voting 写入、Escrow 所有权移交 Voting（社区裁决可驱动 escrow）。`registrationFee` 默认 0，注册免费。

### 演示用钱包（MetaMask 导入）

anvil 提供确定性测试账户，导入私钥即可充当演示钱包（均带 10000 ETH）：

| 角色 | 地址 | 私钥 |
|---|---|---|
| 钱包 A（卖家 DataAgent 负责人） | 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 | 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 |
| 钱包 B（买家 TraderAgent 负责人） | 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 | 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d |
| 钱包 C（担保人/陪审员） | 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC | 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a |

MetaMask 添加网络：RPC http://127.0.0.1:8545、Chain ID 31337、符号 ETH。然后「导入账户」粘贴私钥。

## 演示流程（5 分钟版）

### 1. 注册智能体（钱包 A）
- 门户 → 智能体 → 连接钱包 A（MetaMask 切到 anvil 本地网络 http://127.0.0.1:8545）
- 注册 "DataAgent"，描述 "链上数据分析服务"，端点填 `https://a.example/mcp` → Agent ID = 0

### 2. 注册买方智能体（钱包 B）
- 切换 MetaMask 到钱包 B → 注册 "TraderAgent"（描述 "交易策略智能体"）→ Agent ID = 1

### 3. 创建担保交易（钱包 B）
- 交易页 → 买家 ID=1、卖家 ID=0、金额 0.1 ETH → 创建 → ① 付款（0.1 ETH 进 escrow）

### 4. 担保人担保（钱包 C，需 0.1+ ETH）
- 切换钱包 C → ② 担保：覆盖率 100%、保费 0.005 ETH → 质押 0.1（= 覆盖率 × 金额，T5 语义：保费仅报价记录，释放时由卖家承担）

### 5. 交付与确认（钱包 A → ③ 交付；钱包 B → ④ 确认）
- 观察：卖家收 0.1 − 0.005 = 0.095，担保人拿回 0.1 + 0.005 = 0.105

### 6. 争议演示（复现 E2E 违约场景）
- 再建一笔交易（买家 1、卖家 0、金额 0.1 ETH）→ 付款 → 担保 → ③ 交付 → 买家发起争议（交易页④旁或争议页）
- 争议页 → 开设投票案（窗口 1 天；若需压缩演示，用文末 cast 命令把窗口缩短到 1 分钟再开案）
- 三个演示钱包各投一票（A、B、C 任取三：2 票支持买家、1 票支持卖家，每票质押 0.05 ETH）
- 结算 → 观察：买家拿回本金 + 罚没担保金，担保人 0.1 质押全失（判断失误代价），少数派陪审员质押被罚没均分给多数派

### 7. 信誉变化（信誉页）
- 输入卖家 Agent ID（0）：争议败诉 +1，信誉分公式计算 = 100 − 0 − 50·1/1 = **50**（1 次败诉；与默认值持平，多次败诉/违约才会低于 50）

## 快速验证（不用前端）

```bash
cd contracts && NO_PROXY="127.0.0.1,localhost,::1" forge test --match-contract E2ETest -vvv
```

E2E 全链路（自动化基线）：注册两智能体 → 2 ETH 交易担保 → 交付 → 买家争议 → 3 票 Schelling（2 买 1 卖）→ 结算买家胜 → 罚没均分 → 信誉败诉 +1 → 对照组正常交易完成 +1 → 终态资金守恒断言（escrow/voting 双归零）。

## 机制说明（给观众的话术）

- **担保人质押** = 智能体保险的诚实形态：违约自动罚没。担保人判断失误（保了违约方）质押全失，因此只有评估过卖家信誉的理性担保人才会接单——质押即信号。
- **Schelling 投票** = 社区说真话的激励：与多数一致者拿回质押+奖金，少数派被罚。正确判案是占优策略（随大流也说真话，否则罚没），实现多数人诚实的纳什均衡。
- **信誉** = 链上 attestation：不可篡改、禁止自评（仅 Escrow/Voting 合约可写入）、供担保准入定价（新智能体默认 50 分，需担保人担保才能承接高价值订单）。

## 附注：真实链部署（Base Sepolia）

```bash
cd contracts && NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast --verify \
  --private-key "$PRIVATE_KEY"   # 需先设置测试网私钥（勿提交 git，可用 .env 由 foundry 自动加载）
# 部署后将 4 地址填入 frontend/lib/config.ts，并把 wagmi.ts 链切回 baseSepolia
```

前置：MetaMask 切 Base Sepolia；钱包领测试 ETH（faucet：https://faucet.quicknode.com/base/sepolia）。

## 演示快捷 cast 命令（缩短投票窗口 / 结算）

争议页 openCase 固定窗口 86400s（1 天），演示可用 cast 直接开 60s 窗口的案并手动推进区块时间：

```bash
export NO_PROXY="127.0.0.1,localhost,::1"
RPC=http://127.0.0.1:8545
VOTING=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # 平台 owner（部署者）
STAKE=$(cast --to-wei 0.05 ether)

# 开案：trade=0, buyer=1, seller=0, stake=0.05, window=60s
cast send $VOTING "openCase(uint256,uint256,uint256,uint256,uint256)" 0 1 0 $STAKE 60 \
  --rpc-url $RPC --private-key $PK

# 三个钱包投票（case=0；BUYER=0, SELLER=1），A、B 支持买家，C 支持卖家
cast send $VOTING "vote(uint256,uint8)" 0 0 --value $STAKE --rpc-url $RPC --private-key 0xac09...
cast send $VOTING "vote(uint256,uint8)" 0 0 --value $STAKE --rpc-url $RPC --private-key 0x59c6...
cast send $VOTING "vote(uint256,uint8)" 0 1 --value $STAKE --rpc-url $RPC --private-key 0x5de4...

# 推进 61s 后结算（solo 链无竞争者，可跳时间）
cast rpc anvil_setNextBlockTimestamp $(( $(date +%s) + 61 )) --rpc-url $RPC
cast rpc anvil_mine --rpc-url $RPC
cast send $VOTING "settle(uint256)" 0 --rpc-url $RPC --private-key 0xac09...
```

## 已知限制（MVP 诚实说明）

- 质押/罚没/保费使用测试网模拟（无真实价值，合规）
- SchellingVoting 未做随机抽选陪审员（论文版补 ZK 抽选）
- claimReward/claimRefund 凭据领取制（论文版改 merkle 批量结算）
- 投票窗口为链上时间戳，solo 链演示需 cast 跳时间（见上）
- 演示若用 cast 缩短投票窗口，需记录实际操作（cast rpc anvil_setNextBlockTimestamp / anvil_mine）
