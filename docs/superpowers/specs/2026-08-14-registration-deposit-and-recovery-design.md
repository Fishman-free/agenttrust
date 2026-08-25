# 注册押金与身份找回设计（AgentRegistry v2）

> 状态：已与用户逐项确认。日期：2026-08-14。
> 范围：`AgentRegistry` 押金模型改造 + PoH 身份找回；`GuaranteeEscrow`/`SchellingVoting` 增加义务计数接口；部署脚本、前端、测试、manifest 联动。

## 1. 目标

1. 注册费从"纯费用"改为**可退还押金**，降低用户进入门槛；
2. **主动注销**：可取回押金、Agent ID 永久退役，同一主体终身不可再注册；
3. **私钥丢失找回**：PoH（World ID 类预言机）+ 守护人双确认，24 小时否决窗口；
4. 找回 = **迁移既有身份**（不创建第二身份、不清零信誉）；
5. 预留**罚没接口**（本次不实现罚没规则）。

## 2. 决策记录（已确认）

| 决策点 | 结论 |
|---|---|
| 注销后能否重新注册 | **不能**（终身一 ID，堵死信誉洗白） |
| 找回方案 | World ID 类 PoH 证明"同一人类" + ≥1 个守护人批准 + 24h 原钱包否决窗口 |
| 守护人 | 注册时设置 **2–3 个**紧急联系人 |
| 押金金额 | 默认 **0.01 ETH**，`REGISTRATION_DEPOSIT` 可配（可退还，所以不设更高） |
| 信誉记账 | 继续按 **Agent ID** 记账（ReputationHub 不改主体记账） |
| 罚没 | 本次只留 `slashDeposit` 接口，不写罚没规则 |

## 3. AgentRegistry 状态与接口

### 3.1 新增状态

```solidity
uint256 public registrationDeposit;                      // 原 registrationFee 更名
mapping(address => uint256) public deposits;             // 锁定的押金
mapping(address => bool) public deregistered;            // 已注销（永久退出）
mapping(address => address[]) public guardians;          // 每个主体的守护人（2–3 个）
mapping(address => mapping(address => bool)) public isGuardian;
mapping(bytes32 => address) public nullifierSubject;     // PoH nullifier → 主体（找回锚点）
mapping(address => bool) public authorizedSlashSources;  // 罚没白名单（预留）

struct RecoveryRequest {
    address newWallet;
    uint256 deadline;        // 发起时间 + 24h
    uint256 approvals;
    mapping(address => bool) approvedBy;
    bool exists;
}
mapping(address => RecoveryRequest) public recoveryRequests; // 按原主体索引

address public escrowOracle;   // 义务检查：GuaranteeEscrow
address public votingOracle;   // 义务检查：SchellingVoting
```

### 3.2 注册（签名变化，ABI 破坏性变更）

```solidity
function registerAgent(string name, string desc, string endpoint, address[] calldata guardians)
    external payable nonReentrant returns (uint256 tokenId);
function registerAgentVerified(string name, string desc, string endpoint,
    bytes32 nullifier, bytes calldata proof, address[] calldata guardians)
    external payable nonReentrant returns (uint256 tokenId);
```

- `msg.value >= registrationDeposit`；押金入 `deposits[msg.sender]`；超额入 `pendingWithdrawals`
- 守护人校验：数量 2–3、非零地址、非本人、不重复
- PoH 路径：`nullifierSubject[nullifier] = msg.sender`（新增）
- 移除 `accruedFees`/`withdrawFees`（纯押金模型无协议收入）

### 3.3 主动注销

```solidity
function deregister() external nonReentrant;
```

- 前置：`registeredSubjects[msg.sender]` 且未注销、无进行中（未过期）的找回请求
- 效果：burn Agent NFT（ID 永久退役，`agentCount` 不变以保护资格快照语义）、
  `deposits[msg.sender]` 全额转 `pendingWithdrawals`、`deregistered=true`、清空守护人数组（返还 gas）
- 事件：`SubjectDeregistered(subject, agentId)`
- 不变式：`registeredSubjects` 保持 true（终身一 ID，注销后不可再注册）

### 3.4 找回流程（三步 + 否决）

```solidity
function requestRecovery(bytes32 nullifier, bytes calldata recoveryProof, address newWallet) external;
function approveRecovery(address subject) external;
function vetoRecovery(address subject) external;
```

**requestRecovery**（新钱包调用）：
- 前置：PoH 已启用；`nullifierSubject[nullifier] != 0`；该主体未注销、无进行中（未过期）的请求（过期请求可被新请求覆盖）；`newWallet` 未注册、非零
- 验证：`IAgentProofOfPersonhood(pohVerifier).verifySameIdentity(nullifier, recoveryProof)`（**仅验证不消费**）
- 效果：创建请求，`deadline = block.timestamp + 24 hours`，发 `RecoveryRequested` 事件

**approveRecovery**（任一守护人调用）：
- 前置：调用者是 `subject` 的守护人、请求存在且未过期、未重复批准
- 效果：`approvals++`，达到 **1 票**即执行 `_executeRecovery`

**vetoRecovery**（原钱包调用）：
- 前置：`msg.sender == subject`、请求存在且未过期
- 效果：删除请求，发 `RecoveryVetoed`；此后可重新发起

**_executeRecovery**（内部）：
- 义务检查：`escrowOracle`/`votingOracle` 非零时，要求 `subjectHasActiveTrades(subject)==false` 且 `subjectHasOpenCommitments(subject)==false`
- 迁移内容（全部从旧主体 → `newWallet`）：
  1. Agent NFT 所有权与 `agents[tokenId].owner`（责任主体）
  2. `deposits`（押金跟随人）
  3. `registeredSubjects`/`registeredAtBlock`/`firstAgentIdPlusOne`（资格快照跟随人）
  4. 守护人列表与 `isGuardian` 重绑
