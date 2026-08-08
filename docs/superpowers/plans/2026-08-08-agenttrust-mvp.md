# AgentTrust MVP 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 AgentTrust 全链上 MVP——智能体身份注册、担保托管交易、Schelling 争议投票、信誉记录四合约 + 开发者门户前端 + 全链路演示（规格见 `docs/superpowers/specs/2026-08-08-agenttrust-design.md` §5-§9）。

**Architecture:** 四个 Solidity 合约部署在 Base Sepolia 测试网：`AgentRegistry`（ERC-721 智能体身份，责任主体绑定）、`GuaranteeEscrow`（交易状态机 + 担保人质押 + 罚没）、`SchellingVoting`（争议质押投票，≥2/3 多数收敛，罚没分配）、`ReputationHub`（attestation 式信誉记录，ACL 限定 Escrow/Voting 写入）。Next.js 门户直连合约。MVP 阶段质押/保费用测试网代币模拟（无真实价值）。

**Tech Stack:** Solidity 0.8.24 + Foundry + OpenZeppelin 5｜Base Sepolia 测试网｜Next.js 15 + wagmi v2 + viem + TypeScript

**范围外（后续 plan）**：论文形式化、Python mesa 仿真、EAS 生产集成、Kleros 集成、真实随机抽选陪审员。

---

## 文件结构

```
contracts/                        # Foundry 项目
├── foundry.toml
├── lib/                          # forge 依赖（自动生成）
├── src/
│   ├── AgentRegistry.sol         # 智能体身份注册表（ERC-721）
│   ├── ReputationHub.sol         # 信誉记录中心
│   ├── GuaranteeEscrow.sol       # 担保托管交易
│   └── SchellingVoting.sol       # 争议投票
├── test/
│   ├── AgentRegistry.t.sol
│   ├── ReputationHub.t.sol
│   ├── GuaranteeEscrow.t.sol
│   ├── SchellingVoting.t.sol
│   └── E2E.t.sol                 # 全链路集成测试（= 演示）
├── script/
│   └── Deploy.s.sol              # 部署脚本
└── demo/
    └── DEMO.md                   # 全链路演示手册

frontend/                         # Next.js 开发者门户
├── app/
│   ├── page.tsx                  # 首页（导航 + 概览）
│   ├── agents/page.tsx           # 智能体注册/列表
│   ├── trade/page.tsx            # 交易操作台（创建/担保/交付/确认）
│   ├── disputes/page.tsx         # 争议与投票
│   └── reputation/page.tsx       # 信誉仪表盘
├── lib/
│   ├── config.ts                 # 合约地址/ABI/链配置
│   ├── wagmi.ts                  # wagmi 客户端
│   └── abi.ts                    # 四合约 ABI（从 forge artifacts 生成）
```

**合约间依赖**（锁定接口，后续任务类型一致）：

- `GuaranteeEscrow` 依赖 `AgentRegistry`（查 agent owner 做权限控制）与 `ReputationHub`（记录完成/违约）
- `SchellingVoting` 依赖 `GuaranteeEscrow`（调用 `resolveDispute`）与 `ReputationHub`（记录裁决）
- `ReputationHub` 依赖 `GuaranteeEscrow` 与 `SchellingVoting`（ACL：仅二者可写）

---

## Phase 0：脚手架

### Task 1: Foundry 项目初始化

**Files:**
- Create: `contracts/foundry.toml`
- Create: `contracts/.gitignore`

- [ ] **Step 1: 初始化 Foundry 项目**

```bash
cd "C:/Users/21560/Desktop/blockchain" && forge init contracts --no-git --force
cd contracts && forge install OpenZeppelin/openzeppelin-contracts --no-commit
```

Expected: `contracts/src/`、`contracts/test/`、`contracts/lib/` 生成，OpenZeppelin 安装成功。

- [ ] **Step 2: 写 foundry.toml**

`contracts/foundry.toml`：
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
evm_version = "paris"

[profile.default.fuzz]
runs = 256
```

- [ ] **Step 3: 清理模板并 commit**

```bash
rm -f contracts/src/Counter.sol contracts/test/Counter.t.sol contracts/script/Counter.s.sol
cd "C:/Users/21560/Desktop/blockchain" && git add contracts/foundry.toml contracts/.gitignore contracts/lib 2>/dev/null; git add -A contracts && git commit -m "chore: 初始化 Foundry 合约工程"
```

---

### Task 2: Next.js 前端脚手架

**Files:**
- Create: `frontend/`（脚手架生成）
- Create: `frontend/lib/config.ts`

- [ ] **Step 1: 创建 Next.js 项目**

```bash
cd "C:/Users/21560/Desktop/blockchain" && npx create-next-app@latest frontend --ts --eslint --app --no-src-dir --import-alias "@/*" --use-npm --yes
cd frontend && npm install wagmi viem @tanstack/react-query
```

Expected: `frontend/app/` 生成，wagmi/viem 安装完成。

- [ ] **Step 2: 写链配置**

`frontend/lib/config.ts`：
```typescript
// Base Sepolia 测试网（MVP 部署目标）
import { defineChain } from "viem";

export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Base Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
  blockExplorers: {
    default: { name: "BaseScan", url: "https://sepolia.basescan.org" },
  },
});

export const CHAIN_ID = 84532;

// 部署后由 Task 13 填入实际地址
export const CONTRACT_ADDRESSES = {
  agentRegistry: "0x0000000000000000000000000000000000000000",
  reputationHub: "0x0000000000000000000000000000000000000000",
  guaranteeEscrow: "0x0000000000000000000000000000000000000000",
  schellingVoting: "0x0000000000000000000000000000000000000000",
};
```

- [ ] **Step 3: 清理默认页并 commit**

```bash
cd frontend && rm -f app/page.tsx
cd "C:/Users/21560/Desktop/blockchain" && git add frontend && git commit -m "chore: 初始化 Next.js 开发者门户"
```

---

## Phase 1：合约（TDD）

### Task 3: AgentRegistry —— 智能体身份注册表

**Files:**
- Test: `contracts/test/AgentRegistry.t.sol`
- Create: `contracts/src/AgentRegistry.sol`

**职责**：铸造 Agent ID（ERC-721）、记录责任主体（owner）、注册质押（anti-Sybil）、公开 agent 元数据查询。对齐 ERC-8004 身份注册表语义（可移植 ID + owner 绑定）。

- [ ] **Step 1: 写失败测试**

`contracts/test/AgentRegistry.t.sol`：
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry registry;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        registry = new AgentRegistry();
    }

    function test_registerAgent_mintsAndBindsOwner() public {
        vm.prank(alice);
        uint256 tokenId = registry.registerAgent("DataAgent", "数据分析服务", "https://a.example/mcp");

        assertEq(tokenId, 0);
        assertEq(registry.ownerOf(tokenId), alice, "责任主体应为注册人");
        assertEq(registry.agentCount(), 1);
    }

    function test_registerAgent_paysRegistrationFee() public {
        registry.setRegistrationFee(0.01 ether);

        vm.prank(alice);
        vm.expectRevert("AgentRegistry: 注册质押不足");
        registry.registerAgent("A", "desc", "https://a.example/mcp");

        vm.prank(alice);
        registry.registerAgent{value: 0.01 ether}("A", "desc", "https://a.example/mcp");
        assertEq(address(registry).balance, 0.01 ether);
    }

    function test_agentInfo_returnsMetadata() public {
        vm.prank(alice);
        uint256 tokenId = registry.registerAgent("DataAgent", "数据分析服务", "https://a.example/mcp");

        (string memory name, string memory desc, string memory endpoint, address owner, uint256 createdAt) =
            registry.agents(tokenId);
        assertEq(name, "DataAgent");
        assertEq(desc, "数据分析服务");
        assertEq(endpoint, "https://a.example/mcp");
        assertEq(owner, alice);
        assertGt(createdAt, 0);
    }

    function test_onlyOwner_setsFee() public {
        vm.prank(bob);
        vm.expectRevert();
        registry.setRegistrationFee(0.1 ether);

        vm.prank(alice); // 非 owner 也失败（部署者为 owner）
        vm.expectRevert();
        registry.setRegistrationFee(0.1 ether);
    }

    function test_withdrawFees_onlyOwner() public {
        vm.prank(alice);
        registry.registerAgent{value: 0.01 ether}("A", "desc", "x");

        vm.prank(bob);
        vm.expectRevert();
        registry.withdrawFees();

        vm.prank(registry.owner());
        registry.withdrawFees();
        assertEq(registry.owner().balance, 0.01 ether);
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd contracts && forge test --match-contract AgentRegistryTest -vvv`
Expected: FAIL（编译错误：找不到 AgentRegistry 合约）

- [ ] **Step 3: 实现合约**

