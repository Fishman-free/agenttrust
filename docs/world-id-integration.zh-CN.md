# World ID 接入说明

[English](world-id-integration.md) | **简体中文**

[← 返回功能走查](feature-walkthrough.zh-CN.md) · [防女巫分析](security/anti-sybil-analysis.zh-CN.md) · [项目 README](../README.zh-CN.md)

> **测试网线上状态：**Base Sepolia 核心部署已按 [`../deployments/84532.json`](../deployments/84532.json) 通过 RPC 校验。World ID app `app_01728cabff1e05950af1ff18c06c9d38` 与依赖方 RP `rp_fd884ac4342cc4d1` 已注册。合约未经审计、仅限测试网，不具备生产可用性。

## 1. 线上架构

World ID v4 在 Base Sepolia 没有可用的直接验证器。因此 AgentTrust 明确采用 **后端证明（backend-attestation）** 架构，不宣称 World 证明直接链上验证：

```text
IDKit / World 证明
  → 同源 /api/world-id
  → World ID 官方 v4 Developer Portal API
  → 可信证明人签名（签名密钥仅在服务器）
  → WorldIDV4AttestationVerifier
  → AgentRegistry
```

| 组件 | 已核实线上状态 |
|---|---|
| 公网站点 | https://agenttrust.site 由东京 Caddy 提供服务，HTTPS 有效；`www` 重定向到主域名 |
| 核心合约 | 已部署并通过 RPC 校验；以 [`../deployments/84532.json`](../deployments/84532.json) 为准 |
| App / RP | `app_01728cabff1e05950af1ff18c06c9d38` / `rp_fd884ac4342cc4d1` |
| 后端 | 同源 `/api/world-id`，调用官方 v4 Developer Portal API |
| 适配器 | `WorldIDV4AttestationVerifier`：`0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF` |
| Registry 绑定 | 适配器已绑定 `AgentRegistry` |
| 已启用门禁 | PoH 注册、担保人资格、陪审员资格 |
| GitHub Pages | 部署门禁工作流已修改但尚未合并 |

后端签名密钥仅可保存在服务器，绝不能进入前端 bundle、公开环境变量、日志或文档。

## 2. 信任边界

适配器验证的是可信证明人签名，**不会**在链上独立验证 World 证明。因此安全性依赖：

1. World ID 官方 v4 Developer Portal API 返回正确结果；
2. `/api/world-id` 后端正确校验请求与响应；
3. 可信证明人签名密钥保持机密并受运营方控制；
4. Registry 始终绑定预期适配器；
5. 重放、action、signal、chain、过期与 nullifier 检查持续正确执行。

后端或证明人密钥被攻破可能生成虚假 PoH 证明。应轮换/撤销泄露密钥、监控适配器和 Registry 变更，并把该模型明确描述为后端可信，而非无信任的 World 直接链上验证。

## 3. 注册与特权角色

World ID 仅作为 **Labs 人类证明实验**展示，不是实名认证、政府证件核验或法律身份。它与账户认证相互独立：前端 Auth BFF 会话和 SIWE 登录保护工作台访问，钱包连接则用于授权链上交易提示。

后端验证成功后生成供 Registry 路径消费的证明，可用于 PoH 注册或 `bindPoH`。合约通过 `isPoHVerified` 强制担保人和新陪审员门禁。普通注册是主路径且没有特权角色资格。普通注册与 PoH 注册都提交当前链上 `registrationDeposit`，前端不得对其倍乘。前端对新担保和加入陪审团操作采用 `isPoHVerified` 读取失败即阻断；已经提交陪审承诺的实验用户仍可揭示、领取并完成既有义务。

本地 Anvil 与 CI 继续使用开发/mock 验证器做确定性测试；mock 不能证明真实 World 验证能力，也绝不能公开部署。

## 4. 找回行为

已部署适配器的 `verifySameIdentity` 返回 `false`，因此 Base Sepolia 不提供同人快速路径，找回固定降级到守护人路径：

- **全部已配置守护人必须批准**；
- 必须经过 **48 小时否决窗**；
- 仍需满足正常执行窗口和无未结义务检查。

文档和 UI 不得把“1 位守护人 + 24 小时”描述为 Base Sepolia 线上可用路径。

## 5. 运维检查

- 确认 `/api/world-id` 始终同源且仅通过 HTTPS 提供；
- 确认签名秘密仅在服务器，未进入静态输出；
- 核验 `AgentRegistry.pohVerifier()` 等于 `0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF`；
- 监控证明人轮换与 Registry 验证器变更；
- 测试重放、过期、错误 action/signal/chain 与畸形请求均被拒绝；
- 持续展示“未经审计、仅限测试网、不具备生产可用性”警告。

---

[← 返回功能走查](feature-walkthrough.zh-CN.md) · [防女巫分析](security/anti-sybil-analysis.zh-CN.md) · [项目 README](../README.zh-CN.md)
