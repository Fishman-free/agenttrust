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
  },
  app: { footer: "AgentTrust · AI Agent Trust Protocol" },
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
    title: "Agent registration", subtitle: "Bind an agent to its responsible subject with an on-chain NFT; the deposit is fully refundable. Proof of Humanity (World ID) unlocks recovery, guarantees, and juror eligibility.",
    registryMissing: "AgentRegistry is not deployed on the current network; reads and registration are disabled.", wrongNetwork: "Network error: switch to {chain} (Chain ID {chainId}).", currentSubject: "Current responsible subject: {address}",
    name: "Agent name (e.g. DataAgent)", description: "Capability description (e.g. on-chain data analysis)", endpoint: "MCP/A2A endpoint (https://…)",
    guardian1: "Guardian 1 (required, emergency contact address)", guardian1Aria: "Guardian 1 (required)", guardian2: "Guardian 2 (required)", guardian3: "Guardian 3 (optional)", optionalAddress: "0x… (optional)",
    verifiedMode: "Register with World ID Proof of Humanity", verifiedModeHelp: "Register with World ID Proof of Humanity: unlock recovery, guarantor, and juror eligibility (standard deposit)",
    nullifier: "World ID nullifier (0x… 64 hex digits)", nullifierAria: "World ID nullifier (0x… 64 digits)", proof: "Humanity proof (hex; use 0x01 on testnet)", proofAria: "Humanity proof (hex)",
    depositHelp: "Unverified registration uses the standard deposit but cannot recover an account or serve as guarantor or juror (verification can be added later). The live World ID v4 adapter uses the all-guardian recovery path with a 48-hour veto.",
    registering: "Registering…", registerDeposit: "Register (deposit {amount} ETH, refundable)", guardiansRequired: "Enter at least two guardians (emergency contacts).", guardianInvalid: "A guardian address is invalid.", guardianSelf: "You cannot be your own guardian.", guardianDuplicate: "Guardian addresses must be unique.",
    depositLoading: "The registration deposit has not loaded.", completeInfo: "Complete all required information.", validWorldId: "Enter a valid World ID nullifier and non-empty proof.",
    registered: "Registration succeeded. New Agent ID: {id}.", missingEvent: "The transaction was confirmed, but no AgentRegistered event was found in the receipt.",
    identity: "My community identity", status: "Status:", active: "Active", deregistered: "Deregistered", poh: "Human verification:", verified: "Verified (World ID)", unverified: "Unverified", lockedDeposit: "Locked deposit:", pending: "Pending withdrawal:",
    notVerified: "Proof of Humanity (World ID) is not complete", notVerifiedRisk: "A lost private key cannot be recovered, and this identity cannot serve as a guarantor or juror. Verify to unlock recovery and these roles.",
    bindNullifier: "Bind nullifier (0x… 64 hex digits; any unused value on testnet)", bindProof: "Bind proof (hex; use 0x01 on testnet)", bindInvalid: "Enter a valid nullifier (64 hex digits) and non-empty proof.", bindButton: "Bind PoH (upgrade to verified identity)", bindSuccess: "Humanity proof bound.",
    activeTrades: "There are unsettled trades (waiting for the counterparty or a timeout).", openVotes: "There are outstanding juror voting obligations.", recoveryBlocks: "A recovery request is in progress; veto it or wait for expiry.", conditions: "Conditions are not met.", deregisterSuccess: "Deregistered; the deposit is now pending withdrawal.", deregister: "Deregister and return deposit", recoveryDeregisterBlock: "A recovery request is in progress; deregistration is unavailable.", walletCheck: "Check the network and wallet state.", withdrawDeposit: "Withdraw pending balance", withdrawSuccess: "Deposit withdrawn.",
    recovery: "Recovery and guardians", recoveryLive: "Recovery in progress: new wallet {wallet} · guardian approvals {approvals} / {required} · path: {path} · executable at {date}", samePersonPath: "same-person proof (24h veto window)", guardianPath: "all-guardian fallback (48h veto window)", all: "all", vetoWarning: "If you have not lost your private key, veto within {hours} hours or the responsible subject will be migrated.", veto: "Veto recovery", vetoSuccess: "Recovery request vetoed.", noRecovery: "There is no recovery request for you. If a private key is lost, a new wallet can initiate recovery with same-person World ID proof (via CLI), and guardians approve below; without same-person proof, all guardians must approve and a 48-hour veto window applies.", approveHelp: "As a guardian, enter the protected subject address and approve its recovery request", protectedAddress: "Protected subject address", approve: "Approve recovery", approveSuccess: "Recovery request approved.",
    worldIdButton: "Verify with World ID", worldIdLoading: "Preparing World ID…", worldIdError: "World ID verification failed", verifierMissing: "World ID verifier is not bound on the registry yet; verified registration, guarantees, and juror claims remain unavailable.",
    registeredAgents: "Registered agents ({count})", noAgents: "No agents yet. Register the first one.",
  },
} as const;

type WidenStrings<T> = { [K in keyof T]: T[K] extends string ? string : WidenStrings<T[K]> };
export type Dictionary = WidenStrings<typeof en>;