`contracts/src/AgentRegistry.sol`：
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentRegistry —— 智能体身份注册表
/// @notice 对齐 ERC-8004 身份注册表语义：可移植 Agent ID（ERC-721）+ 责任主体绑定 + anti-Sybil 注册质押。
///         铸造者即法律责任人（智能体无民事主体资格，责任归属真实主体）。
contract AgentRegistry is ERC721, Ownable, ReentrancyGuard {
    struct AgentInfo {
        string name;        // 智能体名称
        string description; // 能力描述
        string endpoint;    // MCP/A2A 接入端点
        address owner;      // 责任主体（= 铸造者）
        uint256 createdAt;  // 注册时间
    }

    uint256 public registrationFee;   // 注册质押（anti-Sybil）
    uint256 public agentCount;
    mapping(uint256 => AgentInfo) public agents;

    event AgentRegistered(uint256 indexed tokenId, address indexed owner, string name);
    event RegistrationFeeUpdated(uint256 fee);

    constructor() ERC721("AgentTrust Agent ID", "ATID") Ownable(msg.sender) {}

    /// 设置注册质押金额（仅 owner）
    function setRegistrationFee(uint256 fee) external onlyOwner {
        registrationFee = fee;
        emit RegistrationFeeUpdated(fee);
    }

    /// 注册智能体：支付注册质押，铸造 Agent ID，绑定责任主体
    function registerAgent(string memory name, string memory description, string memory endpoint)
        external payable nonReentrant returns (uint256 tokenId)
    {
        require(msg.value >= registrationFee, "AgentRegistry: 注册质押不足");

        tokenId = agentCount++;
        _safeMint(msg.sender, tokenId);
        agents[tokenId] = AgentInfo(name, description, endpoint, msg.sender, block.timestamp);

        emit AgentRegistered(tokenId, msg.sender, name);
    }

    /// 提取注册质押（仅 owner）
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "AgentRegistry: 余额为零");
        (bool ok,) = owner().call{value: balance}("");
        require(ok, "AgentRegistry: 转账失败");
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd contracts && forge test --match-contract AgentRegistryTest -vvv`
Expected: 5 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add contracts/src/AgentRegistry.sol contracts/test/AgentRegistry.t.sol && git commit -m "feat(contracts): AgentRegistry 智能体身份注册表"
```

---

### Task 4: ReputationHub —— 信誉记录中心

**Files:**
- Test: `contracts/test/ReputationHub.t.sol`
- Create: `contracts/src/ReputationHub.sol`

**职责**：记录智能体交易结果（完成/违约/仲裁胜负），多维统计（MVP 版为 attestation 式事件记录，论文版接 EAS）。ACL：仅授权合约（Escrow/Voting）可写入，禁止自评。

- [ ] **Step 1: 写失败测试**

`contracts/test/ReputationHub.t.sol`：
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReputationHub} from "../src/ReputationHub.sol";

