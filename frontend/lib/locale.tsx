"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "agenttrust.locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

const en = {
  language: { switchLabel: "Language", english: "English", chinese: "简体中文" },
  common: {
    agentTrustHome: "AgentTrust home", primaryNav: "Primary navigation", docsAndRepo: "Documentation and repository",
    agents: "Agents", trade: "Trade", disputes: "Disputes", reputation: "Reputation", usageDocs: "Usage docs",
    connectWallet: "Connect wallet", connecting: "Connecting…", loading: "Loading…", unknown: "Unknown", yes: "Yes", no: "No",
    buyer: "Buyer", seller: "Seller", abstain: "Abstain", none: "None", failedToLoad: "Failed to load",
    cancel: "Cancel", close: "Close", back: "Back", save: "Save", saving: "Saving…", saved: "Saved",
    copy: "Copy", copied: "Copied", optional: "Optional", dismiss: "Dismiss", required: "Required",
  },
  metadata: { title: "AgentTrust · AI Agent Trust Protocol", description: "Identity, escrow, and reputation arbitration for commerce between AI agents" },
  home: {
    capabilityIdentity: "Agent identity", capabilityIdentityDesc: "Bind an agent to its responsible subject with an on-chain NFT and establish a verifiable entry point.",
    capabilityEscrow: "Guaranteed trade", capabilityEscrowDesc: "Reduce machine-to-machine trade risk with escrow, guarantee quotes, and slashing.",
    capabilityArbitration: "Dispute arbitration", capabilityArbitrationDesc: "Use commit–reveal Schelling voting for a public, verifiable dispute process.",
    capabilityReputation: "Reputation profile", capabilityReputationDesc: "Turn fulfillment and arbitration records into queryable business and juror metrics.",
    graphIdentity: "Identity", graphEscrow: "Escrow", graphVoting: "Arbitration", graphReputation: "Reputation",
    preview: "Research Preview", previewMessage: "Contracts are not deployed on {chain}; on-chain reads and transactions are unavailable.",
    title: "Verifiable trust for AI agents", lead: "AgentTrust combines on-chain identity, guarantee escrow, Schelling arbitration, and reputation records into a trust loop for autonomous-agent commerce.",
    explore: "Explore agents", viewTrade: "View trade flow", readDocs: "Read usage docs", overview: "Protocol overview",
    coreContracts: "core contracts", tradeStates: "trade states", verifiable: "on-chain verifiable",
    modulesTitle: "A complete loop from identity to reputation", modulesHint: "Choose a module to enter the research interface",
    trustGraph: "Verifiable trust graph", moduleCount: "04 / modules", protocol: "Protocol", protocolYear: "AI agent trust protocol · 2026", protocolModules: "Protocol modules",
    identityEyebrow: "Identity", escrowEyebrow: "Escrow", arbitrationEyebrow: "Arbitration", reputationEyebrow: "Reputation",
    flowEyebrow: "How it works", flowTitle: "A trade path designed for accountable agents", flowSteps: ["Create agent identity", "Agree and escrow", "Add an eligible guarantor", "Deliver or open a dispute", "Settle and update reputation"],
    rolesEyebrow: "Roles", rolesTitle: "Different powers, explicit responsibilities", roles: ["Buyers and sellers act through registered agent identities.", "PoH experiment participants may serve as guarantors and eligible jurors.", "For identities with a PoH/nullifier anchor, all guardians approve the deployed recovery fallback and the original wallet retains a veto window."],
    levelsEyebrow: "Identity layers", levelsTitle: "Start ordinary; add assurance only when needed", levels: ["Account session: sign in without changing on-chain identity.", "Agent registration: public responsibility anchor for trading.", "PoH experiment: anti-Sybil signal for privileged protocol roles—not legal identity or real-name verification."],
    recoveryEyebrow: "Safety and recovery", recoveryTitle: "Recovery is constrained, not automatic", recoveryBody: "Ordinary identities without a PoH/nullifier anchor cannot be recovered by the current contract if their private key is lost. Anchored identities use all configured guardians plus a 48-hour veto window, subject to contract state and unsettled obligations.",
    testnetTitle: "Unaudited testnet research software", testnetBody: "Contracts, authentication, and identity experiments are not production-ready. Use test funds only, verify every wallet prompt, and do not rely on AgentTrust for legal identity, custody, or guaranteed recovery.",
  },
  app: { footer: "AgentTrust · AI Agent Trust Protocol" },
  auth: { login: "Sign in", logout: "Sign out", status: "Authentication status", signedIn: "Signed in", checking: "Checking session…", redirectingCanonical: "Authentication API unavailable. Redirecting to agenttrust.site…", accessEyebrow: "Secure workspace access", title: "Sign in to AgentTrust", subtitle: "Authentication protects the workspace session. Wallet connection remains a separate control for on-chain transactions.", loginOptions: "Sign-in options", recommended: "Recommended", walletTitle: "Wallet account", walletDescription: "Connect and sign a one-time SIWE challenge. The Auth BFF creates the session; no session token is stored in browser storage.", signing: "Waiting for signature…", signWallet: "Sign in with connected wallet", connectAndSign: "Connect wallet and sign in", walletMissing: "No wallet account is available.", loginFailed: "Sign-in failed.", continueCanonical: "Continue on agenttrust.site", configuring: "Configuring", availableSoon: "Available soon", strongIdentityTitle: "Strong identity registration", strongIdentityPlaceholder: "Planned. No government-ID or real-name verification is currently offered.", planned: "Planned", labs: "Labs", worldIdLabs: "World ID is an experimental Proof-of-Humanity signal for anti-Sybil role gates. It is not real-name verification and does not establish legal identity.", continueWith: "Continue", redirecting: "Redirecting…", walletUnavailable: "Wallet SIWE login is not available on this Auth BFF.", walletGate: "Wallet binding", walletLinkTitle: "Bind a transaction wallet", walletLinkBody: "This social account has no wallet binding. Connect the wallet you will use for AgentTrust writes, then sign a fresh one-time link challenge.", walletMismatchTitle: "Connected wallet does not match", walletMismatchBody: "The connected wallet differs from this account’s binding. Disconnect it and switch to the already bound wallet. Wallet replacement is not available in this version.", boundWallet: "Bound wallet", connectedWallet: "Connected wallet", linkWallet: "Bind this wallet", matchWallet: "Match this wallet", walletLinkFailed: "Wallet binding failed.", benefitSession: "Server-managed session via the Auth BFF", benefitWallet: "SIWE binds the session to the signed wallet", benefitSeparate: "Authentication and transaction wallet status stay distinct" },
  poh: { checking: "Checking Proof-of-Humanity eligibility.", unavailable: "Could not verify Proof-of-Humanity eligibility; privileged action is blocked.", requiredGuarantor: "A confirmed PoH experiment status is required to offer guarantees.", requiredJuror: "A confirmed PoH experiment status is required to join a new jury. Existing jurors can still reveal, claim, and finalize obligations." },
  wallet: {
    status: "Wallet status", currentAccount: "Current account", accountValue: "Current account {address}", accountUnknown: "Current account unknown",
    currentNetwork: "Current network", switchTo: "Switch/add {chain}", switching: "Switching…", disconnect: "Disconnect",
    networkError: "Network error: {chain} is required (Chain ID {chainId}).",
  },
  transaction: {
    reverted: "The transaction was mined but reverted.", submitting: "Waiting for wallet confirmation…", confirming: "Transaction submitted; waiting for on-chain confirmation…",
    success: "Transaction confirmed.", failed: "Transaction failed.", hash: "Transaction hash:", block: "Block:",
  },
  write: {
    notConfigured: "Contracts are not configured; transactions cannot be submitted.", notConnected: "Connect a wallet first.", wrongChain: "Switch to the network configured for this app.",
    busy: "The previous transaction is still being processed.", unauthorized: "The current account is not authorized for this action.", invalidState: "The current on-chain state does not allow this action.", invalidInput: "Check and complete all required inputs.",
  },
  config: { unsupportedChain: "Unsupported NEXT_PUBLIC_CHAIN: {value}", writesDisabled: "Contracts are not deployed on {chain}; all write operations are disabled." },
  pages: {
    tradeTitle: "Guaranteed trade lifecycle", tradeSubtitle: "Creation, acceptance, escrow, guarantees, delivery, confirmation, timeouts, and withdrawals follow on-chain state and responsible subjects.",
    disputesTitle: "Disputes and arbitration", disputesSubtitle: "Commit–reveal voting; use the wallet bar above to connect or switch networks.", reload: "Reload on-chain state",
    reputationTitle: "Reputation profiles", reputationSubtitle: "Turn fulfillment and arbitration records into queryable business reputation and juror metrics.",
    reputationIdentity: "On-chain identity", responsibleSubject: "Responsible subject", nftOwner: "Current NFT owner", identityNote: "An ordinary NFT transfer does not change the responsible subject. Only approved Proof-of-Humanity recovery migrates the responsible subject while preserving the Agent ID and its full history.",
  },
  reputation: {
    contractsMissing: "Reputation contracts are not fully deployed on the current network; queries are disabled.", agentId: "Agent ID", enterId: "Enter an Agent ID to view reputation", invalidId: "Enter a valid Agent ID (a non-negative integer)",
    noAgents: "This agent does not exist (no agents are registered)", outOfRange: "This agent does not exist ({count} agents registered; ID range 0–{lastId})", readFailed: "Read failed", agentHeading: "Agent #{id}",
    score: "Reputation score (0–100; new agents start at 50)", completedTrades: "Completed trades", defaults: "Defaults", disputesWon: "Disputes won", disputesLost: "Disputes lost",
    jurorHeading: "Juror reputation of the responsible subject", eligible: "Currently juror-eligible", ineligible: "Currently not juror-eligible", finalizedCases: "Finalized cases", revealedVotes: "Revealed votes", abstentions: "Abstentions", revealRate: "Reveal rate", consensusSamples: "Consensus samples", consensusAlignment: "Consensus alignment",
    consensusNote: "Consensus alignment means a vote matched the majority in an effective case; it does not prove objective truth or correctness.", source: "Source: immutable ReputationHub on-chain attestations. New agents start at 50 and need a guarantor for high-value orders.",
  },
  agents: {
    title: "Agent registration", subtitle: "Register an ordinary on-chain agent identity first. Deposits become withdrawable only after eligible deregistration; they are not guaranteed to remain fully recoverable.",
    registryMissing: "AgentRegistry is not deployed on the current network; reads and registration are disabled.", wrongNetwork: "Network error: switch to {chain} (Chain ID {chainId}).", currentSubject: "Current responsible subject: {address}",
    name: "Agent name (e.g. DataAgent)", description: "Capability description (e.g. on-chain data analysis)", endpoint: "MCP/A2A endpoint (https://…)",
    guardian1: "Guardian 1 (required, emergency contact address)", guardian1Aria: "Guardian 1 (required)", guardian2: "Guardian 2 (required)", guardian3: "Guardian 3 (optional)", optionalAddress: "0x… (optional)",
    verifiedMode: "Register with World ID Proof of Humanity", verifiedModeHelp: "Labs: add the experimental World ID PoH signal for protocol role eligibility (not real-name verification; standard deposit)",
    nullifier: "World ID nullifier (0x… 64 hex digits)", nullifierAria: "World ID nullifier (0x… 64 digits)", proof: "Humanity proof (hex; use 0x01 on testnet)", proofAria: "Humanity proof (hex)",
    depositHelp: "Ordinary and PoH registration both use the on-chain registrationDeposit. Funds remain locked while active and become withdrawable only after eligible deregistration. PoH is an optional Labs role-gating experiment, not real-name verification.",
    registering: "Registering…", registerDeposit: "Register (lock {amount} ETH; conditional return)", guardiansRequired: "Enter at least two guardians (emergency contacts).", guardianInvalid: "A guardian address is invalid.", guardianSelf: "You cannot be your own guardian.", guardianDuplicate: "Guardian addresses must be unique.",
    depositLoading: "The registration deposit has not loaded.", completeInfo: "Complete all required information.", validWorldId: "Enter a valid World ID nullifier and non-empty proof.",
    registered: "Registration succeeded. New Agent ID: {id}.", missingEvent: "The transaction was confirmed, but no AgentRegistered event was found in the receipt.",
    identity: "My community identity", status: "Status:", active: "Active", deregistered: "Deregistered", poh: "Human verification:", verified: "Verified (World ID)", unverified: "Unverified", lockedDeposit: "Locked deposit:", pending: "Pending withdrawal:",
    notVerified: "Proof of Humanity (World ID) is not complete", notVerifiedRisk: "This identity cannot use the PoH-gated guardian recovery path or serve as a guarantor or new juror. PoH enables eligibility but does not guarantee recovery.",
    bindNullifier: "Bind nullifier (0x… 64 hex digits; any unused value on testnet)", bindProof: "Bind proof (hex; use 0x01 on testnet)", bindInvalid: "Enter a valid nullifier (64 hex digits) and non-empty proof.", bindButton: "Bind PoH (upgrade to verified identity)", bindSuccess: "Humanity proof bound.",
    activeTrades: "There are unsettled trades (waiting for the counterparty or a timeout).", openVotes: "There are outstanding juror voting obligations.", recoveryBlocks: "A recovery request is in progress; veto it or wait for expiry.", conditions: "Conditions are not met.", deregisterSuccess: "Deregistered; the deposit is now pending withdrawal.", deregister: "Deregister and return deposit", recoveryDeregisterBlock: "A recovery request is in progress; deregistration is unavailable.", walletCheck: "Check the network and wallet state.", withdrawDeposit: "Withdraw pending balance", withdrawSuccess: "Deposit withdrawn.",
    recovery: "Recovery and guardians", recoveryLive: "Recovery in progress: new wallet {wallet} · guardian approvals {approvals} / {required} · path: {path} · executable at {date}", samePersonPath: "same-person proof (24h veto window)", guardianPath: "all-guardian fallback (48h veto window)", all: "all", vetoWarning: "If you have not lost your private key, veto within {hours} hours or the responsible subject will be migrated.", veto: "Veto recovery", vetoSuccess: "Recovery request vetoed.", noRecovery: "There is no recovery request for you. Ordinary identities without a PoH/nullifier anchor cannot start recovery. For anchored identities, the live Base Sepolia adapter uses the guardian fallback only: every configured guardian approves and a 48-hour veto window applies. Recovery remains conditional and is not guaranteed.", approveHelp: "As a guardian, enter the protected subject address and approve its recovery request", protectedAddress: "Protected subject address", approve: "Approve recovery", approveSuccess: "Recovery request approved.",
    worldIdButton: "Verify with World ID", worldIdLoading: "Preparing World ID…", worldIdError: "World ID verification failed", verifierMissing: "World ID verifier is not bound on the registry yet; verified registration, guarantees, and juror claims remain unavailable.",
    registeredAgents: "Registered agents ({count})", noAgents: "No agents yet. Register the first one.",
  },
  agentUi: {
    connectTitle: "Wallet not connected", connectBody: "Connect a wallet to register an agent or manage your on-chain identity.",
    sectionBasics: "Agent profile", sectionBasicsHint: "How other agents discover and reach this agent.",
    sectionGuardians: "Recovery guardians", sectionGuardiansHint: "Guardians can approve recovery if you lose your key.",
    sectionVerification: "Human verification", sectionVerificationHint: "Optional at registration; unlocks recovery, guarantor, and juror roles.",
    depositCard: "Registration deposit", depositCardHint: "Fully refundable when you close the identity.",
    networkCard: "Network", statusCard: "Identity",
    statusNotRegistered: "Not registered", statusActive: "Active", statusClosed: "Closed",
    dangerZone: "Danger zone", dangerZoneHint: "Closing an identity moves the deposit to a pending balance you can withdraw right away.",
    agentOwner: "Responsible subject", agentEndpoint: "Endpoint", refreshList: "Refresh",
    registerSubmit: "Register agent", guardianHint: "At least two guardians are required.",
    overview: "Overview", directory: "Agent directory",
  },
  walletPicker: {
    title: "Connect a wallet", subtitle: "Pick the wallet you want to use. AgentTrust never holds your assets.",
    current: "Connected", detected: "Detected", notDetected: "Not detected",
    browserWallet: "Browser wallet", browserWalletDesc: "Use this browser's default injected provider",
    install: "Install", connecting: "Connecting…", connectingTo: "Connecting to {name}…",
    failure: "Could not connect to {name}. {reason}", rejected: "The connection request was rejected in {name}.",
    noWallets: "No browser wallet was detected. Install MetaMask or Rabby, then reload this page.",
    discoverHint: "Wallets that support EIP-6963 are detected automatically as soon as they are available.",
    switchTitle: "Switch wallet", switchSubtitle: "You are connected with {name}. Choose another wallet to switch.",
    disconnect: "Disconnect wallet", keepConnected: "Stay connected",
    privacy: "AgentTrust only asks for your address and the signatures you approve.",
  },
  account: {
    openMenu: "Account settings", closeMenu: "Close account settings",
    title: "Account",
    profile: "Profile", profileDesc: "Nickname and photo",
    transactions: "Transactions", transactionsDesc: "Activity from this browser",
    deregister: "Close identity", deregisterDesc: "Deregister and reclaim your deposit",
    switchAccount: "Switch account", switchAccountDesc: "Connect a different wallet",
    disconnect: "Disconnect", disconnectDesc: "Sign out of this site",
    nickname: "Nickname", nicknamePlaceholder: "Name this account", nicknameHint: "Shown only in this browser, never on chain.",
    avatar: "Photo", avatarUpload: "Choose photo", avatarRemove: "Remove photo",
    avatarHint: "JPG or PNG up to 4 MB. Stored in this browser only.",
    avatarTooLarge: "That image is larger than 4 MB.", avatarInvalid: "Choose a JPG or PNG image.",
    copyAddress: "Copy address", addressCopied: "Address copied",
    localOnly: "Saved in this browser only",
    deregisterTitle: "Close identity and reclaim deposit",
    deregisterWarning: "This deregisters your agent identity and moves the deposit to a pending balance. You can withdraw it immediately afterwards.",
    deregisterAction: "Deregister", deregistering: "Deregistering…", deregisterDone: "Identity deregistered.",
    withdrawAction: "Reclaim {amount} ETH", withdrawing: "Reclaiming…", withdrawDone: "Deposit reclaimed.",
    deregisterFlowDone: "Identity closed and deposit reclaimed.",
    deregisterRequiresIdentity: "You need an active agent identity before you can close it.",
    deregisterBlocked: "Not available right now: {reason}",
    txEmpty: "No transactions yet", txEmptyHint: "Transactions you send from this browser appear here.",
    txClear: "Clear history", txPending: "Pending", txSuccess: "Confirmed", txFailed: "Failed",
    txView: "View on explorer", txNow: "Just now", txMinutes: "{count}m ago", txHours: "{count}h ago", txDays: "{count}d ago",
    networkSection: "Wallet", switchAccountsHint: "Recent accounts in this browser",
  },
} as const;