- 旧钱包：`registeredSubjects` 保持 true（永久封禁，防偷私钥者再注册）
- 事件：`RecoveryCompleted(subject, oldWallet, newWallet, agentId)`
- 信誉不清零：信誉仍按原 Agent ID 在 ReputationHub 中记账

### 3.5 罚没钩子（预留，不实现规则）

```solidity
function setSlashSource(address source, bool authorized) external onlyOwner;
function slashDeposit(address subject, address recipient, uint256 amount) external;
```

- 仅白名单来源可调；`amount ≤ deposits[subject]`；划转至 `pendingWithdrawals[recipient]`

### 3.6 其他

```solidity
function setObligationOracles(address escrow, address voting) external onlyOwner; // Deploy 脚本接线
function setPoHVerifier(address) external onlyOwner;                              // 已有
function setRegistrationDeposit(uint256) external onlyOwner;                      // 原 setRegistrationFee 更名
```

## 4. Escrow / Voting 义务计数（找回安全的前提）

**GuaranteeEscrow**：
- `mapping(address => uint256) public openTradeCount;`
- `createTrade`：buyerSubject、sellerSubject 各 +1；`guarantee`：guarantorSubject 首次 +1
- 所有终态迁移（RELEASED / RESOLVED / VOIDED）统一经 `_markTerminal` 对买方、卖方、担保人（若已产生）各 −1；
  终态入口：`_release`（confirm / timeoutAutoRelease）、`resolveDispute`、`_voidFundedTrade`（voidDispute / timeoutVoidDispute / timeoutRejectGuarantee）、`timeoutCancelUnaccepted`、`timeoutCancelUnfunded`、`timeoutRefund` 两分支
- `subjectHasActiveTrades(address) view returns (bool)`

**SchellingVoting**：
- `mapping(address => uint256) public openCommitmentCount;`
- `commitVote` +1；`claim` 与 `finalizeJurorMetrics` 通过 Case 内新增 `obligationCleared[subject]` 标志**恰好减一次**（覆盖胜方 claim 路径与被罚没者的 finalize 路径）
- `subjectHasOpenCommitments(address) view returns (bool)`

**不变式**（invariant 测试目标）：任一主体的 openTradeCount == 其参与的非终态交易数；openCommitmentCount == 其已提交且未清结的案件数。

## 5. 安全边界与攻击分析

| 攻击/场景 | 防御 |
|---|---|
| 守护人串通迁移他人身份 | 24h 否决窗口：真实主人只要在线即可 veto；事件驱动前端提醒 |
| World ID 凭证被盗 + 守护人串通 | 同上（双因素仍可被组合攻破，文档声明残余风险） |
| 偷私钥者抢注/复活旧钱包 | 旧钱包永久封禁（registeredSubjects 保持 true）；新钱包必须是全新的 |
| 有未结交易时找回导致资金卡死 | 义务计数拦截；交易/案件超时后自动清结，之后可再找回 |
| 重复发起找回请求 | 同一主体同时至多一个请求；过期/被否决后可重发 |
| 注销后找回 | 已注销身份不可找回（自愿退出即永久） |
| 纯质押注册身份（演示模式）丢失 | 不可找回，文档明示；真实运营必须开 PoH |
| 信誉洗白 | 终身一 ID + 找回不新建 ID，信誉按 Agent ID 持续累计 |
| 罚没接口被滥用 | 仅 owner 白名单合约可调，本次无任何来源被授权 |

## 6. 前端改动（frontend）

- 注册表单：新增 2–3 个守护人地址输入；按钮文案改为「注册（押金 0.01 ETH，可退还）」
- 智能体页：显示锁定押金；新增「注销并退还押金」按钮（义务未清时显示原因）
- 找回 UI（最小集）：原钱包显示否决按钮（基于请求状态）；守护人显示批准入口（输入 subject）；`requestRecovery` 因需 PoH 证明，MVP 提供 cast 命令文档而非网页按钮
- e2e 选择器文案同步更新

## 7. 测试计划

- **AgentRegistry**（+12）：押金锁定/注销退还/注销后禁注册/注销后信誉档案仍可查/守护人参数校验/找回全流程（mock 预言机）/否决窗口/过期不可批准/义务未清不可执行/未 PoH 身份不可找回/新钱包已注册不可找回/罚没钩子 ACL 与记账
- **GuaranteeEscrow**（+3）：义务计数全终态路径、invariant（计数 == 实际未结交易）
- **SchellingVoting**（+3）：commit/claim/finalize 恰好减一、invariant
- **E2E / 既有测试适配**：所有 `registerAgent` 调用点补守护人参数
- 全量 `forge test` + `npm test` + manifest `--check` + Playwright e2e 通过为准

## 8. 部署与联动

1. `Deploy.s.sol`：`REGISTRATION_DEPOSIT`（默认 0.01 ether）；部署后 `registry.setObligationOracles(escrow, voting)`
2. 重新生成 `deployments/31337.json`（runtime hash 变化）与 `frontend/lib/deployments.ts`、`frontend/lib/abi.ts`
3. 文档：USAGE.md（注册/注销/找回章节）、anti-sybil-analysis.md、README 文档索引

## 9. 残余风险（诚实声明）

- World ID 真实接入依赖其 verifier 部署与"仅验证不消费"通道；本仓库以接口 + Mock 落地
- 找回的最终安全 = PoH 预言机可信度 × 守护人可信度 × 24h 在线率
- 纯质押注册身份无找回能力
- `setPoHVerifier`/`setObligationOracles`/`setSlashSource` 权限在 owner（治理风险点）