contract ReputationHubTest is Test {
    ReputationHub hub;
    address escrow = makeAddr("escrow");
    address voting = makeAddr("voting");
    address stranger = makeAddr("stranger");

    function setUp() public {
        hub = new ReputationHub();
        hub.setAuthorizedCaller(escrow, true);
        hub.setAuthorizedCaller(voting, true);
    }

    function test_recordOutcome_updatesStats() public {
        vm.prank(escrow);
        hub.recordOutcome(1, ReputationHub.Outcome.COMPLETED);
        hub.recordOutcome(1, ReputationHub.Outcome.SELLER_DEFAULTED);
        hub.recordOutcome(2, ReputationHub.Outcome.BUYER_WON_DISPUTE);

        (uint256 completed, uint256 defaulted, uint256 disputesWon, uint256 disputesLost) =
            hub.reputation(1);
        assertEq(completed, 1);
        assertEq(defaulted, 1);
        assertEq(disputesWon, 0);

        (uint256 c2, uint256 d2, uint256 w2,) = hub.reputation(2);
        assertEq(c2, 0);
        assertEq(d2, 0);
        assertEq(w2, 1);
    }

    function test_recordOutcome_rejectsUnauthorized() public {
        vm.prank(stranger);
        vm.expectRevert("ReputationHub: 未授权调用方");
        hub.recordOutcome(1, ReputationHub.Outcome.COMPLETED);
    }

    function test_recordOutcome_rejectsSelfRating() public {
        // 智能体 3 的 owner 尝试给 3 自己评分 → 未授权即失败（本 MVP 无 agent 侧写入口）
        vm.prank(stranger);
        vm.expectRevert("ReputationHub: 未授权调用方");
        hub.recordOutcome(3, ReputationHub.Outcome.COMPLETED);
    }

    function test_setAuthorizedCaller_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        hub.setAuthorizedCaller(escrow, true);
    }

    function test_events_emitted() public {
        vm.expectEmit();
        emit ReputationHub.OutcomeRecorded(1, ReputationHub.Outcome.COMPLETED);
        vm.prank(escrow);
        hub.recordOutcome(1, ReputationHub.Outcome.COMPLETED);
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd contracts && forge test --match-contract ReputationHubTest -vvv`
Expected: FAIL（找不到 ReputationHub 合约）

- [ ] **Step 3: 实现合约**

`contracts/src/ReputationHub.sol`：
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ReputationHub —— 信誉记录中心
/// @notice 记录智能体交易结果与仲裁裁决，形成不可篡改的行为档案（"警察证据"）。
///         MVP 用链上结构+事件存证；论文版迁移 EAS attestation。
///         ACL 设计：仅授权合约（Escrow/Voting）可写入，天然禁止自评。
contract ReputationHub is Ownable {
    enum Outcome {
        COMPLETED,            // 交易完成
        SELLER_DEFAULTED,     // 卖方违约（超时未交付）
        BUYER_WON_DISPUTE,    // 仲裁买家胜诉（含部分胜诉记作买家胜）
        SELLER_WON_DISPUTE    // 仲裁卖家胜诉
    }

    struct AgentReputation {
        uint256 tradesCompleted;   // 完成交易数
        uint256 tradesDefaulted;   // 违约数（卖方）
        uint256 disputesWon;       // 争议胜诉数
        uint256 disputesLost;      // 争议败诉数
    }

    mapping(uint256 => AgentReputation) public reputation;
    mapping(address => bool) public authorizedCallers;

    event OutcomeRecorded(uint256 indexed agentId, Outcome outcome);
    event CallerAuthorized(address indexed caller, bool authorized);

    constructor() Ownable(msg.sender) {}

    /// 配置可信写入方（仅 owner；应为 Escrow/Voting 合约地址）
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit CallerAuthorized(caller, authorized);
    }

    /// 记录一次交易/裁决结果（仅授权调用方）
    function recordOutcome(uint256 agentId, Outcome outcome) external {
        require(authorizedCallers[msg.sender], "ReputationHub: 未授权调用方");

        AgentReputation storage rep = reputation[agentId];
        if (outcome == Outcome.COMPLETED) {
            rep.tradesCompleted++;
        } else if (outcome == Outcome.SELLER_DEFAULTED) {
            rep.tradesDefaulted++;
        } else if (outcome == Outcome.BUYER_WON_DISPUTE) {
            rep.disputesWon++;
        } else {
            rep.disputesLost++;
        }

        emit OutcomeRecorded(agentId, outcome);
    }

    /// 便捷查询：信誉分（0-100，链下计算所需原始数据由 reputation() 提供）
    function reputationScore(uint256 agentId) external view returns (uint256 score) {
        AgentReputation storage rep = reputation[agentId];
        uint256 total = rep.tradesCompleted + rep.tradesDefaulted + rep.disputesWon + rep.disputesLost;
        if (total == 0) return 50; // 新智能体默认 50（需担保人担保才能接单）
        score = 100 - (100 * rep.tradesDefaulted) / total - (50 * rep.disputesLost) / total;
        if (score > 100) score = 100;
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd contracts && forge test --match-contract ReputationHubTest -vvv`
Expected: 5 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add contracts/src/ReputationHub.sol contracts/test/ReputationHub.t.sol && git commit -m "feat(contracts): ReputationHub 信誉记录中心"
```

---

### Task 5: GuaranteeEscrow —— 担保托管交易

**Files:**
- Test: `contracts/test/GuaranteeEscrow.t.sol`
- Create: `contracts/src/GuaranteeEscrow.sol`

**职责**：交易状态机（CREATED→FUNDED→GUARANTEED→DELIVERED→RELEASED/DISPUTED→RESOLVED），担保人质押+保费，违约罚没，超时默认动作。权限：buyer/seller 的 owner（责任主体）驱动各自动作。

**状态机**（规格 §6）：
```
CREATED ─买家付款─▶ FUNDED ─担保人质押─▶ GUARANTEED ─卖家交付声明─▶ DELIVERED
  │超时取消            │退款           │                            │
  └─── 买家确认 ──────────────▶ RELEASED（卖家收款，担保人拿回本金+保费）
  └─── 争议 ──────────────▶ DISPUTED ──resolveDispute──▶ RESOLVED
```

- [ ] **Step 1: 写失败测试**

`contracts/test/GuaranteeEscrow.t.sol`：
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";

contract GuaranteeEscrowTest is Test {
    AgentRegistry registry;
    ReputationHub hub;
    GuaranteeEscrow escrow;

    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address guarantor = makeAddr("guarantor");
    address stranger = makeAddr("stranger");

    uint256 buyerAgentId;
    uint256 sellerAgentId;
    uint256 tradeId;

    uint256 constant AMOUNT = 1 ether;
    uint256 constant COVERAGE = 1e18; // 100%

    function setUp() public {
        registry = new AgentRegistry();
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        hub.setAuthorizedCaller(address(escrow), true);

        vm.prank(buyer);
        buyerAgentId = registry.registerAgent("BuyerAgent", "买家", "x");
        vm.prank(seller);
        sellerAgentId = registry.registerAgent("SellerAgent", "卖家", "x");

        vm.prank(buyer);
        tradeId = escrow.createTrade(buyerAgentId, sellerAgentId, AMOUNT);
    }

    function test_fullHappyPath() public {
        // 买家付款
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        assertEq(uint8(escrow.trades(tradeId).state), uint8(GuaranteeEscrow.State.FUNDED));

        // 担保人质押（100% 覆盖率 + 5% 保费）
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);
        assertEq(uint8(escrow.trades(tradeId).state), uint8(GuaranteeEscrow.State.GUARANTEED));

        // 卖家交付声明
        vm.prank(seller);
        escrow.deliver(tradeId);
        assertEq(uint8(escrow.trades(tradeId).state), uint8(GuaranteeEscrow.State.DELIVERED));

        // 买家确认 → 释放：卖家得 AMOUNT，担保人拿回本金+保费
        uint256 sellerBefore = seller.balance;
        uint256 guarantorBefore = guarantor.balance;
        vm.prank(buyer);
        escrow.confirm(tradeId);

        assertEq(uint8(escrow.trades(tradeId).state), uint8(GuaranteeEscrow.State.RELEASED));
        assertEq(seller.balance - sellerBefore, AMOUNT, "卖家应收到交易金额");
        assertEq(guarantor.balance - guarantorBefore, 1.05 ether, "担保人应拿回本金+保费");
    }

    function test_buyerDispute_guarantorPenalty() public {
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);
        vm.prank(seller);
        escrow.deliver(tradeId);

        // 买家发起争议
        vm.prank(buyer);
        escrow.dispute(tradeId);
        assertEq(uint8(escrow.trades(tradeId).state), uint8(GuaranteeEscrow.State.DISPUTED));

        // 平台仲裁：买家胜诉 → 全额退款 + 担保金罚没补偿买家
        uint256 buyerBefore = buyer.balance;
        vm.prank(escrow.owner());
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.BUYER_WINS, 10000);

        assertEq(escrow.trades(tradeId).state, GuaranteeEscrow.State.RESOLVED);
        assertEq(buyer.balance - buyerBefore, AMOUNT + AMOUNT, "买家拿回本金+全额罚没担保金");
        // 信誉记录：卖家违约
        (,, uint256 defaulted,) = hub.reputation(sellerAgentId);
        assertEq(defaulted, 1);
    }

    function test_sellerTimeout_autoRelease() public {
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);
        vm.prank(seller);
        escrow.deliver(tradeId);

        // 买家超时未确认 → 自动释放给卖家
        vm.warp(block.timestamp + escrow.CONFIRM_WINDOW() + 1);
        vm.prank(stranger); // 任何人可触发超时
        escrow.timeoutAutoRelease(tradeId);

        assertEq(escrow.trades(tradeId).state, GuaranteeEscrow.State.RELEASED);
        assertEq(seller.balance, AMOUNT);
    }

    function test_fundDeadline_refund() public {
        // 买家付款后不担保，fund 截止时间到 → 退款
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);

        vm.warp(block.timestamp + escrow.FUND_WINDOW() + 1);
        uint256 buyerBefore = buyer.balance;
        vm.prank(stranger);
        escrow.timeoutRefund(tradeId);

        assertEq(escrow.trades(tradeId).state, GuaranteeEscrow.State.RESOLVED);
        assertEq(buyer.balance - buyerBefore, AMOUNT, "买家应收回付款");
    }

    function test_sellerDefault_timeoutRefund() public {
        // 卖家 GUARANTEED 后不交付，交付超时 → 退款 + 担保金罚没 + 违约记录
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);

        vm.warp(block.timestamp + escrow.DELIVER_WINDOW() + 1);
        vm.prank(stranger);
        escrow.timeoutRefund(tradeId);

        assertEq(buyer.balance, AMOUNT + AMOUNT, "退款+罚没担保金");
        (,, uint256 defaulted,) = hub.reputation(sellerAgentId);
        assertEq(defaulted, 1);
    }

    function test_permissions() public {
        // 非卖家 owner 不能交付
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);

        vm.prank(stranger);
        vm.expectRevert("GuaranteeEscrow: 仅卖家负责人可交付");
        escrow.deliver(tradeId);
    }

    function test_guarantee_requiresEnoughStake() public {
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);

        vm.prank(guarantor);
        vm.expectRevert("GuaranteeEscrow: 担保质押金额不符");
        escrow.guarantee{value: 0.5 ether}(tradeId, COVERAGE, 0.05 ether);
    }

    function test_partialVerdict() public {
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, COVERAGE, 0.05 ether);
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute(tradeId);

        // 部分胜诉：买家拿 70%
        uint256 buyerBefore = buyer.balance;
        uint256 sellerBefore = seller.balance;
        vm.prank(escrow.owner());
        escrow.resolveDispute(tradeId, GuaranteeEscrow.Verdict.PARTIAL_BUYER, 7000);

        assertEq(buyer.balance - buyerBefore, (AMOUNT * 70) / 100 + AMOUNT, "70% 退款 + 全额罚没");
        assertEq(seller.balance - sellerBefore, (AMOUNT * 30) / 100, "卖家得 30%");
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd contracts && forge test --match-contract GuaranteeEscrowTest -vvv`
Expected: FAIL（找不到 GuaranteeEscrow 合约）

- [ ] **Step 3: 实现合约**

`contracts/src/GuaranteeEscrow.sol`：
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {ReputationHub} from "./ReputationHub.sol";

/// @title GuaranteeEscrow —— 担保托管交易
/// @notice 交易状态机 + 担保人质押 + 违约罚没 + 超时默认动作。
///         权限模型：buyer/seller 动作仅其责任主体（agent owner）可执行。
///         MVP 仲裁：仅 owner（平台）可调用 resolveDispute；论文版由 SchellingVoting 驱动。
contract GuaranteeEscrow is Ownable, ReentrancyGuard {
    enum State { CREATED, FUNDED, GUARANTEED, DELIVERED, DISPUTED, RELEASED, RESOLVED }
    enum Verdict { BUYER_WINS, SELLER_WINS, PARTIAL_BUYER }

    struct Trade {
        uint256 id;
        uint256 buyerAgentId;
        uint256 sellerAgentId;
        uint256 amount;      // 交易金额（wei）
        address guarantor;   // 担保人（0 地址=无担保）
        uint256 coverage;    // 覆盖率（1e18 = 100%）
        uint256 premium;     // 保费（担保人报价）
        State state;
        uint256 createdAt;
        uint256 fundedAt;
        uint256 guaranteedAt;
        uint256 deliveredAt;
    }

    uint256 public constant FUND_WINDOW = 1 days;      // 付款截止
    uint256 public constant GUARANTEE_WINDOW = 1 days; // 担保截止（FUNDED 起）
    uint256 public constant DELIVER_WINDOW = 1 days;   // 交付截止（GUARANTEED 起）
    uint256 public constant CONFIRM_WINDOW = 1 days;   // 确认截止（DELIVERED 起）

    AgentRegistry public immutable registry;
    ReputationHub public immutable hub;
    uint256 public nextTradeId;
    mapping(uint256 => Trade) public trades;

    event TradeCreated(uint256 indexed tradeId, uint256 buyerAgentId, uint256 sellerAgentId, uint256 amount);
    event TradeFunded(uint256 indexed tradeId, address funder);
    event TradeGuaranteed(uint256 indexed tradeId, address guarantor, uint256 coverage, uint256 premium);
    event TradeDelivered(uint256 indexed tradeId);
    event TradeConfirmed(uint256 indexed tradeId);
    event TradeDisputed(uint256 indexed tradeId);
    event TradeResolved(uint256 indexed tradeId, Verdict verdict, uint256 buyerShareBps);

    constructor(address registry_, address hub_) Ownable(msg.sender) {
        registry = AgentRegistry(registry_);
        hub = ReputationHub(hub_);
    }

    /// 创建交易（买方发起）
    function createTrade(uint256 buyerAgentId, uint256 sellerAgentId, uint256 amount)
        external returns (uint256 tradeId)
    {
        require(amount > 0, "GuaranteeEscrow: 金额必须大于零");
        tradeId = nextTradeId++;
        trades[tradeId] = Trade(tradeId, buyerAgentId, sellerAgentId, amount, address(0), 0, 0, State.CREATED, block.timestamp, 0, 0, 0);
        emit TradeCreated(tradeId, buyerAgentId, sellerAgentId, amount);
    }

    /// 买家付款进 escrow
    function fund(uint256 tradeId) external payable nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.CREATED, "GuaranteeEscrow: 状态错误");
        require(msg.value == t.amount, "GuaranteeEscrow: 付款金额与交易金额不符");
        require(block.timestamp <= t.createdAt + FUND_WINDOW, "GuaranteeEscrow: 付款超时");
        t.state = State.FUNDED;
        t.fundedAt = block.timestamp;
        emit TradeFunded(tradeId, msg.sender);
    }

    /// 担保人质押：覆盖率×金额 + 报价保费
    function guarantee(uint256 tradeId, uint256 coverage, uint256 premium) external payable nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.FUNDED, "GuaranteeEscrow: 状态错误");
        require(coverage > 0 && coverage <= 2e18, "GuaranteeEscrow: 覆盖率需在 0-200%");
        require(block.timestamp <= t.fundedAt + GUARANTEE_WINDOW, "GuaranteeEscrow: 担保超时");
        uint256 requiredStake = (t.amount * coverage) / 1e18;
        require(msg.value == requiredStake + premium, "GuaranteeEscrow: 担保质押金额不符");

        t.guarantor = msg.sender;
        t.coverage = coverage;
        t.premium = premium;
        t.state = State.GUARANTEED;
        t.guaranteedAt = block.timestamp;
        emit TradeGuaranteed(tradeId, msg.sender, coverage, premium);
    }

    /// 卖家交付声明（仅卖家负责人）
    function deliver(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.GUARANTEED, "GuaranteeEscrow: 状态错误");
        require(registry.ownerOf(t.sellerAgentId) == msg.sender, "GuaranteeEscrow: 仅卖家负责人可交付");
        require(block.timestamp <= t.guaranteedAt + DELIVER_WINDOW, "GuaranteeEscrow: 交付超时");
        t.state = State.DELIVERED;
        t.deliveredAt = block.timestamp;
        emit TradeDelivered(tradeId);
    }

    /// 买家确认收货（仅买家负责人）→ 释放：卖家收款，担保人拿回本金+保费
    function confirm(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.DELIVERED, "GuaranteeEscrow: 状态错误");
        require(registry.ownerOf(t.buyerAgentId) == msg.sender, "GuaranteeEscrow: 仅买家负责人可确认");
        require(block.timestamp <= t.deliveredAt + CONFIRM_WINDOW, "GuaranteeEscrow: 确认超时，请走超时释放");

        _release(t, Verdict.BUYER_WINS, 0); // verdict 仅作事件标记
        hub.recordOutcome(t.sellerAgentId, ReputationHub.Outcome.COMPLETED);
        emit TradeConfirmed(tradeId);
    }

    /// 买家/卖家发起争议（双方负责人均可）
    function dispute(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.DELIVERED, "GuaranteeEscrow: 仅交付后可争议");
        address buyerOwner = registry.ownerOf(t.buyerAgentId);
        address sellerOwner = registry.ownerOf(t.sellerAgentId);
        require(msg.sender == buyerOwner || msg.sender == sellerOwner, "GuaranteeEscrow: 仅交易双方负责人可发起争议");
        t.state = State.DISPUTED;
        emit TradeDisputed(tradeId);
    }

    /// 仲裁裁决（MVP：仅平台 owner；论文版由 SchellingVoting 调用）
    /// buyerShareBps: 部分胜诉时买家所得比例（0-10000）；全额胜诉时忽略
    function resolveDispute(uint256 tradeId, Verdict verdict, uint256 buyerShareBps) external onlyOwner nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.DISPUTED, "GuaranteeEscrow: 仅争议中可裁决");

        if (verdict == Verdict.BUYER_WINS) {
            _resolveBuyerWins(t, 10000);
        } else if (verdict == Verdict.PARTIAL_BUYER) {
            require(buyerShareBps <= 10000, "GuaranteeEscrow: 比例非法");
            _resolveBuyerWins(t, buyerShareBps);
        } else {
            // 卖家胜诉：全额放给卖家，担保人拿回本金+保费
            uint256 stake = (t.amount * t.coverage) / 1e18;
            _pay(t.guarantor, stake + t.premium);
            _pay(registry.ownerOf(t.sellerAgentId), t.amount);
            t.state = State.RESOLVED;
            hub.recordOutcome(t.sellerAgentId, ReputationHub.Outcome.SELLER_WON_DISPUTE);
        }
        emit TradeResolved(tradeId, verdict, buyerShareBps);
    }

    /// 交付后买家超时未确认 → 自动释放（任何人可触发）
    function timeoutAutoRelease(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.DELIVERED, "GuaranteeEscrow: 状态错误");
        require(block.timestamp > t.deliveredAt + CONFIRM_WINDOW, "GuaranteeEscrow: 未到超时时间");
        _release(t, Verdict.BUYER_WINS, 0);
        hub.recordOutcome(t.sellerAgentId, ReputationHub.Outcome.COMPLETED);
    }

    /// 退款路径（任一超时/卖家未交付/担保未达成）→ 买家收回金额，违约时罚没担保金
    function timeoutRefund(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        require(t.state == State.FUNDED || t.state == State.GUARANTEED, "GuaranteeEscrow: 状态错误");

        if (t.state == State.FUNDED) {
            require(block.timestamp > t.fundedAt + GUARANTEE_WINDOW, "GuaranteeEscrow: 未到担保截止");
            _pay(registry.ownerOf(t.buyerAgentId), t.amount);
            t.state = State.RESOLVED;
        } else {
            require(block.timestamp > t.guaranteedAt + DELIVER_WINDOW, "GuaranteeEscrow: 未到交付截止");
            _resolveBuyerWins(t, 10000); // 卖家违约：退款+罚没
            hub.recordOutcome(t.sellerAgentId, ReputationHub.Outcome.SELLER_DEFAULTED);
        }
    }

    // ---------- 内部 ----------

    /// 买家胜诉结算：买家拿回本金 + 担保金罚没补偿；担保人失去质押、拿回保费
    function _resolveBuyerWins(Trade storage t, uint256 buyerShareBps) private {
        uint256 stake = (t.amount * t.coverage) / 1e18;
        uint256 buyerRefund = (t.amount * buyerShareBps) / 10000;
        uint256 sellerShare = t.amount - buyerRefund;
        _pay(registry.ownerOf(t.buyerAgentId), buyerRefund + stake);
        if (sellerShare > 0) _pay(registry.ownerOf(t.sellerAgentId), sellerShare);
        _pay(t.guarantor, t.premium); // 担保人只拿回保费（服务费），本金罚没
        t.state = State.RESOLVED;
    }

    /// 正常释放：卖家收款 + 担保人拿回本金和保费
    function _release(Trade storage t, Verdict verdict, uint256 buyerShareBps) private {
        uint256 stake = (t.amount * t.coverage) / 1e18;
        _pay(registry.ownerOf(t.sellerAgentId), t.amount);
        _pay(t.guarantor, stake + t.premium);
        t.state = State.RELEASED;
        emit TradeResolved(t.id, verdict, buyerShareBps);
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "GuaranteeEscrow: 转账失败");
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd contracts && forge test --match-contract GuaranteeEscrowTest -vvv`
Expected: 9 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add contracts/src/GuaranteeEscrow.sol contracts/test/GuaranteeEscrow.t.sol && git commit -m "feat(contracts): GuaranteeEscrow 担保托管交易状态机"
```