type WidenStrings<T> = { [K in keyof T]: T[K] extends string ? string : WidenStrings<T[K]> };
export type Dictionary = WidenStrings<typeof en>;

const zhCN: Dictionary = {
  language: { switchLabel: "语言", english: "English", chinese: "简体中文" },
  common: { agentTrustHome: "AgentTrust 首页", primaryNav: "主要导航", docsAndRepo: "文档与仓库", agents: "智能体", trade: "交易", disputes: "争议", reputation: "信誉", usageDocs: "使用文档", connectWallet: "连接钱包", connecting: "连接中…", loading: "加载中…", unknown: "未知", yes: "是", no: "否", buyer: "买家", seller: "卖家", abstain: "弃权", none: "无", failedToLoad: "加载失败", cancel: "取消", close: "关闭", back: "返回", save: "保存", saving: "保存中…", saved: "已保存", copy: "复制", copied: "已复制", optional: "可选", dismiss: "知道了", required: "必填" },
  metadata: { title: "AgentTrust · 智能体互信协议", description: "为智能体间商务提供身份注册、交易担保与信誉裁决" },
  home: { capabilityIdentity: "智能体身份", capabilityIdentityDesc: "以链上 NFT 绑定智能体与责任主体，建立可验证的参与者入口。", capabilityEscrow: "担保交易", capabilityEscrowDesc: "通过资金托管、担保报价与违约罚没，降低机器间交易风险。", capabilityArbitration: "争议裁决", capabilityArbitrationDesc: "使用 commit–reveal Schelling 投票，让争议处理过程公开可核验。", capabilityReputation: "信誉档案", capabilityReputationDesc: "把履约与裁决记录沉淀为可查询的业务信誉和陪审员指标。", graphIdentity: "身份", graphEscrow: "托管", graphVoting: "裁决", graphReputation: "信誉", preview: "研究预览", previewMessage: "{chain} 合约尚未部署，链上读取与交易操作暂不可用。", title: "为智能体建立可验证的信任", lead: "AgentTrust 用链上身份、担保托管、Schelling 裁决与信誉记录，构成面向自主智能体商务协作的信任闭环。", explore: "探索智能体", viewTrade: "查看交易流程", readDocs: "阅读使用文档", overview: "协议概览", coreContracts: "核心合约", tradeStates: "交易状态", verifiable: "链上可核验", modulesTitle: "从身份到信誉的完整闭环", modulesHint: "选择一个模块进入研究界面", trustGraph: "可验证信任图谱", moduleCount: "04 / 模块", protocol: "协议", protocolYear: "AI 智能体互信协议 · 2026", protocolModules: "协议模块", identityEyebrow: "身份", escrowEyebrow: "托管", arbitrationEyebrow: "裁决", reputationEyebrow: "信誉", flowEyebrow: "运行流程", flowTitle: "为可追责智能体设计的交易路径", flowSteps: ["创建智能体身份", "约定交易并托管资金", "引入具备资格的担保人", "交付或发起争议", "结算并更新信誉"], rolesEyebrow: "参与角色", rolesTitle: "权限不同，责任明确", roles: ["买卖双方通过已注册智能体身份行动。", "PoH 实验参与者可担任担保人或符合条件的陪审员。", "仅对已有 PoH/nullifier 锚点的身份，全部守护人可批准当前部署的找回兜底路径，原钱包保留否决窗口。"], levelsEyebrow: "身份层级", levelsTitle: "先普通使用，按需增加可信信号", levels: ["账户会话：登录工作台，不改变链上身份。", "智能体注册：用于交易的公开责任锚点。", "PoH 实验：特权角色的防女巫信号，不是法律身份或实名认证。"], recoveryEyebrow: "安全与找回", recoveryTitle: "找回受严格约束，并非自动保证", recoveryBody: "普通身份没有 PoH/nullifier 锚点，私钥丢失后当前合约无法找回；已有锚点的身份统一使用全部守护人批准与 48 小时否决窗，并继续受合约状态和未结义务限制。", testnetTitle: "未经审计的测试网研究软件", testnetBody: "合约、认证与身份实验均未达到生产可用状态。仅使用测试资金，逐项核对钱包请求；不要把 AgentTrust 当作法律身份、托管服务或找回保证。" },
  app: { footer: "AgentTrust · 智能体互信协议" },
  auth: { login: "登录", logout: "退出登录", status: "认证状态", signedIn: "已登录", checking: "正在检查会话…", redirectingCanonical: "认证 API 不可用，正在前往 agenttrust.site…", accessEyebrow: "安全访问工作台", title: "登录 AgentTrust", subtitle: "认证用于保护工作台会话；钱包连接是独立的链上交易控制。", loginOptions: "登录方式", recommended: "推荐", walletTitle: "钱包账户", walletDescription: "连接钱包并签署一次性 SIWE 挑战。会话由 Auth BFF 创建，浏览器存储中不保存会话令牌。", signing: "等待签名…", signWallet: "使用已连接钱包登录", connectAndSign: "连接钱包并签名登录", walletMissing: "没有可用的钱包账户。", loginFailed: "登录失败。", continueCanonical: "前往 agenttrust.site 继续", configuring: "配置中", availableSoon: "即将开放", strongIdentityTitle: "强身份注册", strongIdentityPlaceholder: "规划中。当前不提供政府证件核验或实名认证。", planned: "规划中", labs: "Labs 实验室", worldIdLabs: "World ID 是用于防女巫角色门禁的实验性人类证明信号，不是实名认证，也不建立法律身份。", continueWith: "继续登录", redirecting: "正在跳转…", walletUnavailable: "当前 Auth BFF 未开放钱包 SIWE 登录。", walletGate: "钱包绑定", walletLinkTitle: "绑定交易钱包", walletLinkBody: "此社交账户尚未绑定钱包。请连接将用于 AgentTrust 写操作的钱包，并签署新的单次绑定挑战。", walletMismatchTitle: "连接钱包与绑定不一致", walletMismatchBody: "当前连接钱包不同于账户绑定。请断开并切换回已经绑定的钱包；此版本不提供钱包替换功能。", boundWallet: "已绑定钱包", connectedWallet: "当前连接钱包", linkWallet: "绑定此钱包", matchWallet: "匹配此钱包", walletLinkFailed: "钱包绑定失败。", benefitSession: "由 Auth BFF 管理服务器会话", benefitWallet: "SIWE 将会话绑定至签名钱包", benefitSeparate: "认证状态与交易钱包状态保持分离" },
  poh: { checking: "正在检查人类证明确认状态。", unavailable: "无法确认人类证明状态；特权操作已安全阻断。", requiredGuarantor: "提供担保需要已确认的 PoH 实验状态。", requiredJuror: "加入新陪审团需要已确认的 PoH 实验状态；已有陪审员仍可揭示、领取并完成既有义务。" },
  wallet: { status: "钱包状态", currentAccount: "当前账户", accountValue: "当前账户 {address}", accountUnknown: "当前账户未知", currentNetwork: "当前网络", switchTo: "切换/添加 {chain}", switching: "切换中…", disconnect: "断开", networkError: "网络错误：需要 {chain}（Chain ID {chainId}）。" },
  transaction: { reverted: "交易已上链但执行回滚。", submitting: "等待钱包确认…", confirming: "交易已提交，等待链上确认…", success: "交易已确认。", failed: "交易失败。", hash: "交易哈希：", block: "区块：" },
  write: { notConfigured: "合约尚未配置，当前无法提交交易。", notConnected: "请先连接钱包。", wrongChain: "请切换到应用配置的网络。", busy: "上一笔交易仍在处理中。", unauthorized: "当前账户无权执行此操作。", invalidState: "当前链上状态不允许执行此操作。", invalidInput: "请检查并补全有效输入。" },
  config: { unsupportedChain: "不支持的 NEXT_PUBLIC_CHAIN: {value}", writesDisabled: "{chain} 的合约尚未部署，已禁用所有可写操作。" },
  pages: { tradeTitle: "担保交易闭环", tradeSubtitle: "创建、接受、托管、担保、交付、确认、超时与提现均以链上状态和责任主体为准。", disputesTitle: "争议与裁决", disputesSubtitle: "承诺—揭示投票；钱包连接与切链请使用页首钱包栏。", reload: "重新加载链上状态", reputationTitle: "信誉档案", reputationSubtitle: "把履约与裁决记录沉淀为可查询的业务信誉和陪审员指标。", reputationIdentity: "链上身份", responsibleSubject: "责任主体", nftOwner: "当前 NFT 所有者", identityNote: "普通 NFT 转让不会改变责任主体；只有获批的人类证明找回才会迁移责任主体，同时保留 Agent ID 与全部历史记录。" },
  reputation: { contractsMissing: "当前网络尚未完整部署信誉合约，查询已禁用。", agentId: "智能体 ID", enterId: "请输入智能体 ID 以查看信誉", invalidId: "请输入有效的智能体 ID（非负整数）", noAgents: "该智能体不存在（尚无已注册智能体）", outOfRange: "该智能体不存在（已注册 {count} 个智能体；ID 范围为 0–{lastId}）", readFailed: "读取失败", agentHeading: "智能体 #{id}", score: "信誉分（0–100；新智能体初始为 50）", completedTrades: "已完成交易", defaults: "违约", disputesWon: "争议胜诉", disputesLost: "争议败诉", jurorHeading: "责任主体的陪审员信誉", eligible: "当前具备陪审员资格", ineligible: "当前不具备陪审员资格", finalizedCases: "已结案样本", revealedVotes: "已揭示投票", abstentions: "弃权", revealRate: "揭示率", consensusSamples: "共识样本", consensusAlignment: "共识一致率", consensusNote: "共识一致表示某次投票与有效案件的多数意见相符，并不能证明客观真相或正确性。", source: "来源：ReputationHub 的不可变链上证明。新智能体初始信誉分为 50，高价值订单需要担保人。" },
  agents: { title: "智能体注册", subtitle: "优先注册普通链上智能体身份。押金仅在满足注销条件后转为可提取余额，不保证始终可以全额取回。", registryMissing: "当前网络的 AgentRegistry 尚未部署，读取与注册均已禁用。", wrongNetwork: "网络错误：请切换到 {chain}（Chain ID {chainId}）。", currentSubject: "当前责任主体：{address}", name: "智能体名称（如 DataAgent）", description: "能力描述（如：链上数据分析服务）", endpoint: "MCP/A2A 端点（https://…）", guardian1: "守护人 1（必填，紧急联系人地址）", guardian1Aria: "守护人 1（必填）", guardian2: "守护人 2（必填）", guardian3: "守护人 3（可选）", optionalAddress: "0x…（可选）", verifiedMode: "使用 World ID 人类验证注册", verifiedModeHelp: "Labs：添加 World ID PoH 实验信号以获得协议角色资格（不是实名认证；标准押金）", nullifier: "World ID nullifier（0x…64 位十六进制）", nullifierAria: "World ID nullifier（0x…64 位）", proof: "人类证明（hex，测试网可填 0x01 模拟）", proofAria: "人类证明（hex）", depositHelp: "普通注册与 PoH 注册都使用链上 registrationDeposit。资金在身份活跃期间锁定，仅在满足注销条件后可提取。PoH 是可选的 Labs 角色门禁实验，不是实名认证。", registering: "注册中…", registerDeposit: "注册（锁定 {amount} ETH；满足条件后可退）", guardiansRequired: "请填写至少两位守护人（紧急联系人）。", guardianInvalid: "守护人地址格式无效。", guardianSelf: "不能把自己设为守护人。", guardianDuplicate: "守护人地址重复。", depositLoading: "注册押金尚未加载。", completeInfo: "请填写完整信息。", validWorldId: "请填写有效的 World ID nullifier 与非空证明。", registered: "注册成功，新 Agent ID：{id}。", missingEvent: "交易已确认，但回执中未找到 AgentRegistered 事件。", identity: "我的社区身份", status: "状态：", active: "活跃", deregistered: "已注销", poh: "人类验证：", verified: "已验证（World ID）", unverified: "未验证", lockedDeposit: "锁定押金：", pending: "待提取余额：", notVerified: "尚未完成人类验证（World ID）", notVerifiedRisk: "该身份不能使用 PoH 门禁的守护人找回路径，也不能担任担保人或新陪审员。PoH 仅开启资格，不保证找回成功。", bindNullifier: "绑定 nullifier（0x…64 位十六进制，测试网可随意填写未使用值）", bindProof: "绑定证明（hex，测试网可填 0x01 模拟）", bindInvalid: "填写有效的 nullifier（64 位十六进制）与非空证明。", bindButton: "绑定 PoH（升级为已验证身份）", bindSuccess: "已绑定人类证明。", activeTrades: "存在未了结的交易（等待对方操作或超时）。", openVotes: "存在未清结的陪审投票义务。", recoveryBlocks: "有进行中的找回请求，先否决或等待过期。", conditions: "条件未满足。", deregisterSuccess: "已注销，押金已转入待提取余额。", deregister: "注销并退还押金", recoveryDeregisterBlock: "有进行中的找回请求，注销暂不可用。", walletCheck: "请确保网络与钱包状态正确。", withdrawDeposit: "提取待提取余额", withdrawSuccess: "押金已提取。", recovery: "找回与守护", recoveryLive: "找回请求进行中：新钱包 {wallet} · 守护人批准 {approvals} / {required} · 路径：{path} · 可执行时间 {date}", samePersonPath: "同人证明（24h 否决窗）", guardianPath: "全守护人兜底（48h 否决窗）", all: "全部", vetoWarning: "若你并未丢失私钥，请在 {hours} 小时否决窗口内立即否决，否则责任主体将被迁移。", veto: "否决找回", vetoSuccess: "已否决找回请求。", noRecovery: "当前没有针对你的找回请求。普通身份没有 PoH/nullifier 锚点，无法发起找回；已有锚点的身份在 Base Sepolia 仅使用守护人兜底：全部已配置守护人批准，并等待 48 小时否决窗。找回仍受条件限制，不保证一定成功。", approveHelp: "作为守护人：输入被守护人地址并批准其找回请求", protectedAddress: "被守护人地址", approve: "批准找回", approveSuccess: "已批准该找回请求。", worldIdButton: "使用 World ID 验证", worldIdLoading: "正在准备 World ID…", worldIdError: "World ID 验证失败", verifierMissing: "Registry 尚未绑定 World ID 验证器；验证注册、担保人与陪审员资格暂不可用。", registeredAgents: "已注册智能体（{count}）", noAgents: "暂无智能体，注册第一个吧" },
  agentUi: { connectTitle: "钱包未连接", connectBody: "连接钱包后即可注册智能体或管理你的链上身份。", sectionBasics: "智能体资料", sectionBasicsHint: "其他智能体如何发现并访问它。", sectionGuardians: "找回守护人", sectionGuardiansHint: "丢失私钥时由守护人批准找回。", sectionVerification: "人类验证", sectionVerificationHint: "注册时可选；解锁找回、担保人与陪审员资格。", depositCard: "注册押金", depositCardHint: "注销身份时可全额退还。", networkCard: "网络", statusCard: "身份", statusNotRegistered: "未注册", statusActive: "生效中", statusClosed: "已关闭", dangerZone: "危险操作", dangerZoneHint: "注销身份后押金转入待提取余额，你可以立即取出。", agentOwner: "责任主体", agentEndpoint: "端点", refreshList: "刷新", registerSubmit: "注册智能体", guardianHint: "至少需要填写两位守护人。", overview: "概览", directory: "智能体目录" },
  walletPicker: { title: "连接钱包", subtitle: "选择要使用的钱包。AgentTrust 不会托管你的资产。", current: "已连接", detected: "已检测到", notDetected: "未检测到", browserWallet: "浏览器钱包", browserWalletDesc: "使用当前浏览器的默认注入 provider", install: "安装", connecting: "连接中…", connectingTo: "正在连接 {name}…", failure: "无法连接 {name}。{reason}", rejected: "已在 {name} 中取消连接请求。", noWallets: "未检测到浏览器钱包。请先安装 MetaMask 或 Rabby，然后刷新页面。", discoverHint: "支持 EIP-6963 的钱包会在可用时被自动发现。", switchTitle: "切换钱包", switchSubtitle: "当前使用 {name} 连接。选择其他钱包即可切换。", disconnect: "断开钱包连接", keepConnected: "保持连接", privacy: "AgentTrust 只会请求你的地址与你主动批准的签名。" },
  account: { openMenu: "账户设置", closeMenu: "关闭账户设置", title: "账户", profile: "个人资料", profileDesc: "昵称与头像", transactions: "交易记录", transactionsDesc: "本浏览器发起的记录", deregister: "注销身份", deregisterDesc: "注销智能体并取回押金", switchAccount: "切换账户", switchAccountDesc: "连接其他钱包", disconnect: "断开连接", disconnectDesc: "退出本站登录", nickname: "昵称", nicknamePlaceholder: "给这个账户起个名字", nicknameHint: "仅在本浏览器显示，不会上链。", avatar: "头像", avatarUpload: "选择图片", avatarRemove: "移除头像", avatarHint: "支持 JPG / PNG，最大 4 MB，仅保存在本浏览器。", avatarTooLarge: "图片超过 4 MB。", avatarInvalid: "请选择 JPG 或 PNG 图片。", copyAddress: "复制地址", addressCopied: "地址已复制", localOnly: "仅保存在本浏览器", deregisterTitle: "注销身份并取回押金", deregisterWarning: "注销后智能体身份将关闭，押金转入待提取余额，你可以立即取出。", deregisterAction: "注销", deregistering: "注销中…", deregisterDone: "身份已注销。", withdrawAction: "取回 {amount} ETH", withdrawing: "取回中…", withdrawDone: "押金已取回。", deregisterFlowDone: "身份已注销，押金已取回。", deregisterRequiresIdentity: "需要先拥有生效中的智能体身份才能注销。", deregisterBlocked: "暂不可用：{reason}", txEmpty: "暂无交易记录", txEmptyHint: "你在本浏览器发起的交易会显示在这里。", txClear: "清空记录", txPending: "进行中", txSuccess: "已确认", txFailed: "失败", txView: "在区块浏览器查看", txNow: "刚刚", txMinutes: "{count} 分钟前", txHours: "{count} 小时前", txDays: "{count} 天前", networkSection: "钱包", switchAccountsHint: "本浏览器近期使用过的账户" },
};

export const dictionaries: Record<Locale, Dictionary> = { en, "zh-CN": zhCN };

export function formatMessage(template: string, values: Record<string, string | number | bigint> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

type LocaleContextValue = { locale: Locale; dictionary: Dictionary; setLocale: (locale: Locale) => void };
const LocaleContext = createContext<LocaleContextValue>({ locale: DEFAULT_LOCALE, dictionary: dictionaries[DEFAULT_LOCALE], setLocale: (_nextLocale) => { void _nextLocale; } });

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(LOCALE_STORAGE_KEY); } catch { /* keep strict default */ }
    // localStorage is an external source read only after hydration so static HTML remains English.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isLocale(stored)) setLocaleState(stored);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = dictionaries[locale].metadata.title;
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", dictionaries[locale].metadata.description);
  }, [locale]);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* locale still applies for this session */ }
  }, []);
  const value = useMemo(() => ({ locale, dictionary: dictionaries[locale], setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() { return useContext(LocaleContext); }
