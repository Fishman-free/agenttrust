# AgentTrust 全链路演示手册

[English](./DEMO.md) | **简体中文**

> 本手册仅用于一次性本地 Anvil 链。公开的 Anvil 私钥和助记词绝不能用于任何公共网络或承载价值的网络。

## 一键启动

建议从干净状态启动；合约变更后必须删除旧 volume：

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
```

本机没有 Docker 时，可分别启动 Anvil、部署合约并运行前端。前端要求 **Node.js >=20.9**。

```bash
anvil --host 127.0.0.1 --chain-id 31337 --port 8545

RPC_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
sh contracts/scripts/deploy.sh

npm --prefix frontend ci
npm --prefix frontend run dev
```

部署地址来自 `deployments/31337.json`。`deploy.sh` 会验证四个核心合约的 bytecode、依赖、ACL 和 ownership。在本地 `31337` 链上，`Deploy.s.sol` 还会创建仅限本地的 `AnvilDevPoHVerifier`；它不由 manifest 跟踪，绝不能用于公共网络。不要在非 31337 链或非本地 RPC 上使用公开 Anvil 私钥。

## 正常交易

至少准备三个不同责任主体：

1. 买方注册 Agent。
2. 卖方注册 Agent。
3. 担保人注册 Agent。
4. 买方创建交易，填写 `amount` 和 `maxPremium`。
5. 卖方接受交易。
6. 买方将本金存入托管。
7. 担保人填写自己的 Agent ID、`coverage` 和 `premium`，并按链上精确的 `requiredStake` 质押。
8. 卖方接受担保。
9. 卖方交付。
10. 买方确认交付。
11. 卖方和担保人通过 pull-payment 提取余额。
12. 在信誉页确认卖方的 `completed` 计数增加。

新 Agent 默认信誉为 50。按当前平滑公式，对应最低 coverage 75%、参考保费率 7.5%。页面会直接读取链上报价和精确 stake。

## 争议交易

有效裁决至少需要六个不同责任主体：

- 买方、卖方和担保人；
- 三名独立 juror。

三名 juror 必须在交易创建前完成注册，因为 jury 资格会在创建交易时快照。买方、卖方和担保人不能为自己的交易投票。

流程：

1. 六个主体全部注册。
2. 将交易推进到 `DELIVERED`。
3. 买方或卖方支付链上读取的精确 2% dispute bond。
4. 任意人以 permissionless 方式调用 `openCase(tradeId)`。
5. 三名 juror 各自生成并备份 salt，提交 commitment 和固定 case stake。
6. 推进到 reveal 阶段。
7. 使用原 side/salt reveal。
8. reveal 窗口结束后调用 `settle`。
9. 每名有权参与者调用 `claim`，再调用 `withdraw`。
10. 任意人以 permissionless 方式调用 `finalizeJurorMetrics`。
11. 检查 Escrow 余额、卖方业务信誉以及 juror reveal/consensus 指标。

清理浏览器 `localStorage` 会删除 reveal secret，并可能导致 juror 的 stake 被罚没。清理浏览器数据前，务必导出页面提供的 secret 备份。

## 自动验证

权威 Foundry 基线为：**159 tests passed, 0 failed, 0 skipped**。

```bash
forge test --root contracts --match-contract E2ETest -vvv
npm --prefix frontend run e2e
```

Playwright 主门禁会自动启动并重置 Anvil，覆盖：

- 静态深链和真实 404；
- 三身份正常交易、提取和信誉；
- 六身份 dispute、commit/reveal、时间推进、settle、claim、withdraw 和 juror metrics。

MetaMask/Synpress smoke 是独立、非阻塞测试，仅验证真实扩展连接、切换到 31337 和本地注册。Synpress 4 的 cache CLI 不支持原生 Windows；请使用 Linux/WSL，或手动触发 GitHub Actions job。

```bash
npm --prefix frontend run e2e:metamask:cache
npm --prefix frontend run e2e:metamask
```

仅使用公开的一次性 Anvil 助记词，绝不能复用真实钱包助记词。

## 本地推进链上时间

部署参数固定为一天 commit 窗口加一天 reveal 窗口。以下方法仅限本地 Anvil：

```bash
cast rpc evm_increaseTime 86401 --rpc-url http://127.0.0.1:8545
cast rpc evm_mine --rpc-url http://127.0.0.1:8545
```

不要对公共 RPC 使用 Anvil 时间操纵方法。

## 已知限制

- 当前不是随机 jury。
- 在交易创建前注册的 Sybil 身份仍可能参与。
- “Consensus aligned”只表示与协议有效裁决一致，不证明现实真相。
- Juror metric 依赖结算后的 permissionless finalization。
World ID app `app_01728cabff1e05950af1ff18c06c9d38` 与 RP `rp_fd884ac4342cc4d1` 已注册。- Base Sepolia 核心合约已部署并通过 RPC 校验，地址只能以 [`../../deployments/84532.json`](../../deployments/84532.json) 为准。https://agenttrust.site 已在东京 Caddy 上线且 HTTPS 有效，`www` 重定向到主域名；GitHub Pages 门禁修改尚未合并。PoH 注册及担保人/陪审门禁通过同源 `/api/world-id` 后端证明与已绑定 Registry 的适配器 `0x1325C3eD12d535Bc33A56305466159d370BDf6cE` 启用，并非 World 证明直接链上验证。由于 `verifySameIdentity` 返回 `false`，找回采用全部守护人 + 48 小时否决窗。
- 合约未经独立审计，不应视为可用于生产环境。

公共测试网准备流程见 [Base Sepolia 部署指南](./DEPLOY-BaseSepolia.zh-CN.md)。