---

### Task 6: SchellingVoting —— 争议质押投票

**Files:**
- Test: `contracts/test/SchellingVoting.t.sol`
- Create: `contracts/src/SchellingVoting.sol`

**职责**：争议案的社区质押投票（Schelling 收敛）。任意地址可投（MVP 简化：不做随机抽选，论文版补 ZK 抽选），质押 `stake` 后投 {BUYER/SELLER/ABSTAIN}；投票窗口结束后 `settle()`：多数方 ≥2/3 且有效票 ≥3 → 裁决，少数派质押罚没均分给多数派；不足法定数 → 作废，质押全部退还，Escrow 走保守默认（买家胜）。裁决结果驱动 Escrow.resolveDispute + ReputationHub.recordOutcome。

- [ ] **Step 1: 写失败测试**

`contracts/test/SchellingVoting.t.sol`：
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

contract SchellingVotingTest is Test {
    AgentRegistry registry;
    ReputationHub hub;
    GuaranteeEscrow escrow;
    SchellingVoting voting;

    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address guarantor = makeAddr("guarantor");
    address juror1 = makeAddr("juror1");
    address juror2 = makeAddr("juror2");
    address juror3 = makeAddr("juror3");
    address juror4 = makeAddr("juror4");
    address juror5 = makeAddr("juror5");

    uint256 buyerAgentId;
    uint256 sellerAgentId;
    uint256 tradeId;
    uint256 caseId;

    uint256 constant AMOUNT = 1 ether;
    uint256 constant STAKE = 0.1 ether;
    uint256 constant WINDOW = 1 days;

    function _setUpTradeAndDispute() internal {
        registry = new AgentRegistry();
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        voting = new SchellingVoting(address(escrow), address(hub));
        hub.setAuthorizedCaller(address(escrow), true);
        hub.setAuthorizedCaller(address(voting), true);
        escrow.transferOwnership(address(voting)); // 论文版：Voting 代平台行使裁决权

        vm.prank(buyer);
        buyerAgentId = registry.registerAgent("BuyerAgent", "买家", "x");
        vm.prank(seller);
        sellerAgentId = registry.registerAgent("SellerAgent", "卖家", "x");

        vm.prank(buyer);
        tradeId = escrow.createTrade(buyerAgentId, sellerAgentId, AMOUNT);
        vm.prank(buyer);
        escrow.fund{value: AMOUNT}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: AMOUNT + 0.05 ether}(tradeId, 1e18, 0.05 ether);
        vm.prank(seller);
        escrow.deliver(tradeId);
        vm.prank(buyer);
        escrow.dispute(tradeId);

        // openCase 是 Voting 的 onlyOwner：部署者即 Test 合约（this），无需 prank
        caseId = voting.openCase(tradeId, buyerAgentId, sellerAgentId, STAKE, WINDOW);
    }

    function setUp() public {
        _setUpTradeAndDispute();
    }

    function test_openCase() public view {
        assertEq(voting.nextCaseId(), 1);
        SchellingVoting.Case memory c = voting.cases(caseId);
        assertEq(c.tradeId, tradeId);
        assertEq(c.stake, STAKE);
        assertEq(c.settled, false);
    }

    function test_vote_majority2of3_buyerWins() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        // 买家胜：退款+罚没担保金（由 escrow 执行）
        assertEq(escrow.trades(tradeId).state, GuaranteeEscrow.State.RESOLVED);
        assertEq(buyer.balance, AMOUNT + AMOUNT, "买家拿回本金+罚没担保金");
        // 多数派领取：拿回质押 + 均分少数派罚没（1 票罚没 / 2 票均分）
        vm.prank(juror1);
        voting.claimReward(caseId);
        vm.prank(juror2);
        voting.claimReward(caseId);
        assertEq(juror1.balance, STAKE + STAKE / 2, "juror1 拿回质押+罚没奖金");
        assertEq(juror2.balance, STAKE + STAKE / 2);
        assertEq(juror3.balance, 0, "juror3 少数派质押被罚没，不可领取");
        // 信誉记录：卖方争议败诉 +1（第四位 disputesLost）
        (,,, uint256 lost) = hub.reputation(sellerAgentId);
        assertEq(lost, 1);
    }

    function test_vote_insufficientQuorum_refundAll() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        // 有效票 2 < 3 → 作废：质押全部退还（claimRefund），escrow 保守默认买家胜
        vm.prank(juror1);
        voting.claimRefund(caseId);
        vm.prank(juror2);
        voting.claimRefund(caseId);
        assertEq(juror1.balance, STAKE);
        assertEq(juror2.balance, STAKE);
        assertEq(escrow.trades(tradeId).state, GuaranteeEscrow.State.RESOLVED);
        assertEq(buyer.balance, AMOUNT + AMOUNT);
    }

    function test_vote_majorityBelow2of3_refundAndDefault() public {
        // 4 票：2 BUYER / 2 SELLER → 未达 2/3，作废退款，escrow 默认买家胜
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);
        vm.prank(juror4);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        vm.prank(juror1);
        voting.claimRefund(caseId);
        vm.prank(juror3);
        voting.claimRefund(caseId);
        assertEq(juror1.balance, STAKE);
        assertEq(juror3.balance, STAKE);
        assertEq(buyer.balance, AMOUNT + AMOUNT);
    }

    function test_vote_sellerWins() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror1);
        voting.settle(caseId);

        assertEq(escrow.trades(tradeId).state, GuaranteeEscrow.State.RESOLVED);
        assertEq(seller.balance, AMOUNT, "卖家得全额");
        assertEq(guarantor.balance, 1.05 ether, "担保人拿回本金+保费");
        vm.prank(juror1);
        voting.claimReward(caseId);
        vm.prank(juror2);
        voting.claimReward(caseId);
        assertEq(juror1.balance, STAKE + STAKE / 2, "多数派拿回质押+奖金");
        assertEq(juror3.balance, 0, "少数派被罚没，不可领取");
        (,, uint256 won,) = hub.reputation(sellerAgentId); // 第三位 disputesWon
        assertEq(won, 1);
    }

    function test_vote_permissions() public {
        // 一地址只能投一票
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror1);
        vm.expectRevert("SchellingVoting: 已投票");
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);

        // 质押金额不符
        vm.prank(juror2);
        vm.expectRevert("SchellingVoting: 质押金额不符");
        voting.vote{value: STAKE - 1}(caseId, SchellingVoting.Side.BUYER);

        // 窗口结束后不能投票
        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(juror3);
        vm.expectRevert("SchellingVoting: 投票已截止");
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.SELLER);
    }

    function test_settle_onlyAfterDeadline() public {
        vm.prank(juror1);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror2);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(juror3);
        voting.vote{value: STAKE}(caseId, SchellingVoting.Side.BUYER);

        vm.prank(juror1);
        vm.expectRevert("SchellingVoting: 投票窗口未结束");
        voting.settle(caseId);
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd contracts && forge test --match-contract SchellingVotingTest -vvv`
Expected: FAIL（找不到 SchellingVoting 合约）

- [ ] **Step 3: 实现合约**

`contracts/src/SchellingVoting.sol`：
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GuaranteeEscrow} from "./GuaranteeEscrow.sol";
import {ReputationHub} from "./ReputationHub.sol";

/// @title SchellingVoting —— 争议质押投票（Schelling 点收敛）
/// @notice 争议案：任意成员质押投票 {BUYER/SELLER/ABSTAIN}；窗口结束后结算。
///         多数方 ≥2/3 且有效票 ≥3 → 裁决成立：少数派质押罚没均分多数派；
///         不足法定数/未达 2/3 → 作废退款，escrow 保守默认买家胜。
///         MVP 简化：不做随机抽选陪审员（论文版补 ZK 抽选）；先到先得投票。
contract SchellingVoting is Ownable, ReentrancyGuard {
    enum Side { BUYER, SELLER, ABSTAIN }
    uint256 public constant MIN_VOTERS = 3;      // 最低有效票数
    uint256 public constant MAJORITY_BPS = 6500; // ≥2/3 多数判定（工程近似 6500/10000，避免 2/3 边界整除误差；论文版精化）

    struct Case {
        uint256 tradeId;
        uint256 buyerAgentId;
        uint256 sellerAgentId;
        uint256 stake;      // 每票质押
        uint256 deadline;   // 投票截止
        uint256 votesForBuyer;
        uint256 votesForSeller;
        bool settled;
        bool effective;     // 是否达成有效裁决（≥2/3 多数且有效票 ≥3）
        Side winner;        // 有效时：多数方；作废时：ABSTAIN
        mapping(address => bool) hasVoted; // 独立投票标记（避免 enum 初始值冲突）
        mapping(address => Side) side;     // 每人所投方
        mapping(address => bool) claimed;  // 是否已领取（奖励/退款互斥）
    }

    GuaranteeEscrow public immutable escrow;
    ReputationHub public immutable hub;
    uint256 public nextCaseId;
    mapping(uint256 => Case) public cases;

    event CaseOpened(uint256 indexed caseId, uint256 tradeId, uint256 stake, uint256 deadline);
    event CaseVoted(uint256 indexed caseId, address voter, Side side, uint256 stake);
    event CaseSettled(uint256 indexed caseId, Side winningSide, uint256 voters, bool effective);

    constructor(address escrow_, address hub_) Ownable(msg.sender) {
        escrow = GuaranteeEscrow(escrow_);
        hub = ReputationHub(hub_);
    }

    /// 发起争议案（需交易处于 DISPUTED 状态；仅 escrow owner 可开——论文版由 escrow 自动驱动）
    function openCase(uint256 tradeId, uint256 buyerAgentId, uint256 sellerAgentId, uint256 stake, uint256 windowSeconds)
        external onlyOwner returns (uint256 caseId)
    {
        require(stake > 0, "SchellingVoting: 质押必须大于零");
        require(escrow.trades(tradeId).state == GuaranteeEscrow.State.DISPUTED, "SchellingVoting: 交易不在争议中");

        caseId = nextCaseId++;
        Case storage c = cases[caseId];
        c.tradeId = tradeId;
        c.buyerAgentId = buyerAgentId;
        c.sellerAgentId = sellerAgentId;
        c.stake = stake;
        c.deadline = block.timestamp + windowSeconds;

        emit CaseOpened(caseId, tradeId, stake, c.deadline);
    }

    /// 投票：质押 stake 后投一方（窗口内、每地址一票）
    function vote(uint256 caseId, Side side) external payable nonReentrant {
        Case storage c = cases[caseId];
        require(block.timestamp < c.deadline, "SchellingVoting: 投票已截止");
        require(!c.settled, "SchellingVoting: 案件已结算");
        require(!c.hasVoted[msg.sender], "SchellingVoting: 已投票");
        require(msg.value == c.stake, "SchellingVoting: 质押金额不符");

        c.hasVoted[msg.sender] = true;
        c.side[msg.sender] = side;
        if (side == Side.BUYER) c.votesForBuyer++;
        else if (side == Side.SELLER) c.votesForSeller++;
        // ABSTAIN 不参与多数判定（质押在结算时凭 claimRefund 退还）

        emit CaseVoted(caseId, msg.sender, side, msg.value);
    }

    /// 结算（窗口结束后任何人可触发）
    function settle(uint256 caseId) external nonReentrant {
        Case storage c = cases[caseId];
        require(!c.settled, "SchellingVoting: 已结算");
        require(block.timestamp >= c.deadline, "SchellingVoting: 投票窗口未结束");

        c.settled = true;
        uint256 total = c.votesForBuyer + c.votesForSeller;
        bool buyerMaj = c.votesForBuyer * 10000 >= total * MAJORITY_BPS;
        bool sellerMaj = c.votesForSeller * 10000 >= total * MAJORITY_BPS;
        c.effective = total >= MIN_VOTERS && (buyerMaj || sellerMaj);
        c.winner = buyerMaj ? Side.BUYER : (sellerMaj ? Side.SELLER : Side.ABSTAIN);

        if (!c.effective) {
            // 作废：所有投票者凭 claimRefund 领回质押；escrow 保守默认买家胜（退款+罚没担保金）
            _applyVerdict(c, GuaranteeEscrow.Verdict.BUYER_WINS, 10000);
        } else if (c.winner == Side.BUYER) {
            _applyVerdict(c, GuaranteeEscrow.Verdict.BUYER_WINS, 10000);
        } else {
            _applyVerdict(c, GuaranteeEscrow.Verdict.SELLER_WINS, 0);
        }

        emit CaseSettled(caseId, c.winner, total, c.effective);
    }

    /// 领取奖励（有效案的多数派：拿回质押 + 均分少数派罚没）
    function claimReward(uint256 caseId) external nonReentrant {
        Case storage c = cases[caseId];
        require(c.settled, "SchellingVoting: 未结算");
        require(c.effective, "SchellingVoting: 案件作废，请领取退款");
        require(c.hasVoted[msg.sender] && c.side[msg.sender] == c.winner, "SchellingVoting: 非多数派");
        require(!c.claimed[msg.sender], "SchellingVoting: 已领取");

        uint256 winnerCount = c.winner == Side.BUYER ? c.votesForBuyer : c.votesForSeller;
        uint256 loserCount = c.winner == Side.BUYER ? c.votesForSeller : c.votesForBuyer;
        c.claimed[msg.sender] = true;
        // 多数派每票：本金 + 罚没池均分（罚没池 = 少数派票数 × stake）
        uint256 reward = c.stake + (c.stake * loserCount) / winnerCount;
        _pay(msg.sender, reward);
    }

    /// 领取退款（作废案的全部投票者 / 有效案的弃权票）
    function claimRefund(uint256 caseId) external nonReentrant {
        Case storage c = cases[caseId];
        require(c.settled, "SchellingVoting: 未结算");
        require(c.hasVoted[msg.sender], "SchellingVoting: 未投票");
        require(!c.claimed[msg.sender], "SchellingVoting: 已领取");
        require(!c.effective || c.side[msg.sender] == Side.ABSTAIN, "SchellingVoting: 有效案仅弃权票可退款");

        c.claimed[msg.sender] = true;
        _pay(msg.sender, c.stake);
    }

    // ---------- 内部 ----------

    function _applyVerdict(Case storage c, GuaranteeEscrow.Verdict verdict, uint256 share) private {
        // 论文版语义：Voting 拥有 escrow（部署脚本 transferOwnership），可驱动裁决；
        // 若未授权则 revert（部署脚本已保证授权，见 Task 13）
        escrow.resolveDispute(c.tradeId, verdict, share);
        if (verdict == GuaranteeEscrow.Verdict.BUYER_WINS) {
            hub.recordOutcome(c.sellerAgentId, ReputationHub.Outcome.BUYER_WON_DISPUTE);
        } else {
            hub.recordOutcome(c.sellerAgentId, ReputationHub.Outcome.SELLER_WON_DISPUTE);
        }
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "SchellingVoting: 转账失败");
    }
}
```

