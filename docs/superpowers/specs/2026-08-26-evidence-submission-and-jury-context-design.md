# 举证与辩论机制 + 双方历史/信誉展示设计（C）

> 状态：已与用户逐项确认。日期：2026-08-26。
> 范围：`GuaranteeEscrow` 举证窗口与证据锚定；`SchellingVoting` 开案时序联动；前端争议页举证/证据展示/IPFS 持久化配套/双方历史信誉展示；测试、manifest、文档联动。
> 前序：B（World ID PoH 双通道与分级找回）、A（保费分档 + 敞口上限 + 买方记账）已合入 main。

## 1. 目标

1. 争议双方在**单轮举证窗口**内提交证据（IPFS 内容哈希锚定 + 链上摘要），陪审员投票前有据可依；
2. 陪审员可查看**双方过往交易记录与信誉分**，与证据共同构成裁决依据；
3. 补上 IPFS 的**持久化缺口配套**（pin 上传入口、消失警告、哈希校验）；
4. 未举证不自动处罚，仅在界面**明确标记"未举证"**。

## 2. 决策记录（已确认）

| 决策点 | 结论 |
|---|---|
| 证据存储 | **IPFS 内容哈希（CID）锚定 + 链上摘要**；大文件走 IPFS，链上存哈希与文字摘要 |
| 持久化配套 | 上传入口（Pinata/Web3.Storage，用户自备 token）+ 未托管警告 + 哈希校验，全部实现 |
| 举证轮次 | **单轮**：窗口内每方一份证据记录（可覆盖更新，计数记录提交次数） |
| 窗口时序 | **方案甲**：举证窗口 1 天；开案必须等举证窗口结束；开案总时限放宽到 **2 天**（`CASE_OPEN_WINDOW`） |
| 未举证处理 | **不处罚**，界面标记"未举证"，由陪审员自行判断 |
| 双方历史/信誉 | 争议页展示买卖双方信誉分、四计数器与最近交易（前端读取，无需合约改动） |

## 3. GuaranteeEscrow 改造

### 3.1 常量与状态

```solidity
uint256 public constant EVIDENCE_WINDOW = 1 days;   // 新增
// CASE_OPEN_WINDOW: 1 days → 2 days（开案须在举证窗口结束后、2 天内）

struct EvidenceRecord {
    bool exists;
    bytes32 contentHash;   // IPFS CID 编码为 bytes32（0 表示仅文字摘要）
    string summary;
    uint256 submittedAt;
}
mapping(uint256 => mapping(address => EvidenceRecord)) private _evidence;   // tradeId → 主体 → 记录
mapping(uint256 => mapping(address => uint256)) public evidenceSubmissionCount;

event EvidenceSubmitted(uint256 indexed tradeId, address indexed subject, bytes32 contentHash, string summary, uint256 submittedAt);
```

### 3.2 `submitEvidence(tradeId, contentHash, summary)`

- 前置：状态 `DISPUTED`、未开案（`!caseOpened`）、`block.timestamp <= disputedAt + EVIDENCE_WINDOW`、调用者为买方或卖方主体、contentHash 与摘要至少一项非空；
- 每方一份记录，窗口内可**覆盖更新**（`evidenceSubmissionCount` 递增）；
- 不改变交易状态机与义务计数。

### 3.3 `openArbitration`（开案时序）

```solidity
require(block.timestamp >= t.disputedAt + EVIDENCE_WINDOW, unicode"GuaranteeEscrow: 举证窗口未结束");
require(block.timestamp <= t.disputedAt + CASE_OPEN_WINDOW, unicode"GuaranteeEscrow: 开案超时");
```

- `timeoutVoidDispute` 顺延至 2 天（沿用 `CASE_OPEN_WINDOW` 常量，测试自动适配）。

### 3.4 读取接口（供陪审员与前端）

```solidity
function evidence(uint256 tradeId, address subject) external view returns (EvidenceRecord memory);
function evidenceWindowEnd(uint256 tradeId) external view returns (uint256);
```

- `SchellingVoting` 无需改动（开案经 `escrow.openArbitration` 自动获得新时序；陪审员经前端读取证据）。

## 4. 前端争议页

- **举证面板**（DISPUTED 且未开案、窗口内、争议双方可见）：
  - "上传证据到 IPFS"：用户粘贴自己的 Pinata JWT（不进仓库、不设服务端密钥）→ 选文件 pin → 返回 CID 自动填入；无 token 时手动粘贴 CID（本地/E2E 走此路径）；
  - 摘要 textarea + 提交按钮 → `submitEvidence`；
  - 未托管警告："文件无人托管会从 IPFS 网络消失"。
- **证据展示区**：双方证据卡片（摘要、CID、提交时间、提交次数）；CID 内容经网关渲染（图片/文本/链接）；**哈希校验按钮**（WebCrypto sha2-256 + multiformats 解码比对）；未提交方显示"未举证"标记。
- **双方历史与信誉**：信誉分 + 完成/违约/胜诉/败诉四计数器 + 最近交易列表（链上扫描 `0..nextTradeId` 过滤买卖双方，取最近 N 条：ID/状态/金额）。
- 依赖：`multiformats`（CID 解码校验）。

## 5. 测试

- 合约：submitEvidence（成功/覆盖更新/非主体/未争议/已开案/窗口外/空证据）；openArbitration 时序（窗口内拒绝、窗口后+2 天内允许、超时拒绝）；timeoutVoidDispute 顺延；既有争议测试全部补 `vm.warp(1 days)`（含 SchellingVoting/E2E/不变式 setUp）；
- 不变式：证据记录不影响义务计数与终态一次性；
- E2E：争议后买方举证（手动 CID）→ 卖方"未举证"标记 → 卖方举证 → 快进 1 天开案 → 既有投票流程；双方信誉/历史展示断言；
- manifest/ABI 重新生成。

## 6. 不做（YAGNI）

多轮反驳；未举证自动处罚；链上全文存储；陪审员名单固化；证据的链上时间锁/删除（覆盖更新即当前语义）。
