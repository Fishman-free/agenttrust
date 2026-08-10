# AgentTrust 全链路演示手册

> 仅用于 disposable Anvil 本地链。公开的 Anvil 私钥和助记词绝不能用于任何公共或有价值网络。

## 一键启动

推荐使用干净状态启动，合约变更后必须删除旧 volume：

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
```

本机没有 Docker 时，可以分别启动 Anvil、部署并运行前端：

```bash
anvil --host 127.0.0.1 --chain-id 31337 --port 8545

RPC_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
sh contracts/scripts/deploy.sh

npm --prefix frontend ci
npm --prefix frontend run dev
```

部署地址来自 `deployments/31337.json`。`deploy.sh` 会验证四个合约的 bytecode、依赖、ACL 和 ownership。不要在非 31337 或非本地 RPC 上使用公开 Anvil key。

## 正常交易

至少准备三个不同责任主体：

1. 买方注册 Agent；
2. 卖方注册 Agent；
3. 担保人注册 Agent；
4. 买方创建交易，填写 amount 和 maxPremium；
5. 卖方接受交易；
6. 买方托管本金；
7. 担保人填写自己的 Agent ID、coverage 和 premium，按链上 `requiredStake` 质押；
8. 卖方接受担保；
9. 卖方交付；
10. 买方确认；
11. 卖方和担保人通过 pull-payment 提取余额；
12. 在信誉页检查卖方 completed 计数。

新 Agent 默认信誉 50，当前平滑公式对应最低 coverage 75%，参考保费率 7.5%。页面会直接读取链上报价和精确 stake。

## 争议交易

有效裁决至少需要六个不同责任主体：

- 买方、卖方、担保人；
- 三名独立 juror。

三名 juror 必须在交易创建前注册，因为 jury 资格数量在创建交易时快照。买方、卖方和担保人不能为自己的交易投票。

流程：

1. 六个主体全部注册；
2. 完成交易到 `DELIVERED`；
3. 买方或卖方支付链上读取的精确 2% dispute bond；
4. 任意人调用 permissionless `openCase(tradeId)`；
5. 三名 juror 各自生成并备份 salt，提交 commitment 和固定 case stake；
6. 推进到 reveal 阶段；
7. 使用原 side/salt reveal；
8. reveal 窗口结束后调用 `settle`；
9. 有权参与者统一调用 `claim`，再 `withdraw`；
10. permissionless 调用 `finalizeJurorMetrics`；
11. 检查 Escrow 资金、卖方业务信誉和 juror reveal/consensus 指标。

清理浏览器 localStorage 会丢失 reveal secret，并可能导致 stake 被罚没。页面提供 secret 备份功能。

## 自动验证

```bash
forge test --root contracts --match-contract E2ETest -vvv
npm --prefix frontend run e2e
```

Playwright 主门禁会自动启动并重置 Anvil，覆盖：

- 静态深链和真实 404；
- 三身份正常交易、提取和信誉；
- 六身份 dispute、commit/reveal、时间推进、settle、claim、withdraw 和 juror metrics。

MetaMask/Synpress smoke 是独立、非阻塞测试，仅验证真实扩展连接、切换 31337 和本地注册。Synpress 4 不支持原生 Windows cache CLI，需 Linux/WSL 或手动 GitHub Actions：

```bash
npm --prefix frontend run e2e:metamask:cache
npm --prefix frontend run e2e:metamask
```

## 本地推进链上时间

部署参数固定为一天 commit 加一天 reveal。仅在本地 Anvil 使用：

```bash
cast rpc evm_increaseTime 86401 --rpc-url http://127.0.0.1:8545
cast rpc evm_mine --rpc-url http://127.0.0.1:8545
```

不要对公共 RPC 使用 Anvil 时间操纵方法。

## 已知限制

- 当前不是随机 jury；
- 交易创建前预置的 Sybil 仍可能参与；
- consensus aligned 只表示与协议有效裁决一致，不证明现实真相；
- juror metric 依赖结算后的 permissionless finalization；
- Base Sepolia manifest 当前为 `undeployed`，Pages 仅发布明确的只读研究预览；
- 未经独立审计，不应视为生产合约。