> **MVP 诚实说明（同步写入 DEMO.md）**：`claimReward`/`claimRefund` 采用"凭据领取制"（投票者自己触发领取），避免 EVM 无界遍历的 gas 问题；罚没池均分按少数派票数份简化（论文版改为按比例/merkle 批量结算）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd contracts && forge test -vvv`
Expected: 全部测试 PASS（含前面任务，共 ~25 个）。测试断言与领取函数已对齐（juror1/juror2 通过 `claimReward` 领取本金+奖金；作废案通过 `claimRefund` 领回质押）。

> 若 Step 3 的领取实现与测试断言不完全匹配（如测试直接断言 `juror1.balance == STAKE + STAKE/2` 需在测试中先调用 `claimReward`），请同步修正测试：在断言前调用对应领取函数。

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add contracts/src/SchellingVoting.sol contracts/test/SchellingVoting.t.sol && git commit -m "feat(contracts): SchellingVoting 争议质押投票"
```

---

### Task 7: E2E 全链路集成测试（= 演示基线）

**Files:**
- Create: `contracts/test/E2E.t.sol`

**职责**：完整业务故事：注册两智能体 → 创建交易 → 担保 → 交付 → 争议 → 社区投票 → 罚没 → 信誉更新 → 复查信誉分。此测试即 M3 演示的自动化基线。