const zhCN: Dictionary = {
  language: { switchLabel: "语言", english: "English", chinese: "简体中文" },
  common: { agentTrustHome: "AgentTrust 首页", primaryNav: "主要导航", docsAndRepo: "文档与仓库", agents: "智能体", trade: "交易", disputes: "争议", reputation: "信誉", usageDocs: "使用文档", connectWallet: "连接钱包", connecting: "连接中…", loading: "加载中…", unknown: "未知", yes: "是", no: "否", buyer: "买家", seller: "卖家", abstain: "弃权", none: "无", failedToLoad: "加载失败" },
  metadata: { title: "AgentTrust · 智能体互信协议", description: "为智能体间商务提供身份注册、交易担保与信誉裁决" },
  home: { capabilityIdentity: "智能体身份", capabilityIdentityDesc: "以链上 NFT 绑定智能体与责任主体，建立可验证的参与者入口。", capabilityEscrow: "担保交易", capabilityEscrowDesc: "通过资金托管、担保报价与违约罚没，降低机器间交易风险。", capabilityArbitration: "争议裁决", capabilityArbitrationDesc: "使用 commit–reveal Schelling 投票，让争议处理过程公开可核验。", capabilityReputation: "信誉档案", capabilityReputationDesc: "把履约与裁决记录沉淀为可查询的业务信誉和陪审员指标。", graphIdentity: "身份", graphEscrow: "托管", graphVoting: "裁决", graphReputation: "信誉", preview: "研究预览", previewMessage: "{chain} 合约尚未部署，链上读取与交易操作暂不可用。", title: "为智能体建立可验证的信任", lead: "AgentTrust 用链上身份、担保托管、Schelling 裁决与信誉记录，构成面向自主智能体商务协作的信任闭环。", explore: "探索智能体", viewTrade: "查看交易流程", readDocs: "阅读使用文档", overview: "协议概览", coreContracts: "核心合约", tradeStates: "交易状态", verifiable: "链上可核验", modulesTitle: "从身份到信誉的完整闭环", modulesHint: "选择一个模块进入研究界面", trustGraph: "可验证信任图谱", moduleCount: "04 / 模块", protocol: "协议", protocolYear: "AI 智能体互信协议 · 2026", protocolModules: "协议模块", identityEyebrow: "身份", escrowEyebrow: "托管", arbitrationEyebrow: "裁决", reputationEyebrow: "信誉" },
  app: { footer: "AgentTrust · 智能体互信协议" },
  wallet: { status: "钱包状态", currentAccount: "当前账户", accountValue: "当前账户 {address}", accountUnknown: "当前账户未知", currentNetwork: "当前网络", switchTo: "切换/添加 {chain}", switching: "切换中…", disconnect: "断开", networkError: "网络错误：需要 {chain}（Chain ID {chainId}）。" },
  transaction: { reverted: "交易已上链但执行回滚。", submitting: "等待钱包确认…", confirming: "交易已提交，等待链上确认…", success: "交易已确认。", failed: "交易失败。", hash: "交易哈希：", block: "区块：" },
  write: { notConfigured: "合约尚未配置，当前无法提交交易。", notConnected: "请先连接钱包。", wrongChain: "请切换到应用配置的网络。", busy: "上一笔交易仍在处理中。", unauthorized: "当前账户无权执行此操作。", invalidState: "当前链上状态不允许执行此操作。", invalidInput: "请检查并补全有效输入。" },
  config: { unsupportedChain: "不支持的 NEXT_PUBLIC_CHAIN: {value}", writesDisabled: "{chain} 的合约尚未部署，已禁用所有可写操作。" },
  pages: { tradeTitle: "担保交易闭环", tradeSubtitle: "创建、接受、托管、担保、交付、确认、超时与提现均以链上状态和责任主体为准。", disputesTitle: "争议与裁决", disputesSubtitle: "承诺—揭示投票；钱包连接与切链请使用页首钱包栏。", reload: "重新加载链上状态", reputationTitle: "信誉档案", reputationSubtitle: "把履约与裁决记录沉淀为可查询的业务信誉和陪审员指标。", reputationIdentity: "链上身份", responsibleSubject: "责任主体", nftOwner: "当前 NFT 所有者", identityNote: "普通 NFT 转让不会改变责任主体；只有获批的人类证明找回才会迁移责任主体，同时保留 Agent ID 与全部历史记录。" },
  reputation: { contractsMissing: "当前网络尚未完整部署信誉合约，查询已禁用。", agentId: "智能体 ID", enterId: "请输入智能体 ID 以查看信誉", invalidId: "请输入有效的智能体 ID（非负整数）", noAgents: "该智能体不存在（尚无已注册智能体）", outOfRange: "该智能体不存在（已注册 {count} 个智能体；ID 范围为 0–{lastId}）", readFailed: "读取失败", agentHeading: "智能体 #{id}", score: "信誉分（0–100；新智能体初始为 50）", completedTrades: "已完成交易", defaults: "违约", disputesWon: "争议胜诉", disputesLost: "争议败诉", jurorHeading: "责任主体的陪审员信誉", eligible: "当前具备陪审员资格", ineligible: "当前不具备陪审员资格", finalizedCases: "已结案样本", revealedVotes: "已揭示投票", abstentions: "弃权", revealRate: "揭示率", consensusSamples: "共识样本", consensusAlignment: "共识一致率", consensusNote: "共识一致表示某次投票与有效案件的多数意见相符，并不能证明客观真相或正确性。", source: "来源：ReputationHub 的不可变链上证明。新智能体初始信誉分为 50，高价值订单需要担保人。" },
  agents: { title: "智能体注册", subtitle: "以链上 NFT 绑定智能体与责任主体；押金可全额退还。人类验证（World ID）解锁找回、担保与陪审能力。", registryMissing: "当前网络的 AgentRegistry 尚未部署，读取与注册均已禁用。", wrongNetwork: "网络错误：请切换到 {chain}（Chain ID {chainId}）。", currentSubject: "当前责任主体：{address}", name: "智能体名称（如 DataAgent）", description: "能力描述（如：链上数据分析服务）", endpoint: "MCP/A2A 端点（https://…）", guardian1: "守护人 1（必填，紧急联系人地址）", guardian1Aria: "守护人 1（必填）", guardian2: "守护人 2（必填）", guardian3: "守护人 3（可选）", optionalAddress: "0x…（可选）", verifiedMode: "使用 World ID 人类验证注册", verifiedModeHelp: "使用 World ID 人类验证注册：解锁找回、担保人、陪审员资格（标准押金）", nullifier: "World ID nullifier（0x…64 位十六进制）", nullifierAria: "World ID nullifier（0x…64 位）", proof: "人类证明（hex，测试网可填 0x01 模拟）", proofAria: "人类证明（hex）", depositHelp: "普通注册使用标准押金，但无法找回账号、不能担任担保人或陪审员（可随时升级验证）。线上 World ID v4 adapter 的找回走全守护人 + 48 小时否决路径。", registering: "注册中…", registerDeposit: "注册（押金 {amount} ETH，可退还）", guardiansRequired: "请填写至少两位守护人（紧急联系人）。", guardianInvalid: "守护人地址格式无效。", guardianSelf: "不能把自己设为守护人。", guardianDuplicate: "守护人地址重复。", depositLoading: "注册押金尚未加载。", completeInfo: "请填写完整信息。", validWorldId: "请填写有效的 World ID nullifier 与非空证明。", registered: "注册成功，新 Agent ID：{id}。", missingEvent: "交易已确认，但回执中未找到 AgentRegistered 事件。", identity: "我的社区身份", status: "状态：", active: "活跃", deregistered: "已注销", poh: "人类验证：", verified: "已验证（World ID）", unverified: "未验证", lockedDeposit: "锁定押金：", pending: "待提取余额：", notVerified: "尚未完成人类验证（World ID）", notVerifiedRisk: "丢失私钥将无法找回，且不能担任担保人或陪审员。完成验证可解锁找回与这些角色。", bindNullifier: "绑定 nullifier（0x…64 位十六进制，测试网可随意填写未使用值）", bindProof: "绑定证明（hex，测试网可填 0x01 模拟）", bindInvalid: "填写有效的 nullifier（64 位十六进制）与非空证明。", bindButton: "绑定 PoH（升级为已验证身份）", bindSuccess: "已绑定人类证明。", activeTrades: "存在未了结的交易（等待对方操作或超时）。", openVotes: "存在未清结的陪审投票义务。", recoveryBlocks: "有进行中的找回请求，先否决或等待过期。", conditions: "条件未满足。", deregisterSuccess: "已注销，押金已转入待提取余额。", deregister: "注销并退还押金", recoveryDeregisterBlock: "有进行中的找回请求，注销暂不可用。", walletCheck: "请确保网络与钱包状态正确。", withdrawDeposit: "提取待提取余额", withdrawSuccess: "押金已提取。", recovery: "找回与守护", recoveryLive: "找回请求进行中：新钱包 {wallet} · 守护人批准 {approvals} / {required} · 路径：{path} · 可执行时间 {date}", samePersonPath: "同人证明（24h 否决窗）", guardianPath: "全守护人兜底（48h 否决窗）", all: "全部", vetoWarning: "若你并未丢失私钥，请在 {hours} 小时否决窗口内立即否决，否则责任主体将被迁移。", veto: "否决找回", vetoSuccess: "已否决找回请求。", noRecovery: "当前没有针对你的找回请求。丢失私钥时，新钱包可携带 World ID 同人证明发起找回（需命令行工具），守护人在下方批准；无同人证明时需全部守护人批准并等待 48 小时否决窗。", approveHelp: "作为守护人：输入被守护人地址并批准其找回请求", protectedAddress: "被守护人地址", approve: "批准找回", approveSuccess: "已批准该找回请求。", worldIdButton: "使用 World ID 验证", worldIdLoading: "正在准备 World ID…", worldIdError: "World ID 验证失败", verifierMissing: "Registry 尚未绑定 World ID 验证器；验证注册、担保人与陪审员资格暂不可用。", registeredAgents: "已注册智能体（{count}）", noAgents: "暂无智能体，注册第一个吧" },
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
