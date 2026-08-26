# 保费分档递增、担保人敞口上限与买方信誉记账设计（A）

> 状态：已与用户逐项确认。日期：2026-08-26。
> 范围：`GuaranteeEscrow` 保费定价分档、担保人累计敞口上限、买方结果记账；部署脚本、前端、测试、manifest 联动。
> 前序：B（World ID PoH 双通道与分级找回）已合入 main；本文档不改变 PoH/找回模型。
> 后续队列：C（举证与辩论机制 + 双方历史/信誉展示）。

## 1. 目标

1. 保费费率除信誉分外**随交易金额分档递增**（风险集中定价）；
2. 担保人**单主体累计敞口上限**，防止单个担保人风险无限堆积；
3. 修复**买方结果不记账**缺陷：买方与卖方在终态同时记账，买方分数只记录与展示、不参与定价。

## 2. 决策记录（已确认）

| 决策点 | 结论 |
|---|---|
| 费率方向 | **分档递增**：金额越大每 ETH 费率越高（保险业风险集中定价） |
| 分档 | T0 ≤1 ETH +0；T1 (1,10] ETH +100 bps；T2 >10 ETH +250 bps（链上常量） |
| 敞口上限 | **按主体累计**：`maxOpenStake` 默认 5 ETH，运营方可调；超限拒绝新担保报价；前端展示剩余额度 |
| 买方记账 | 只记录 + 展示（定价仍只用卖方分）；买方承担保费差额的托管改造不做（YAGNI） |
| 覆盖率公式 | 不变（仍只随卖方信誉分） |

## 3. GuaranteeEscrow 改造

### 3.1 分档费率

```solidity
uint256 public constant PREMIUM_TIER1_THRESHOLD = 1 ether;
uint256 public constant PREMIUM_TIER2_THRESHOLD = 10 ether;
uint256 public constant PREMIUM_TIER1_SURCHARGE_BPS = 100;
uint256 public constant PREMIUM_TIER2_SURCHARGE_BPS = 250;

function premiumTierSurchargeBps(uint256 amount) public pure returns (uint256); // 前端展示用
```

- `referencePremiumBps = 分数基准bps + 档位bps`；`referencePremium = amount × bps / 10000`；
- 总封顶 `MAX_PREMIUM_BPS = 2000` 与买方 `maxPremium` 上下限校验不变（低分卖家在大额档位可能因超出封顶而不可承保——风险自然排除，符合预期）；
- `createTrade` 已快照 `referencePremium`，`guarantee()` 的保费下限校验自动获得分档语义。

### 3.2 累计敞口上限

```solidity
uint256 public maxOpenStake;                        // 构造默认 5 ether
mapping(address => uint256) public openStakeBySubject;
event MaxOpenStakeUpdated(uint256 value);
function setMaxOpenStake(uint256 value) external onlyOwner;
function remainingGuaranteeCapacity(address subject) external view returns (uint256);
```

- `guarantee()` 成功时 `openStakeBySubject[subject] += stake`；前置 `openStakeBySubject[subject] + stake <= maxOpenStake`，超限 revert（`GuaranteeEscrow: 担保人敞口超限`）；
- `_markTerminal` 清担保义务时 `openStakeBySubject[guarantorSubject] -= stake`；
- 不变式：`openStakeBySubject[subject]` 恒等于该主体所有未结交易 stake 之和；
- 构造参数不变（registry, hub），默认值内置 + Deploy 经 `MAX_OPEN_STAKE` env 显式设置，manifest 校验脚本无需改动。

### 3.3 买方记账

- `Trade` 增加买方专属 pending 字段（`buyerOutcomePending` / `buyerOutcomeRecorded` / `pendingBuyerOutcome`）；
- 买方 outcomeId = `keccak256(abi.encode(address(this), tradeId, uint256(1)))`（与卖方区分、幂等）；
- `retryOutcome` 同时重试卖方与买方两条待记结果。

终态映射（与用户确认一致）：

| 终态 | 卖方 | 买方 |
|---|---|---|
| `confirm` / `timeoutAutoRelease` | COMPLETED | COMPLETED |
| `timeoutCancelUnaccepted` / `timeoutCancelUnfunded` | — | DEFAULTED（仅未托管情形） |
| `timeoutRefund`(FUNDED) / 各作废路径 | — | — |
| `timeoutRefund`(GUARANTEED) | DEFAULTED | COMPLETED |
| `resolveDispute` SELLER_WINS | WON | LOST |
| `resolveDispute` BUYER_WINS / PARTIAL_BUYER | LOST | WON |

- ReputationHub 无需改动；买方分数仅展示（信誉页按 Agent ID 读计数器，自动生效），供 C 的陪审团查看。

## 4. 部署 / 前端 / 测试

- `Deploy.s.sol`：`escrow.setMaxOpenStake(vm.envOr("MAX_OPEN_STAKE", uint256(5 ether)))`（在转移 owner 前调用）；
- 前端交易页：担保面板展示当前账户**剩余可担保额度**；条款预览注明档位附加费率；
- 测试：三档费率边界（阈值内/上/下）；敞口累计、终态退还、超限拒绝、`remainingGuaranteeCapacity`；买方各情形记账；`retryOutcome` 双补记；不变式（敞口 = 未结 stake 之和）；
- E2E：正常交易流追加"担保后剩余额度 4.925 ETH"断言；0.1 ETH 交易全部落在 T0，既有断言零影响；
- manifest/ABI 重新生成；USAGE §2.2 参数表与定价说明更新。

## 5. 不做（YAGNI）

买方分数参与定价（需托管结构改造）；覆盖率随金额变化；担保人信誉记账；敞口上限的自动调参机制。