- [ ] **Step 1: 写集成测试**

`contracts/test/E2E.t.sol`：
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

/// @title E2E —— 全链路业务故事（= M3 演示脚本的自动化基线）
contract E2ETest is Test {
    AgentRegistry registry;
    ReputationHub hub;
    GuaranteeEscrow escrow;
    SchellingVoting voting;

    address alice = makeAddr("alice");   // 数据服务商（卖方）
    address bob = makeAddr("bob");       // 买方开发者
    address guarantor = makeAddr("guarantor");
    address j1 = makeAddr("j1");
    address j2 = makeAddr("j2");
    address j3 = makeAddr("j3");

    function setUp() public {
        registry = new AgentRegistry();
        hub = new ReputationHub();
        escrow = new GuaranteeEscrow(address(registry), address(hub));
        voting = new SchellingVoting(address(escrow), address(hub));
        hub.setAuthorizedCaller(address(escrow), true);
        hub.setAuthorizedCaller(address(voting), true);
        escrow.transferOwnership(address(voting));
    }

    function test_fullStory_dispute_communityVerdict() public {
        // 1. 注册：两个智能体（责任主体 = 注册开发者）
        vm.prank(alice);
        uint256 sellerId = registry.registerAgent("DataAgent", "链上数据分析服务", "https://a.example/mcp");
        vm.prank(bob);
        uint256 buyerId = registry.registerAgent("TraderAgent", "交易策略智能体", "https://b.example/mcp");

        // 2. 创建担保交易：bob 的智能体购买 alice 的智能体服务
        vm.prank(bob);
        uint256 tradeId = escrow.createTrade(buyerId, sellerId, 2 ether);

        // 3. 付款 + 担保（担保人质押 100% + 5% 保费）
        vm.prank(bob);
        escrow.fund{value: 2 ether}(tradeId);
        vm.prank(guarantor);
        escrow.guarantee{value: 2.1 ether}(tradeId, 1e18, 0.1 ether);

        // 4. 卖方交付声明
        vm.prank(alice);
        escrow.deliver(tradeId);

        // 5. 买方发起争议（声称服务与描述不符）
        vm.prank(bob);
        escrow.dispute(tradeId);

        // 6. 社区投票：Schelling 收敛 —— 3 票支持买家（事实：服务确实不符）
        // openCase 为 Voting 的 onlyOwner（部署者 = Test 合约），无需 prank
        uint256 caseId = voting.openCase(tradeId, buyerId, sellerId, 0.05 ether, 1 days);
        vm.prank(j1);
        voting.vote{value: 0.05 ether}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(j2);
        voting.vote{value: 0.05 ether}(caseId, SchellingVoting.Side.BUYER);
        vm.prank(j3);
        voting.vote{value: 0.05 ether}(caseId, SchellingVoting.Side.SELLER);

        // 7. 结算：买家胜
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(j1);
        voting.settle(caseId);

        // 8. 结果断言：买家拿回 2 ETH + 2 ETH 罚没担保金；卖家 0；担保人拿回保费 0.1
        assertEq(escrow.trades(tradeId).state, GuaranteeEscrow.State.RESOLVED);
        assertEq(bob.balance, 4 ether);
        assertEq(alice.balance, 0);
        assertEq(guarantor.balance, 0.1 ether);
        assertEq(escrow.trades(tradeId).state, GuaranteeEscrow.State.RESOLVED);

        // 9. 信誉更新：卖家无超时违约（走争议路径），争议败诉 1 次 → 信誉分下降
        (uint256 completed, uint256 defaulted, uint256 won, uint256 lost) = hub.reputation(sellerId);
        assertEq(defaulted, 0);
        assertEq(lost, 1, "卖家争议败诉应 +1");
        assertEq(won, 0);
        uint256 score = hub.reputationScore(sellerId);
        assertLt(score, 50, "败诉卖家信誉分应低于新智能体默认 50");

        // 10. 正常交易仍记录完成（对照组：另一笔无争议交易）
        vm.prank(bob);
        uint256 trade2 = escrow.createTrade(buyerId, sellerId, 1 ether);
        vm.prank(bob);
        escrow.fund{value: 1 ether}(trade2);
        vm.prank(guarantor);
        escrow.guarantee{value: 1.05 ether}(trade2, 1e18, 0.05 ether);
        vm.prank(alice);
        escrow.deliver(trade2);
        vm.prank(bob);
        escrow.confirm(trade2);

        (uint256 completed2,,,) = hub.reputation(sellerId);
        assertEq(completed2, 1, "正常交易应累计完成数");
    }
}
```

- [ ] **Step 2: 运行确认通过**

Run: `cd contracts && forge test -vvv`
Expected: 全部 PASS（含 E2E）

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add contracts/test/E2E.t.sol && git commit -m "feat(contracts): E2E 全链路集成测试"
```

---

## Phase 2：前端（开发者门户）

### Task 8: 前端基建 —— wagmi 配置 + ABI + 连接层

**Files:**
- Create: `frontend/lib/wagmi.ts`
- Create: `frontend/lib/abi.ts`
- Modify: `frontend/app/layout.tsx`
- Create: `frontend/app/page.tsx`

- [ ] **Step 1: 从 forge artifacts 生成 ABI**

```bash
cd contracts && forge build
cd "C:/Users/21560/Desktop/blockchain" && node -e "
const fs = require('fs');
const names = ['AgentRegistry','ReputationHub','GuaranteeEscrow','SchellingVoting'];
let out = '// 自动生成：contracts/out/*.sol/*.json —— 合约变更后重新生成\n';
for (const n of names) {
  const art = JSON.parse(fs.readFileSync('contracts/out/'+n+'.sol/'+n+'.json','utf8'));
  out += 'export const '+n.toLowerCase()+'Abi = '+JSON.stringify(art.abi, null, 2)+' as const;\n\n';
}
fs.writeFileSync('frontend/lib/abi.ts', out);
"
```

Expected: `frontend/lib/abi.ts` 生成，含四个合约 ABI。

- [ ] **Step 2: wagmi 客户端**

`frontend/lib/wagmi.ts`：
```typescript
"use client";
import { createConfig, http } from "wagmi";
import { baseSepolia } from "./config";

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  transports: { [baseSepolia.id]: http() },
});
```

- [ ] **Step 3: Provider + 布局**

`frontend/app/layout.tsx`（整体替换）：
```typescript
import type { Metadata } from "next";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentTrust · 智能体互信协议",
  description: "为智能体间商务提供身份注册、交易担保与信誉裁决",
};

const queryClient = new QueryClient();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <nav className="p-4 border-b flex gap-4">
              <a href="/" className="font-bold">AgentTrust</a>
              <a href="/agents">智能体</a>
              <a href="/trade">交易</a>
              <a href="/disputes">争议</a>
              <a href="/reputation">信誉</a>
            </nav>
            {children}
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: 首页**

`frontend/app/page.tsx`：
```typescript
import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">AgentTrust · 智能体互信协议</h1>
      <p className="mb-6 text-gray-600">
        给智能体发身份、为交易担保、让社区裁决争议——智能体间商务的可信基础设施（Base Sepolia 测试网）。
      </p>
      <div className="grid grid-cols-2 gap-4">
        {[
          { href: "/agents", title: "注册智能体", desc: "铸造 Agent ID，绑定责任主体" },
          { href: "/trade", title: "发起担保交易", desc: "付款进 escrow，担保人质押担保" },
          { href: "/disputes", title: "争议裁决", desc: "社区质押投票，Schelling 收敛" },
          { href: "/reputation", title: "信誉档案", desc: "交易记录与仲裁结果" },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="border rounded-lg p-4 hover:bg-gray-50">
            <div className="font-semibold">{c.title}</div>
            <div className="text-sm text-gray-500 mt-1">{c.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 5: 构建验证 + Commit**

```bash
cd frontend && npm run build
```
Expected: 构建成功。

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add frontend && git commit -m "feat(frontend): 门户基建（wagmi/ABI/布局/首页）"
```

---

### Task 9: 智能体注册页

**Files:**
- Create: `frontend/app/agents/page.tsx`

**职责**：连接钱包 → 表单（名称/描述/endpoint）→ 调 `registerAgent`（付注册费）→ 展示已注册智能体（`agentCount` + `agents(tokenId)`）。

- [ ] **Step 1: 实现注册页**

`frontend/app/agents/page.tsx`：
```typescript
"use client";
import { useState } from "react";
import { useAccount, useConnect, useWriteContract, useReadContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { agentRegistryAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/lib/config";
import { parseEther, formatEther } from "viem";

export default function AgentsPage() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContract } = useWriteContract();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [fee, setFee] = useState("0");

  useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "registrationFee",
    onSuccess: (v) => setFee(formatEther(v as bigint)),
  });

  const { data: agentCount } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "agentCount",
  });

  function register() {
    if (!name || !desc || !endpoint) return alert("请填写完整信息");
    writeContract({
      address: CONTRACT_ADDRESSES.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "registerAgent",
      args: [name, desc, endpoint],
      value: parseEther(fee),
    });
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">智能体注册</h1>
      {!isConnected && (
        <button className="border px-4 py-2 rounded" onClick={() => connect({ connector: injected() })}>
          连接钱包
        </button>
      )}
      {isConnected && (
        <>
          <p className="text-sm text-gray-500 mb-4">当前责任主体：{address}</p>
          <div className="space-y-3">
            <input placeholder="智能体名称（如 DataAgent）" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border rounded p-2" />
            <input placeholder="能力描述（如：链上数据分析服务）" value={desc} onChange={(e) => setDesc(e.target.value)}
              className="w-full border rounded p-2" />
            <input placeholder="MCP/A2A 端点（https://…）" value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
              className="w-full border rounded p-2" />
            <button onClick={register} className="bg-blue-600 text-white px-4 py-2 rounded">
              注册（注册费 {fee} ETH）
            </button>
          </div>
          <h2 className="text-xl font-semibold mt-8 mb-2">已注册智能体（{String(agentCount ?? 0)}）</h2>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: 构建验证 + Commit**

```bash
cd frontend && npm run build
```
Expected: 构建成功。

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add frontend/app/agents && git commit -m "feat(frontend): 智能体注册页"
```

---

### Task 10: 交易操作台

**Files:**
- Create: `frontend/app/trade/page.tsx`

**职责**：创建交易（输入买卖 agentId + 金额）→ 付款 → 担保（覆盖率+保费）→ 交付 → 确认。分步骤表单，按当前交易状态展示可用操作。

- [ ] **Step 1: 实现交易页**

`frontend/app/trade/page.tsx`：
```typescript
"use client";
import { useState } from "react";
import { useAccount, useConnect, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { guaranteeEscrowAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/lib/config";
import { parseEther } from "viem";

const STATE_LABEL = ["已创建", "已付款", "已担保", "已交付", "争议中", "已释放", "已结算"];

export default function TradePage() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContract } = useWriteContract();

  const [buyerId, setBuyerId] = useState("0");
  const [sellerId, setSellerId] = useState("1");
  const [amount, setAmount] = useState("0.1");
  const [tradeId, setTradeId] = useState("");
  const [coverage, setCoverage] = useState("100");
  const [premium, setPremium] = useState("0.005");

  function create() {
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "createTrade",
      args: [BigInt(buyerId), BigInt(sellerId), parseEther(amount)],
    });
  }
  function fund() {
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "fund",
      args: [BigInt(tradeId)],
      value: parseEther(amount),
    });
  }
  function guarantee() {
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "guarantee",
      args: [BigInt(tradeId), parseEther(coverage), parseEther(premium)],
      value: parseEther((Number(amount) * Number(coverage) / 100 + Number(premium)).toFixed(6)),
    });
  }
  function deliver() {
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "deliver",
      args: [BigInt(tradeId)],
    });
  }
  function confirm() {
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "confirm",
      args: [BigInt(tradeId)],
    });
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">担保交易</h1>
      {!isConnected && (
        <button className="border px-4 py-2 rounded" onClick={() => connect({ connector: injected() })}>连接钱包</button>
      )}
      {isConnected && (
        <div className="space-y-4">
          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">创建交易（买方发起）</h2>
            <input placeholder="买家 Agent ID" value={buyerId} onChange={(e) => setBuyerId(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <input placeholder="卖家 Agent ID" value={sellerId} onChange={(e) => setSellerId(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <input placeholder="交易金额（ETH）" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <button onClick={create} className="bg-blue-600 text-white px-4 py-2 rounded">创建交易</button>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">交易流程（按状态操作）</h2>
            <input placeholder="Trade ID" value={tradeId} onChange={(e) => setTradeId(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <div className="flex gap-2 flex-wrap">
              <button onClick={fund} className="border px-3 py-1.5 rounded">① 付款（{amount} ETH）</button>
              <button onClick={guarantee} className="border px-3 py-1.5 rounded">② 担保（质押 {coverage}%）</button>
              <input placeholder="保费 ETH" value={premium} onChange={(e) => setPremium(e.target.value)} className="border rounded p-1.5 w-28" />
              <button onClick={deliver} className="border px-3 py-1.5 rounded">③ 交付（卖家）</button>
              <button onClick={confirm} className="border px-3 py-1.5 rounded">④ 确认（买家）</button>
            </div>
            <p className="text-xs text-gray-400 mt-2">状态：{STATE_LABEL.join(" → ")}（超时默认动作见 DEMO.md）</p>
          </section>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: 构建验证 + Commit**

```bash
cd frontend && npm run build
```
Expected: 构建成功。

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add frontend/app/trade && git commit -m "feat(frontend): 交易操作台"
```

---

### Task 11: 争议与投票页

**Files:**
- Create: `frontend/app/disputes/page.tsx`

**职责**：发起争议（`dispute`）、开设投票案（`openCase`）、投票（`vote`）、结算（`settle`）、领取奖励/退款（`claimReward`/`claimRefund`）。MVP 简化：caseId 手动输入。

- [ ] **Step 1: 实现争议页**

`frontend/app/disputes/page.tsx`：
```typescript
"use client";
import { useState } from "react";
import { useAccount, useConnect, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { guaranteeEscrowAbi, schellingVotingAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/lib/config";
import { parseEther } from "viem";

export default function DisputesPage() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContract } = useWriteContract();

  const [tradeId, setTradeId] = useState("");
  const [buyerId, setBuyerId] = useState("0");
  const [sellerId, setSellerId] = useState("1");
  const [caseId, setCaseId] = useState("");
  const [stake, setStake] = useState("0.05");

  function openDispute() {
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "dispute",
      args: [BigInt(tradeId)],
    });
  }
  function openCase() {
    writeContract({
      address: CONTRACT_ADDRESSES.schellingVoting,
      abi: schellingVotingAbi,
      functionName: "openCase",
      args: [BigInt(tradeId), BigInt(buyerId), BigInt(sellerId), parseEther(stake), 86400n],
    });
  }
  function vote(side: 0 | 1) {
    writeContract({
      address: CONTRACT_ADDRESSES.schellingVoting,
      abi: schellingVotingAbi,
      functionName: "vote",
      args: [BigInt(caseId), side],
      value: parseEther(stake),
    });
  }
  function settle() {
    writeContract({
      address: CONTRACT_ADDRESSES.schellingVoting,
      abi: schellingVotingAbi,
      functionName: "settle",
      args: [BigInt(caseId)],
    });
  }
  function claim(kind: "reward" | "refund") {
    writeContract({
      address: CONTRACT_ADDRESSES.schellingVoting,
      abi: schellingVotingAbi,
      functionName: kind === "reward" ? "claimReward" : "claimRefund",
      args: [BigInt(caseId)],
    });
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">争议与裁决</h1>
      {!isConnected && (
        <button className="border px-4 py-2 rounded" onClick={() => connect({ connector: injected() })}>连接钱包</button>
      )}
      {isConnected && (
        <div className="space-y-4">
          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">发起争议（交易双方）</h2>
            <input placeholder="Trade ID" value={tradeId} onChange={(e) => setTradeId(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <button onClick={openDispute} className="bg-orange-600 text-white px-4 py-2 rounded">发起争议</button>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">开设投票案（平台）</h2>
            <input placeholder="Trade ID" value={tradeId} onChange={(e) => setTradeId(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <input placeholder="买家 Agent ID" value={buyerId} onChange={(e) => setBuyerId(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <input placeholder="卖家 Agent ID" value={sellerId} onChange={(e) => setSellerId(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <button onClick={openCase} className="bg-blue-600 text-white px-4 py-2 rounded">开设投票案（窗口 1 天）</button>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">社区投票（Schelling 收敛）</h2>
            <input placeholder="Case ID" value={caseId} onChange={(e) => setCaseId(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <input placeholder="质押（ETH）" value={stake} onChange={(e) => setStake(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <div className="flex gap-2">
              <button onClick={() => vote(0)} className="bg-green-600 text-white px-4 py-2 rounded">支持买家</button>
              <button onClick={() => vote(1)} className="bg-red-600 text-white px-4 py-2 rounded">支持卖家</button>
              <button onClick={settle} className="bg-gray-700 text-white px-4 py-2 rounded">结算（窗口结束后）</button>
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => claim("reward")} className="border px-4 py-2 rounded">领取奖励（多数派）</button>
              <button onClick={() => claim("refund")} className="border px-4 py-2 rounded">领取退款（作废/弃权）</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: 构建验证 + Commit**

```bash
cd frontend && npm run build
```
Expected: 构建成功。

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add frontend/app/disputes && git commit -m "feat(frontend): 争议与投票页"
```

---

### Task 12: 信誉仪表盘

**Files:**
- Create: `frontend/app/reputation/page.tsx`

**职责**：输入 Agent ID → 读取 `reputation`（完成/违约/胜诉/败诉）+ `reputationScore`，展示多维档案与得分。

- [ ] **Step 1: 实现仪表盘**

`frontend/app/reputation/page.tsx`：
```typescript
"use client";
import { useState } from "react";
import { useReadContract } from "wagmi";
import { reputationHubAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/lib/config";

export default function ReputationPage() {
  const [agentId, setAgentId] = useState("0");

  const { data: rep } = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputation",
    args: [BigInt(agentId)],
  });
  const { data: score } = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputationScore",
    args: [BigInt(agentId)],
  });

  const [completed, defaulted, won, lost] = (rep as [bigint, bigint, bigint, bigint]) ?? [0n, 0n, 0n, 0n];

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">信誉档案</h1>
      <input placeholder="Agent ID" value={agentId} onChange={(e) => setAgentId(e.target.value)}
        className="w-full border rounded p-2 mb-4" />

      <div className="border rounded p-4 mb-4 text-center">
        <div className="text-5xl font-bold">{String(score ?? 0)}</div>
        <div className="text-gray-500 mt-1">信誉分（0-100，新智能体默认 50）</div>
      </div>

      <div className="grid grid-cols-4 gap-3 text-center">
        {[
          ["完成交易", completed],
          ["违约次数", defaulted],
          ["争议胜诉", won],
          ["争议败诉", lost],
        ].map(([label, v]) => (
          <div key={label as string} className="border rounded p-3">
            <div className="text-2xl font-semibold">{String(v as bigint)}</div>
            <div className="text-xs text-gray-500 mt-1">{label as string}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-4">
        数据来源：ReputationHub 链上记录（attestation 式存证，不可篡改）。新智能体默认 50 分，需担保人担保才能承接高价值订单。
      </p>
    </main>
  );
}
```

- [ ] **Step 2: 构建验证 + Commit**

```bash
cd frontend && npm run build
```
Expected: 构建成功。

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add frontend/app/reputation && git commit -m "feat(frontend): 信誉仪表盘"
```

---

## Phase 3：部署与演示

### Task 13: 部署脚本 + Base Sepolia 部署

**Files:**
- Create: `contracts/script/Deploy.s.sol`
- Modify: `frontend/lib/config.ts`（填入真实地址）

- [ ] **Step 1: 写部署脚本**

`contracts/script/Deploy.s.sol`：
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ReputationHub} from "../src/ReputationHub.sol";
import {GuaranteeEscrow} from "../src/GuaranteeEscrow.sol";
import {SchellingVoting} from "../src/SchellingVoting.sol";

/// @notice 部署顺序：Registry → Hub → Escrow → Voting；随后授权与所有权移交。
///         所有权移交：escrow.transferOwnership(voting) 使社区裁决可驱动 escrow（论文版语义）。
contract Deploy is Script {
    function run() external returns (address, address, address, address) {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);

        AgentRegistry registry = new AgentRegistry();
        ReputationHub hub = new ReputationHub();
        GuaranteeEscrow escrow = new GuaranteeEscrow(address(registry), address(hub));
        SchellingVoting voting = new SchellingVoting(address(escrow), address(hub));

        hub.setAuthorizedCaller(address(escrow), true);
        hub.setAuthorizedCaller(address(voting), true);
        escrow.transferOwnership(address(voting)); // 社区裁决驱动 escrow

        vm.stopBroadcast();

        return (address(registry), address(hub), address(escrow), address(voting));
    }
}
```

- [ ] **Step 2: 部署到 Base Sepolia**

```bash
cd contracts && forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast --verify
```
Expected: 输出四个合约地址；浏览器验证通过。

> 前置条件：部署钱包需有 Base Sepolia ETH（faucet：https://faucet.quicknode.com/base/sepolia 或 https://www.alchemy.com/faucets/base-sepolia）。将 `PRIVATE_KEY` 写入环境变量（不提交到 git）。

- [ ] **Step 3: 填入前端配置**

`frontend/lib/config.ts` 中 `CONTRACT_ADDRESSES` 四个地址替换为部署输出。

- [ ] **Step 4: 设置注册费（可选）**

```bash
cast send <AGENT_REGISTRY_ADDR> "setRegistrationFee(uint256)" 0 --rpc-url https://sepolia.base.org --private-key $PRIVATE_KEY
```
（MVP 演示期注册费设 0，降低试用门槛；论文版上线前恢复质押门槛）

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add contracts/script/Deploy.s.sol frontend/lib/config.ts && git commit -m "feat: Base Sepolia 部署脚本与地址配置"
```

---

### Task 14: 全链路演示手册

**Files:**
- Create: `contracts/demo/DEMO.md`

**职责**：一步步可复现的全链路演示（对应 E2E.t.sol 的业务故事），供学期答辩/社区上线演示。

- [ ] **Step 1: 写 DEMO.md**

`contracts/demo/DEMO.md`：
```markdown
# AgentTrust 全链路演示手册（Base Sepolia）

> 前置：浏览器安装 MetaMask 并切到 Base Sepolia（https://chainlist.org 搜 Base Sepolia）；两个开发者钱包（A=卖家方、B=买方）各领测试 ETH；本地 `npm run dev` 启动门户（frontend/）。

## 演示流程（5 分钟版）

1. **注册智能体**（钱包 A）
   - 门户 → 智能体 → 连接钱包 A → 注册 "DataAgent"（描述：链上数据分析服务）
   - 记录返回的 Agent ID（设为 0）
2. **注册买方智能体**（钱包 B）
   - 连接钱包 B → 注册 "TraderAgent"（Agent ID = 1）
3. **创建担保交易**（钱包 B）
   - 交易页 → 买家 Agent ID=1、卖家 Agent ID=0、金额 0.1 ETH → 创建 → ① 付款
4. **担保人担保**（演示账户或钱包 A/B 之一，需有 0.1+ ETH）
   - ② 担保：覆盖率 100%、保费 0.005 ETH → 质押
5. **交付与确认**（钱包 A → ③ 交付；钱包 B → ④ 确认）
   - 浏览器观察：卖家收款 0.1 ETH，担保人拿回本金+保费
6. **争议演示**（复现违约场景）
   - 再建一笔交易 → 交付 → 买家发起争议 → 争议页开设投票案（窗口 1 天，可用 cast 缩短到 1 分钟验证）
   - 三个演示钱包各投票（2 票支持买家、1 票支持卖家）→ 结算 → 观察罚没与退款
7. **信誉变化**（信誉页）
   - 输入卖家 Agent ID：违约 +1、败诉 +1、信誉分从 50 降至 <50

## 快速验证（不用前端）

```bash
# 部署 + 全链路（本地测试网等价物）
cd contracts && forge test --match-contract E2ETest -vvv
```

## 机制说明（给观众的话术）
- 担保人质押 = 智能体保险的诚实形态：违约自动罚没
- Schelling 投票 = 社区说真话的激励：与多数一致者拿回质押+奖金，少数派被罚
- 信誉 = 链上 attestation：不可篡改、禁止自评、供担保准入定价
```

- [ ] **Step 2: Commit**

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add contracts/demo/DEMO.md && git commit -m "docs: 全链路演示手册"
```

---

### Task 15: 根 README + 仓库收尾

**Files:**
- Create: `README.md`
- Modify: `contracts/README.md`（可选，Foundry 模板替换）

- [ ] **Step 1: 写根 README**

`README.md`：
```markdown
# AgentTrust · 智能体互信协议

为智能体间商务提供**身份注册、交易担保、争议裁决、信誉记录**的可信基础设施（区块链方案，Base Sepolia 测试网）。

## 背景
智能体时代到来，智能体代替人类交易需要解决互信问题。本项目以区块链智能合约实现：身份（ERC-721 Agent ID + 责任主体绑定）、担保（escrow 质押 + 违约罚没）、裁决（Schelling 点社区质押投票）、信誉（链上 attestation，不可篡改、禁止自评）。设计对齐行业标准 ERC-8004（Trustless Agents）。

## 仓库结构
| 目录 | 说明 |
|---|---|
| `contracts/` | Solidity 合约（Foundry）：AgentRegistry / GuaranteeEscrow / SchellingVoting / ReputationHub |
| `contracts/demo/DEMO.md` | 全链路演示手册 |
| `frontend/` | 开发者门户（Next.js + wagmi） |
| `papers/` | 调研论文库（30 篇，见 papers/README.md） |
| `docs/` | 设计规格与实现计划 |

## 快速开始
```bash
# 合约测试
cd contracts && forge test -vvv

# 前端（需先部署并填 frontend/lib/config.ts 地址）
cd frontend && npm install && npm run dev
```

## 合规说明
MVP 使用测试网代币模拟质押/罚没（无真实价值）。境内不发行任何可交易代币/凭证；担保责任由真实主体（agent owner）承担；智能体无民事主体资格，责任归属注册人。长期代币化需海外合规架构（详见设计规格 §8）。

## 论文
Schelling-Point Reputation Communities: A Decentralized Guarantee and Arbitration Layer for Agent-to-Agent Commerce（进行中，见 docs/superpowers/specs/2026-08-08-agenttrust-design.md §10）
```

- [ ] **Step 2: 最终验证 + Commit**

```bash
cd contracts && forge test -vvv && cd ../frontend && npm run build
```
Expected: 全部测试 PASS + 前端构建成功。

```bash
cd "C:/Users/21560/Desktop/blockchain" && git add README.md && git commit -m "docs: 项目 README"
```

---

## 后续（独立计划，不在此计划内）

- **论文计划**（另行编写）：博弈论形式化（诚实均衡定理）、Python mesa 仿真（攻击场景：Sybil/共谋/白洗）、论文写作与投稿
- **生产化增强**（论文版）：EAS 正式集成、Kleros 仲裁、ZK 随机抽选陪审员、merkle 批量结算、事件索引器
