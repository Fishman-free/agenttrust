"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeAbiParameters, formatEther, keccak256, type Address, type Hash, type Hex } from "viem";
import { useAccount, useBlock, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { TransactionStatus, useTransactionFeedback } from "@/app/components/transaction-status";
import { agentRegistryAbi, guaranteeEscrowAbi, reputationHubAbi, schellingVotingAbi } from "@/lib/abi";
import { CHAIN_ID, CONTRACT_ADDRESSES, WRITES_ENABLED } from "@/lib/config";
import { parseCaseOpened, parseVoteCommitted, parseVoteRevealed } from "@/lib/receipt-events";
import {
  readVoteSecret,
  updateVoteSecretStatus,
  type VoteSecretRecord,
  type VoteSecretScope,
  type VoteSide,
} from "@/lib/vote-secret";
import { getWriteReadiness, type WriteReadiness } from "@/lib/write-readiness";
import { cidsFromDigest, digestFromCidOrHex, gatewayUrl, pinFileToPinata, verifyRawContent } from "@/lib/ipfs";
import { assertCapturedWallet, canClaimVote, parseUnsignedId, prepareAndSubmitVote, type VotePreparationMutex } from "./workflow";
import { useLocale, type Locale } from "@/lib/locale";
import { useTxRecorder } from "@/lib/tx-history";

type CaseDetails = {
  tradeId: bigint;
  stake: bigint;
  commitDeadline: bigint;
  revealDeadline: bigint;
  eligibilityAgentCount: bigint;
  committedCount: bigint;
  votesForBuyer: bigint;
  votesForSeller: bigint;
  abstentions: bigint;
  settled: boolean;
  effective: boolean;
  winner: number;
  jurySize: bigint;
  voluntarySeats: bigint;
  randomSeats: bigint;
  randomCommitDeadline: bigint;
  randomInvitedCount: bigint;
  randomSelected: boolean;
};
type JurorStatus = readonly [boolean, boolean, number, boolean];
type TradeView = {
  exists: boolean;
  id: bigint;
  buyerAgentId: bigint;
  sellerAgentId: bigint;
  buyerSubject: Address;
  sellerSubject: Address;
  guarantorSubject: Address;
  state: number;
  caseOpened: boolean;
};
type EvidenceView = { exists: boolean; contentHash: `0x${string}`; summary: string; submittedAt: bigint };
type ReputationView = { tradesCompleted: bigint; tradesDefaulted: bigint; disputesWon: bigint; disputesLost: bigint };
type WriteContext = {
  account: Address;
  chainId: number;
  votingAddress: Address;
  caseId?: bigint;
  secretScope?: VoteSecretScope;
};
type PendingOperation =
  | { kind: "dispute" | "open" | "evidence"; tradeId: bigint; context: WriteContext }
  | { kind: "commit"; commitment: Hex; context: WriteContext & { caseId: bigint; secretScope: VoteSecretScope } }
  | { kind: "reveal"; side: VoteSide; context: WriteContext & { caseId: bigint; secretScope: VoteSecretScope } }
  | { kind: "settle" | "claim" | "withdraw" | "metrics" | "selectRandomJury"; context: WriteContext & { caseId: bigint } };

const enMessages = {
  tradeSection: "1. Trade dispute and permissionless case opening", exactBond: "Exact dispute bond", tradeState: "Trade state", immutableCaseStake: "Current immutable caseStake", tradeCase: "Trade case", loading: "Loading…", noCase: "No case opened", disputeAction: "Pay exact bond and dispute", openCaseAction: "openCase (callable by anyone)",
  evidenceSection: "1.5 Evidence (basis for juror decisions)", evidenceDeadline: "Evidence deadline", chainTime: "Current on-chain time", evidenceHelp: "Each party may submit one evidence record during the window (updates overwrite it while the submission count remains on-chain). Evidence freezes when the case opens for juror review. No automatic penalty applies for not submitting evidence; jurors decide.", evidenceCidAria: "Evidence CID or digest (0x…)", evidenceCidPlaceholder: "IPFS CID or 32-byte digest (0x…)", evidenceSummaryAria: "Evidence summary", evidenceSummaryPlaceholder: "On-chain summary: briefly describe the evidence (stored permanently on-chain)", pinataAria: "Pinata JWT (optional)", pinataPlaceholder: "Pinata JWT (optional, browser-only)", uploadEvidence: "Upload evidence to IPFS", chooseEvidence: "Choose evidence file", persistenceHelp: "Unhosted files can disappear from the IPFS network. Pin through the upload control or host the file yourself and paste its CID. The on-chain summary and content hash remain permanently, preserving the historical anchor even if the file disappears.", submitEvidence: "Submit evidence", buyerEvidence: "Buyer evidence", sellerEvidence: "Seller evidence", buyer: "Buyer", seller: "Seller",
  caseSection: "2. Case status", casePlaceholder: "Case ID (filled automatically after opening)", phase: "Phase", caseStake: "Case stake", commitDeadline: "Commit deadline", revealDeadline: "Reveal deadline", snapshotAgents: "Eligible Agent snapshot count", committed: "Committed", buyerVotes: "Buyer votes", sellerVotes: "Seller votes", abstentions: "Abstentions", effectiveRuling: "Effective ruling", winner: "Winning side", yes: "Yes", no: "No", unsettled: "Not settled", loadCaseHelp: "Enter a valid Case ID to load caseDetails.", currentJurorStatus: "Current account jurorStatus:", snapshotEligibility: "Snapshot eligibility", reputationEligibility: "Reputation eligibility", tradeActor: "Trade actor", jurySize: "Jury seats (voluntary / random)", randomCommitDeadline: "Random draw deadline", randomInvitedCount: "Randomly invited", randomSelected: "Random jury drawn", randomInviteStatus: "Random jury invite", selectRandomJury: "Draw random jury",
  voteSection: "3. Commit–reveal voting", voteLegend: "Choose one option; the selection is written only into the encrypted commitment", commitVote: "Generate secret and submit commitment", revealVote: "Reveal with saved secret", secretWarning: "Important: losing browser data prevents reveal and may forfeit the stake. A salt is securely generated and saved before submission; back it up immediately.", localSecret: "Local secret", status: "status", copySecret: "Copy secret backup (JSON)", noSecret: "No usable secret exists for the current chain, account, and case.",
  settlementSection: "4. Settlement, claims, and metrics", pendingWithdrawal: "Pending withdrawal", settleCase: "Settle case", claim: "Claim", withdraw: "Withdraw to current account", finalizeMetrics: "Finalize my juror metrics",
  unauthorizedDispute: "Only the buyer or seller responsible subject for this trade can open a dispute.", invalidDisputeState: "The trade must be delivered and the dispute bond must be loaded.", invalidOpenState: "The trade must be disputed with no case opened; openCase is permissionless.", unauthorizedEvidence: "Only the buyer or seller responsible subject for this trade can submit evidence.", invalidEvidenceState: "The trade must be disputed, unopened, and still within the evidence window.", invalidEvidenceInput: "Enter at least a CID/digest or a text summary.", actorJuror: "The buyer, seller, and guarantor cannot serve as jurors for this case.", ineligibleJuror: "The account is outside the eligibility snapshot or does not meet juror reputation requirements.", existingSecretState: "A local voting secret already exists for this case. Do not overwrite it; reveal with the original secret.", commitState: "A commitment can be submitted only once during the commit phase.", revealState: "Only a juror who committed and has not revealed may act during the reveal phase.", missingSecret: "No local voting secret matches the current chain, account, and case.", claimUnauthorized: "Only a juror who submitted a vote can claim.", effectiveClaimState: "For an effective case, only winners or revealed abstentions can claim; losers and non-revealers are slashed.", claimState: "The case must be settled and the current account must not have claimed.", withdrawState: "The current account has no pending withdrawal.", metricsUnauthorized: "The current account did not commit a vote in this case.", metricsRecorded: "My juror metrics for this case are already finalized and cannot be submitted twice.", metricsState: "Juror metrics can be finalized only after settlement and after deduplication state has loaded.",
  phaseUnloaded: "Not loaded", phaseSettled: "Settled", phaseCommit: "Commit", phaseReveal: "Reveal", phaseAwaitSettlement: "Awaiting settlement", walletChanged: "The wallet account or network changed. Submission was cancelled.", caseChanged: "The current case changed. Submission was cancelled.", cidSummaryRequired: "Enter at least a CID or summary.", pinataRequired: "Paste your Pinata JWT first (kept only in this browser, never in the repository).", pinning: "Uploading to IPFS (Pinata)…", pinned: "Pinned to IPFS", uploadFailed: "Upload failed", invalidCid: "Invalid CID", hashMatch: "Hash matches: content exactly matches the on-chain anchor", unsupportedCid: "Non-raw encoding (dag-pb); gateway link only", hashMismatch: "Hash mismatch or content could not be retrieved", receiptMismatch: "The transaction was confirmed, but the expected matching event was not found in the receipt; local state was not updated.", copiedSecret: "Voting secret copied. Store it securely.", copyFailed: "Copy failed",
  successDispute: "Dispute confirmed.", successOpen: "Case opened and loaded automatically.", successEvidence: "Evidence submitted.", successCommit: "Commitment confirmed; local secret marked committed.", successReveal: "Reveal confirmed; local secret marked revealed.", successSettle: "Case settled.", successClaim: "Claim credited to pending withdrawals.", successWithdraw: "Balance withdrawn.", successMetrics: "Juror metrics finalized.", successSelectRandomJury: "Random jury drawn.", transactionReverted: "The transaction was mined but reverted.",
  submissions: "Submissions", noEvidence: "No evidence", summary: "Summary", submittedAt: "Submitted at", contentHash: "Content hash", gatewayV0: "View via gateway (CIDv0)", gatewayV1: "View via gateway (CIDv1 raw)", verifyRaw: "Verify raw file hash", reputationHistory: "reputation and history", reputationScore: "Reputation score", completed: "completed", defaulted: "defaulted", disputesWon: "won", disputesLost: "lost", recentTrades: "Recent trades", none: "None", state: "state",
  sideBuyer: "Buyer", sideSeller: "Seller", sideAbstain: "Abstain", secretPrepared: "prepared", secretCommitted: "committed", secretRevealed: "revealed",
  workflowLocked: "A voting secret is already being prepared. Do not submit again.", workflowExisting: "This case already has a voting secret. Overwriting is blocked to preserve revealability.", workflowCheck: "Could not safely check the existing voting secret", workflowScope: "The wallet account, network, or case changed. Submission was cancelled to protect the voting secret.",
} as const;
type DisputeMessages = { [K in keyof typeof enMessages]: string };
const zhMessages: DisputeMessages = {
  tradeSection: "1. 交易争议与无许可开案", exactBond: "精确争议保证金", tradeState: "交易状态", immutableCaseStake: "当前不可变 caseStake", tradeCase: "交易案件", loading: "加载中…", noCase: "尚未开案", disputeAction: "支付精确保证金并发起争议", openCaseAction: "openCase（任何人可调用）",
  evidenceSection: "1.5 举证与证据（陪审员裁决依据）", evidenceDeadline: "举证截止", chainTime: "链上当前时间", evidenceHelp: "争议双方在窗口内各可提交一份证据（可覆盖更新，链上记录提交次数）；开案后证据冻结，供陪审员审阅。未举证不自动处罚，由陪审员自行判断。", evidenceCidAria: "证据 CID 或摘要（0x…）", evidenceCidPlaceholder: "IPFS CID 或 32 字节摘要（0x…）", evidenceSummaryAria: "证据摘要", evidenceSummaryPlaceholder: "链上摘要：对证据的简要说明（永久保存在链上）", pinataAria: "Pinata JWT（可选）", pinataPlaceholder: "Pinata JWT（可选，仅存于浏览器）", uploadEvidence: "上传证据到 IPFS", chooseEvidence: "选择证据文件", persistenceHelp: "文件无人托管会从 IPFS 网络消失：请通过上传入口 pin，或自行托管后粘贴 CID。链上摘要与内容哈希永久保留，即使文件消失仍可验证历史锚定。", submitEvidence: "提交证据", buyerEvidence: "买方证据", sellerEvidence: "卖方证据", buyer: "买方", seller: "卖方",
  caseSection: "2. 案件状态", casePlaceholder: "Case ID（开案后自动填入）", phase: "阶段", caseStake: "案件质押", commitDeadline: "提交截止", revealDeadline: "揭示截止", snapshotAgents: "资格快照 Agent 数", committed: "已提交", buyerVotes: "买家票", sellerVotes: "卖家票", abstentions: "弃权", effectiveRuling: "有效裁决", winner: "胜方", yes: "是", no: "否", unsettled: "未结算", loadCaseHelp: "输入有效 Case ID 以加载 caseDetails。", currentJurorStatus: "当前账户 jurorStatus：", snapshotEligibility: "资格快照", reputationEligibility: "信誉资格", tradeActor: "交易主体", jurySize: "陪审团席位（自愿 / 随机）", randomCommitDeadline: "随机抽取截止", randomInvitedCount: "随机已邀请", randomSelected: "随机陪审团已抽取", randomInviteStatus: "随机陪审邀请", selectRandomJury: "抽取随机陪审团",
  voteSection: "3. 承诺—揭示投票", voteLegend: "选择一项；选择只会写入加密承诺", commitVote: "生成秘密并提交承诺", revealVote: "用已保存秘密揭示", secretWarning: "重要：浏览器数据丢失将导致无法揭示并可能损失质押。提交前会先安全生成并保存 salt；请立即备份。", localSecret: "本地秘密", status: "状态", copySecret: "复制秘密备份（JSON）", noSecret: "当前链、账户与案件没有可用秘密。",
  settlementSection: "4. 结算、领取与指标", pendingWithdrawal: "待提取余额", settleCase: "结算案件", claim: "统一领取 claim", withdraw: "提取到当前账户", finalizeMetrics: "固化我的陪审员指标",
  unauthorizedDispute: "只有该交易的买家或卖家责任主体可以发起争议。", invalidDisputeState: "交易必须处于已交付状态，且争议保证金已加载。", invalidOpenState: "交易必须处于争议状态且尚未开案；openCase 是无许可操作。", unauthorizedEvidence: "只有该交易的买家或卖家责任主体可以举证。", invalidEvidenceState: "交易必须处于争议状态、未开案且仍在举证窗口内。", invalidEvidenceInput: "CID/摘要与文字摘要至少填写一项。", actorJuror: "交易买家、卖家和担保人不能担任本案陪审员。", ineligibleJuror: "账户不在资格快照中或陪审员信誉不合格。", existingSecretState: "当前案件已有本地投票秘密，禁止覆盖；请使用原秘密揭示。", commitState: "仅可在提交阶段提交一次承诺。", revealState: "仅已提交且尚未揭示的陪审员可在揭示阶段操作。", missingSecret: "未找到与当前链、账户和案件匹配的本地投票秘密。", claimUnauthorized: "只有已提交投票的陪审员可以领取。", effectiveClaimState: "有效案件仅胜方或已揭示的弃权票可领取；败方和未揭示者会被罚没。", claimState: "案件需已结算且当前账户尚未领取。", withdrawState: "当前账户没有待提取余额。", metricsUnauthorized: "当前账户未提交本案投票。", metricsRecorded: "我的本案陪审员指标已经固化，不能重复提交。", metricsState: "结算后且去重状态加载完成后才能固化陪审员指标。",
  phaseUnloaded: "未加载", phaseSettled: "已结算", phaseCommit: "提交", phaseReveal: "揭示", phaseAwaitSettlement: "待结算", walletChanged: "钱包账户或网络已变化，已取消提交。", caseChanged: "当前案件已变化，已取消提交。", cidSummaryRequired: "CID 与摘要至少填写一项。", pinataRequired: "请先粘贴你的 Pinata JWT（只保存在浏览器，不进仓库）。", pinning: "正在上传到 IPFS（Pinata）…", pinned: "已固定到 IPFS", uploadFailed: "上传失败", invalidCid: "CID 无效", hashMatch: "哈希一致：内容与链上锚定完全匹配", unsupportedCid: "非 raw 编码（dag-pb），仅提供网关链接", hashMismatch: "哈希不一致或无法获取内容", receiptMismatch: "交易已确认，但回执中未找到匹配的预期事件；本地状态未更新。", copiedSecret: "投票秘密已复制，请保存到安全位置。", copyFailed: "复制失败",
  successDispute: "争议已确认。", successOpen: "案件已开设并自动载入。", successEvidence: "证据已提交。", successCommit: "承诺已确认，本地秘密已标记为 committed。", successReveal: "揭示已确认，本地秘密已标记为 revealed。", successSettle: "案件已结算。", successClaim: "领取已记入待提取余额。", successWithdraw: "余额已提取。", successMetrics: "陪审员指标已固化。", successSelectRandomJury: "随机陪审团已抽取。", transactionReverted: "交易已上链但执行回滚。",
  submissions: "提交次数", noEvidence: "未举证", summary: "摘要", submittedAt: "提交时间", contentHash: "内容哈希", gatewayV0: "网关查看（CIDv0）", gatewayV1: "网关查看（CIDv1 raw）", verifyRaw: "校验原始文件哈希", reputationHistory: "信誉与历史", reputationScore: "信誉分", completed: "完成", defaulted: "违约", disputesWon: "胜诉", disputesLost: "败诉", recentTrades: "最近交易", none: "无", state: "状态",
  sideBuyer: "买家", sideSeller: "卖家", sideAbstain: "弃权", secretPrepared: "已准备", secretCommitted: "已提交", secretRevealed: "已揭示",
  workflowLocked: "投票秘密正在准备中，请勿重复提交。", workflowExisting: "当前案件已有投票秘密；为防止无法揭示，禁止覆盖。", workflowCheck: "无法安全检查已有投票秘密", workflowScope: "钱包账户、网络或案件已变化，已取消提交以保护投票秘密。",
};
const messagesByLocale: Record<Locale, DisputeMessages> = { en: enMessages, "zh-CN": zhMessages };

function sideLabels(messages: DisputeMessages) { return [messages.sideBuyer, messages.sideSeller, messages.sideAbstain] as const; }
function booleanLabel(value: boolean | undefined, messages: DisputeMessages) { return value === undefined ? "—" : value ? messages.yes : messages.no; }
function secretStatusLabel(status: VoteSecretRecord["status"], messages: DisputeMessages) {
  return { prepared: messages.secretPrepared, committed: messages.secretCommitted, revealed: messages.secretRevealed }[status];
}

function formatDeadline(value?: bigint, locale: Locale = "en") {
  if (value === undefined) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(Number(value) * 1000);
}

function sameAddress(left?: Address, right?: Address) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export default function DisputesPage() {
  const { locale, dictionary: t } = useLocale();
  const m = messagesByLocale[locale];
  const sides = sideLabels(m);
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const writer = useWriteContract();
  const [tradeIdInput, setTradeIdInput] = useState("");
  const [caseIdInput, setCaseIdInput] = useState("");
  const [selectedSide, setSelectedSide] = useState<VoteSide>(0);
  const [hash, setHash] = useState<Hash>();
  const [pendingOperation, setPendingOperation] = useState<PendingOperation>();
  const [localError, setLocalError] = useState<Error | null>(null);
  const [secret, setSecret] = useState<VoteSecretRecord>();
  const [secretMessage, setSecretMessage] = useState<string>();
  const [evidenceCid, setEvidenceCid] = useState("");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [pinataJwt, setPinataJwt] = useState("");
  const [pinStatus, setPinStatus] = useState<string>();
  const [verifyResults, setVerifyResults] = useState<{ buyer?: string; seller?: string }>({});
  const processedHash = useRef<Hash | undefined>(undefined);
  const voteMutex = useRef<VotePreparationMutex>({ locked: false });
  const walletSnapshot = useRef<{ account?: Address; chainId?: number; caseId?: bigint }>({});

  useEffect(() => {
    walletSnapshot.current = { account: address, chainId, caseId: parseUnsignedId(caseIdInput) };
  }, [address, caseIdInput, chainId]);

  useEffect(() => {
    const linkedTradeId = new URLSearchParams(window.location.search).get("tradeId");
    if (linkedTradeId !== null && parseUnsignedId(linkedTradeId) !== undefined) {
      // The query string is an external browser source synchronized only after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTradeIdInput(linkedTradeId);
    }
  }, []);

  const tradeId = parseUnsignedId(tradeIdInput);
  const caseId = parseUnsignedId(caseIdInput);
  const rightChain = chainId === CHAIN_ID;
  const readEnabled = WRITES_ENABLED;
  const blockRead = useBlock({
    query: { enabled: readEnabled && rightChain, refetchInterval: 4000 },
  });

  const tradeRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "getTrade",
    args: tradeId === undefined ? undefined : [tradeId],
    query: { enabled: readEnabled && tradeId !== undefined },
  });
  const trade = tradeRead.data as unknown as TradeView | undefined;
  const bondRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "requiredDisputeBond",
    args: tradeId === undefined ? undefined : [tradeId],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists) },
  });
  const hasCaseRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "tradeHasCase",
    args: tradeId === undefined ? undefined : [tradeId],
    query: { enabled: readEnabled && tradeId !== undefined },
  });
  const mappedCaseRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "caseIdForTrade",
    args: tradeId === undefined ? undefined : [tradeId],
    query: { enabled: readEnabled && tradeId !== undefined && hasCaseRead.data === true },
  });
  const caseStakeRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "caseStake",
    query: { enabled: readEnabled },
  });
  const caseRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "caseDetails",
    args: caseId === undefined ? undefined : [caseId],
    query: { enabled: readEnabled && caseId !== undefined, refetchInterval: 5000 },
  });
  const details = caseRead.data as unknown as CaseDetails | undefined;
  const actorsRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "tradeActors",
    args: details === undefined ? undefined : [details.tradeId],
    query: { enabled: readEnabled && details !== undefined },
  });
  const actors = actorsRead.data;
  const jurorRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "jurorStatus",
    args: caseId === undefined || !address ? undefined : [caseId, address],
    query: { enabled: readEnabled && caseId !== undefined && Boolean(address) },
  });
  const juror = jurorRead.data as unknown as JurorStatus | undefined;
  const randomInvitedRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "isRandomInvited",
    args: caseId === undefined || !address ? undefined : [caseId, address],
    query: { enabled: readEnabled && caseId !== undefined && Boolean(address), refetchInterval: 5000 },
  });
  const randomInvited = randomInvitedRead.data === true;
  const snapshotEligibleRead = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "isRegisteredSubjectAtCount",
    args: details === undefined || !address ? undefined : [address, details.eligibilityAgentCount],
    query: { enabled: readEnabled && details !== undefined && Boolean(address) },
  });
  const reputationEligibleRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "isJurorEligible",
    args: address ? [address] : undefined,
    query: { enabled: readEnabled && Boolean(address) },
  });
  const jurorPoHRead = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "isPoHVerified",
    args: address ? [address] : undefined,
    query: { enabled: readEnabled && Boolean(address), retry: false },
  });
  const withdrawalRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "pendingWithdrawals",
    args: address ? [address] : undefined,
    query: { enabled: readEnabled && Boolean(address), refetchInterval: 5000 },
  });
  const jurorCaseRecordId = useMemo(() => caseId === undefined || !address ? undefined : keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }],
    ["AGENTTRUST_JUROR_CASE_V1", CONTRACT_ADDRESSES.schellingVoting, BigInt(CHAIN_ID), caseId, address],
  )), [address, caseId]);
  const metricRecordedRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "recordedJurorCases",
    args: jurorCaseRecordId ? [jurorCaseRecordId] : undefined,
    query: { enabled: readEnabled && Boolean(jurorCaseRecordId), refetchInterval: 5000 },
  });

  const evidenceWindowEndRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "evidenceWindowEnd",
    args: tradeId === undefined ? undefined : [tradeId],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists) },
  });
  const buyerEvidenceRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "evidence",
    args: tradeId === undefined || !trade?.exists ? undefined : [tradeId, trade.buyerSubject],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists), refetchInterval: 5000 },
  });
  const sellerEvidenceRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "evidence",
    args: tradeId === undefined || !trade?.exists ? undefined : [tradeId, trade.sellerSubject],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists), refetchInterval: 5000 },
  });
  const buyerEvidenceCountRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "evidenceSubmissionCount",
    args: tradeId === undefined || !trade?.exists ? undefined : [tradeId, trade.buyerSubject],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists), refetchInterval: 5000 },
  });
  const sellerEvidenceCountRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "evidenceSubmissionCount",
    args: tradeId === undefined || !trade?.exists ? undefined : [tradeId, trade.sellerSubject],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists), refetchInterval: 5000 },
  });
  const buyerReputationRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputation",
    args: tradeId === undefined || !trade?.exists ? undefined : [trade.buyerAgentId],
    query: { enabled: readEnabled && Boolean(trade?.exists), refetchInterval: 8000 },
  });
  const buyerScoreRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputationScore",
    args: tradeId === undefined || !trade?.exists ? undefined : [trade.buyerAgentId],
    query: { enabled: readEnabled && Boolean(trade?.exists), refetchInterval: 8000 },
  });
  const sellerReputationRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputation",
    args: tradeId === undefined || !trade?.exists ? undefined : [trade.sellerAgentId],
    query: { enabled: readEnabled && Boolean(trade?.exists), refetchInterval: 8000 },
  });
  const sellerScoreRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputationScore",
    args: tradeId === undefined || !trade?.exists ? undefined : [trade.sellerAgentId],
    query: { enabled: readEnabled && Boolean(trade?.exists), refetchInterval: 8000 },
  });
  const nextTradeIdRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "nextTradeId",
    query: { enabled: readEnabled, refetchInterval: 8000 },
  });
  const historyWindow = nextTradeIdRead.data !== undefined ? Math.min(Number(nextTradeIdRead.data), 60) : 0;
  const historyRead = useReadContracts({
    contracts: Array.from({ length: historyWindow }, (_, i) => ({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "getTrade" as const,
      args: [BigInt(historyWindow - 1 - i)] as const,
    })),
    query: { enabled: readEnabled && historyWindow > 0 },
  });

  const buyerEvidence = buyerEvidenceRead.data as unknown as EvidenceView | undefined;
  const sellerEvidence = sellerEvidenceRead.data as unknown as EvidenceView | undefined;
  const buyerReputation = buyerReputationRead.data as unknown as ReputationView | undefined;
  const sellerReputation = sellerReputationRead.data as unknown as ReputationView | undefined;

  function recentTradesFor(party?: Address) {
    if (!party || !historyRead.data) return [];
    const matches: { id: bigint; state: number; amount: bigint }[] = [];
    for (const entry of historyRead.data) {
      if (matches.length >= 5) break;
      if (entry?.status !== "success") continue;
      const record = entry.result as unknown as TradeView;
      if (sameAddress(record.buyerSubject, party) || sameAddress(record.sellerSubject, party)) {
        matches.push({ id: record.id, state: record.state, amount: BigInt(0) });
      }
    }
    return matches;
  }

  useEffect(() => {
    // Synchronize the editable field with the authoritative trade → case mapping.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mappedCaseRead.data !== undefined) setCaseIdInput(mappedCaseRead.data.toString());
  }, [mappedCaseRead.data]);

  const secretScope = useMemo<VoteSecretScope | undefined>(() => {
    if (!address || caseId === undefined) return undefined;
    return { chainId: CHAIN_ID, votingAddress: CONTRACT_ADDRESSES.schellingVoting, account: address, caseId };
  }, [address, caseId]);

  const loadSecret = useCallback(() => {
    if (!secretScope || typeof window === "undefined") {
      setSecret(undefined);
      return;
    }
    const result = readVoteSecret(window.localStorage, secretScope);
    setSecret(result.status === "valid" ? result.record : undefined);
    setSecretMessage(result.status === "malformed" || result.status === "unavailable" ? result.error : undefined);
  }, [secretScope]);

  useEffect(() => {
    // localStorage is external state scoped by chain, contract, account, and case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSecret();
  }, [loadSecret]);

  const chainTimestamp = blockRead.data?.timestamp;
  const phaseKey = !details || chainTimestamp === undefined ? "unloaded" : details.settled ? "settled" : chainTimestamp < details.randomCommitDeadline ? "commit" : chainTimestamp < details.revealDeadline ? "reveal" : "await-settlement";
  const phase = { unloaded: m.phaseUnloaded, settled: m.phaseSettled, commit: m.phaseCommit, reveal: m.phaseReveal, "await-settlement": m.phaseAwaitSettlement }[phaseKey];
  const voluntaryWindowOpen = Boolean(details && chainTimestamp !== undefined && chainTimestamp < details.commitDeadline);
  const randomWindowOpen = Boolean(details && chainTimestamp !== undefined && chainTimestamp >= details.commitDeadline && chainTimestamp < details.randomCommitDeadline);
  const isActor = Boolean(address && actors?.some((actor) => sameAddress(actor, address)));
  const jurorEligible = snapshotEligibleRead.data === true && reputationEligibleRead.data === true && jurorPoHRead.data === true && !isActor;
  const tradeParty = Boolean(address && trade && (sameAddress(address, trade.buyerSubject) || sameAddress(address, trade.sellerSubject)));

  const feedback = useTransactionFeedback({
    hash,
    isSubmitting: writer.isPending,
    writeError: localError ?? writer.error,
  });
  useTxRecorder(feedback, { kind: "dispute", subject: address, chainId });
  const transactionBusy = feedback.phase === "submitting" || feedback.phase === "confirming";

  const readiness = useCallback((authorized: boolean, stateValid: boolean, inputValid: boolean, reasons?: Parameters<typeof getWriteReadiness>[0]["reasons"]): WriteReadiness =>
    getWriteReadiness({
      configured: WRITES_ENABLED,
      connected: isConnected,
      rightChain,
      busy: transactionBusy,
      authorized,
      stateValid,
      inputValid,
      reasons,
      locale,
    }), [isConnected, locale, rightChain, transactionBusy]);

  const disputeReady = readiness(tradeParty, trade?.exists === true && trade.state === 5 && bondRead.data !== undefined, tradeId !== undefined, {
    unauthorized: m.unauthorizedDispute,
    "invalid-state": m.invalidDisputeState,
  });
  const openReady = readiness(true, trade?.exists === true && trade.state === 6 && hasCaseRead.data === false, tradeId !== undefined, {
    "invalid-state": m.invalidOpenState,
  });
  const evidenceWindowOpen = trade?.state === 6 && trade?.caseOpened === false && chainTimestamp !== undefined
    && evidenceWindowEndRead.data !== undefined && chainTimestamp <= Number(evidenceWindowEndRead.data);
  const evidenceReady = readiness(tradeParty, Boolean(evidenceWindowOpen), evidenceCid.trim() !== "" || evidenceSummary.trim() !== "", {
    unauthorized: m.unauthorizedEvidence,
    "invalid-state": m.invalidEvidenceState,
    "invalid-input": m.invalidEvidenceInput,
  });
  const commitSeatOpen = details === undefined ? false : voluntaryWindowOpen ? details.committedCount < details.voluntarySeats : randomWindowOpen && randomInvited;
  const commitReady = readiness(jurorEligible, phaseKey === "commit" && commitSeatOpen && juror?.[0] === false && details !== undefined && secret === undefined, caseId !== undefined && Boolean(address), {
    unauthorized: isActor ? m.actorJuror
      : jurorPoHRead.isLoading ? t.poh.checking
        : jurorPoHRead.error ? t.poh.unavailable
          : jurorPoHRead.data !== true ? t.poh.requiredJuror : m.ineligibleJuror,
    "invalid-state": secret ? m.existingSecretState : m.commitState,
  });
  const revealReady = readiness(true, phaseKey === "reveal" && juror?.[0] === true && juror[1] === false, Boolean(secretScope && secret && secret.status !== "revealed"), {
    "invalid-state": m.revealState,
    "invalid-input": m.missingSecret,
  });
  const settleReady = readiness(true, phaseKey === "await-settlement", caseId !== undefined);
  const selectRandomJuryReady = readiness(true, Boolean(details && !details.settled && !details.randomSelected && chainTimestamp !== undefined && chainTimestamp >= details.commitDeadline), caseId !== undefined);
  const claimable = Boolean(details && juror && canClaimVote({
    settled: details.settled, effective: details.effective, winner: details.winner as VoteSide,
    committed: juror[0], revealed: juror[1], side: juror[2] as VoteSide, claimed: juror[3],
  }));
  const claimReady = readiness(juror?.[0] === true, claimable, caseId !== undefined, {
    unauthorized: m.claimUnauthorized,
    "invalid-state": details?.effective === true ? m.effectiveClaimState : m.claimState,
  });
  const withdrawReady = readiness(true, (withdrawalRead.data ?? BigInt(0)) > BigInt(0), Boolean(address), {
    "invalid-state": m.withdrawState,
  });
  const metricsReady = readiness(juror?.[0] === true, details?.settled === true && metricRecordedRead.data === false, caseId !== undefined && Boolean(address), {
    unauthorized: m.metricsUnauthorized,
    "invalid-state": metricRecordedRead.data === true ? m.metricsRecorded : m.metricsState,
  });

  const assertContextCurrent = useCallback((context: WriteContext) => {
    const current = walletSnapshot.current;
    if (current.account?.toLowerCase() !== context.account.toLowerCase() || current.chainId !== context.chainId) {
      throw new Error(m.walletChanged);
    }
    if (context.caseId !== undefined && current.caseId !== context.caseId) {
      throw new Error(m.caseChanged);
    }
  }, [m]);

  const begin = useCallback((operation: PendingOperation) => {
    writer.reset();
    setHash(undefined);
    setLocalError(null);
    setPendingOperation(operation);
    processedHash.current = undefined;
  }, [writer]);

  const submit = useCallback(async (operation: PendingOperation, write: () => Promise<Hash>) => {
    begin(operation);
    try {
      assertContextCurrent(operation.context);
      const nextHash = await write();
      setHash(nextHash);
      return nextHash;
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error(String(error)));
      return undefined;
    }
  }, [assertContextCurrent, begin]);

  async function dispute() {
    if (!disputeReady.ready || tradeId === undefined || bondRead.data === undefined || !address || chainId !== CHAIN_ID) return;
    const bond = bondRead.data;
    const context: WriteContext = { account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting };
    await submit({ kind: "dispute", tradeId, context }, () => writer.writeContractAsync({
      account: context.account,
      address: CONTRACT_ADDRESSES.guaranteeEscrow, abi: guaranteeEscrowAbi, functionName: "dispute", args: [tradeId], value: bond,
    }));
  }

  async function openCase() {
    if (!openReady.ready || tradeId === undefined || !address || chainId !== CHAIN_ID) return;
    const context: WriteContext = { account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting };
    await submit({ kind: "open", tradeId, context }, () => writer.writeContractAsync({
      account: context.account,
      address: CONTRACT_ADDRESSES.schellingVoting, abi: schellingVotingAbi, functionName: "openCase", args: [tradeId],
    }));
  }

  async function submitEvidence() {
    if (!evidenceReady.ready || tradeId === undefined || !address || chainId !== CHAIN_ID) return;
    const digest = await digestFromCidOrHex(evidenceCid);
    if (!digest && evidenceSummary.trim() === "") {
      setLocalError(new Error(m.cidSummaryRequired));
      return;
    }
    const context: WriteContext = { account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting };
    await submit({ kind: "evidence", tradeId, context }, () => writer.writeContractAsync({
      account: context.account,
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "submitEvidence",
      args: [tradeId, digest ?? `0x${"00".repeat(32)}`, evidenceSummary.trim()],
    }));
  }

  async function uploadEvidenceFile(file: File) {
    if (!pinataJwt.trim()) {
      setPinStatus(m.pinataRequired);
      return;
    }
    setPinStatus(m.pinning);
    try {
      const cid = await pinFileToPinata(file, pinataJwt.trim());
      setEvidenceCid(cid);
      setPinStatus(`${m.pinned}: ${cid}`);
    } catch (error) {
      setPinStatus(error instanceof Error ? error.message : m.uploadFailed);
    }
  }

  async function verifyEvidence(party: "buyer" | "seller") {
    const evidenceView = party === "buyer" ? buyerEvidence : sellerEvidence;
    if (!evidenceView?.exists || evidenceView.contentHash === `0x${"00".repeat(32)}`) return;
    const { cidv1 } = cidsFromDigest(evidenceView.contentHash);
    if (!cidv1) {
      setVerifyResults((previous) => ({ ...previous, [party]: m.invalidCid }));
      return;
    }
    const result = await verifyRawContent(cidv1, evidenceView.contentHash);
    setVerifyResults((previous) => ({
      ...previous,
      [party]: result === "match" ? m.hashMatch : result === "unsupported" ? m.unsupportedCid : m.hashMismatch,
    }));
  }

  async function commitVote() {
    if (!commitReady.ready || !secretScope || !address || !publicClient || !details || chainId !== CHAIN_ID) return;
    const capturedScope = secretScope;
    const side = selectedSide;
    const context: WriteContext & { caseId: bigint; secretScope: VoteSecretScope } = {
      account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting,
      caseId: capturedScope.caseId, secretScope: capturedScope,
    };
    begin({ kind: "commit", commitment: `0x${"00".repeat(32)}`, context });
    try {
      const result = await prepareAndSubmitVote({
        scope: capturedScope,
        side,
        stake: details.stake,
        storage: window.localStorage,
        mutex: voteMutex.current,
        readCommitment: (salt) => publicClient.readContract({
          address: context.votingAddress,
          abi: schellingVotingAbi,
          functionName: "voteCommitment",
          args: [context.caseId, context.account, side, salt],
        }),
        validateScope: () => assertCapturedWallet(capturedScope, {
          account: walletSnapshot.current.account,
          chainId: walletSnapshot.current.chainId,
          votingAddress: CONTRACT_ADDRESSES.schellingVoting,
          caseId: walletSnapshot.current.caseId,
        }, m.workflowScope),
        messages: {
          preparationLocked: m.workflowLocked,
          existingSecret: m.workflowExisting,
          secretCheckFailed: (error) => `${m.workflowCheck}: ${error}`,
          scopeChanged: m.workflowScope,
        },
        submit: ({ caseId: targetCaseId, commitment, value }) => {
          setPendingOperation({ kind: "commit", commitment, context });
          return writer.writeContractAsync({
            account: context.account,
            address: context.votingAddress,
            abi: schellingVotingAbi,
            functionName: "commitVote",
            args: [targetCaseId, commitment],
            value,
          });
        },
      });
      setSecret(result.record);
      setHash(result.hash);
    } catch (error) {
      loadSecret();
      setLocalError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async function revealVote() {
    if (!revealReady.ready || !secretScope || !secret || !address || chainId !== CHAIN_ID) return;
    const capturedSecret = secret;
    const context: WriteContext & { caseId: bigint; secretScope: VoteSecretScope } = {
      account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting,
      caseId: secretScope.caseId, secretScope,
    };
    await submit({ kind: "reveal", side: capturedSecret.side, context }, () => writer.writeContractAsync({
      account: context.account,
      address: context.votingAddress,
      abi: schellingVotingAbi,
      functionName: "revealVote",
      args: [context.caseId, capturedSecret.side, capturedSecret.salt],
    }));
  }

  async function simpleCaseWrite(kind: "settle" | "claim" | "metrics") {
    if (caseId === undefined || !address || chainId !== CHAIN_ID) return;
    const context: WriteContext & { caseId: bigint } = {
      account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting, caseId,
    };
    if (kind === "metrics") {
      if (!metricsReady.ready) return;
      await submit({ kind, context }, () => writer.writeContractAsync({
        account: context.account,
        address: context.votingAddress, abi: schellingVotingAbi, functionName: "finalizeJurorMetrics", args: [context.caseId, context.account],
      }));
    } else if (kind === "settle") {
      if (!settleReady.ready) return;
      await submit({ kind, context }, () => writer.writeContractAsync({
        account: context.account,
        address: context.votingAddress, abi: schellingVotingAbi, functionName: "settle", args: [context.caseId],
      }));
    } else {
      if (!claimReady.ready) return;
      await submit({ kind, context }, () => writer.writeContractAsync({
        account: context.account,
        address: context.votingAddress, abi: schellingVotingAbi, functionName: "claim", args: [context.caseId],
      }));
    }
  }

  async function withdraw() {
    if (!withdrawReady.ready || !address || caseId === undefined || chainId !== CHAIN_ID) return;
    const context: WriteContext & { caseId: bigint } = {
      account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting, caseId,
    };
    await submit({ kind: "withdraw", context }, () => writer.writeContractAsync({
      account: context.account,
      address: context.votingAddress, abi: schellingVotingAbi, functionName: "withdraw", args: [context.account],
    }));
  }

  async function selectRandomJury() {
    if (!selectRandomJuryReady.ready || caseId === undefined || !address || chainId !== CHAIN_ID) return;
    const context: WriteContext & { caseId: bigint } = {
      account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting, caseId,
    };
    await submit({ kind: "selectRandomJury", context }, () => writer.writeContractAsync({
      account: context.account,
      address: context.votingAddress, abi: schellingVotingAbi, functionName: "selectRandomJury", args: [context.caseId],
      // The random-draw loop's gas is seed-dependent (blockhash/prevrandao), so a gas
      // estimation at block N can under-estimate the mined execution at block N+1 and
      // revert with OutOfGas. The loop is bounded (at most `count` candidates), so an
      // explicit generous limit is safe and makes the outcome deterministic.
      gas: 500_000n,
    }));
  }

  const refresh = useCallback(() => {
    tradeRead.refetch(); bondRead.refetch(); hasCaseRead.refetch(); mappedCaseRead.refetch();
    caseRead.refetch(); actorsRead.refetch(); jurorRead.refetch(); randomInvitedRead.refetch(); snapshotEligibleRead.refetch();
    reputationEligibleRead.refetch(); withdrawalRead.refetch(); caseStakeRead.refetch(); metricRecordedRead.refetch();
    evidenceWindowEndRead.refetch(); buyerEvidenceRead.refetch(); sellerEvidenceRead.refetch();
    buyerEvidenceCountRead.refetch(); sellerEvidenceCountRead.refetch();
    buyerReputationRead.refetch(); buyerScoreRead.refetch(); sellerReputationRead.refetch(); sellerScoreRead.refetch();
    nextTradeIdRead.refetch(); historyRead.refetch(); blockRead.refetch(); loadSecret();
  }, [actorsRead, blockRead, bondRead, buyerEvidenceCountRead, buyerEvidenceRead, buyerReputationRead, buyerScoreRead,
    caseRead, caseStakeRead, evidenceWindowEndRead, hasCaseRead, historyRead, jurorRead, loadSecret, mappedCaseRead,
    metricRecordedRead, nextTradeIdRead, randomInvitedRead, reputationEligibleRead, sellerEvidenceCountRead, sellerEvidenceRead,
    sellerReputationRead, sellerScoreRead, snapshotEligibleRead, tradeRead, withdrawalRead]);

  useEffect(() => {
    if (feedback.phase !== "success" || !feedback.receipt || !hash || processedHash.current === hash || !pendingOperation) return;
    let confirmed = true;
    if (pendingOperation.kind === "open") {
      const event = parseCaseOpened(feedback.receipt, CONTRACT_ADDRESSES.schellingVoting, schellingVotingAbi);
      confirmed = Boolean(event && event.args.tradeId === pendingOperation.tradeId);
      // Receipt confirmation is the authoritative source for the new case id.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (event && confirmed) setCaseIdInput(event.args.caseId.toString());
    } else if (pendingOperation.kind === "commit") {
      const event = parseVoteCommitted(feedback.receipt, pendingOperation.context.votingAddress, schellingVotingAbi);
      confirmed = Boolean(event && event.args.caseId === pendingOperation.context.caseId && sameAddress(event.args.subject, pendingOperation.context.account) && event.args.commitment.toLowerCase() === pendingOperation.commitment.toLowerCase());
      if (confirmed) updateVoteSecretStatus(window.localStorage, pendingOperation.context.secretScope, "committed");
    } else if (pendingOperation.kind === "reveal") {
      const event = parseVoteRevealed(feedback.receipt, pendingOperation.context.votingAddress, schellingVotingAbi);
      confirmed = Boolean(event && event.args.caseId === pendingOperation.context.caseId && sameAddress(event.args.subject, pendingOperation.context.account) && event.args.side === pendingOperation.side);
      if (confirmed) updateVoteSecretStatus(window.localStorage, pendingOperation.context.secretScope, "revealed");
    }
    processedHash.current = hash;
    if (!confirmed) setLocalError(new Error(m.receiptMismatch));
    loadSecret();
    refresh();
  }, [feedback, hash, loadSecret, m, pendingOperation, refresh]);

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(secret));
      setSecretMessage(m.copiedSecret);
    } catch (error) {
      setSecretMessage(error instanceof Error ? error.message : m.copyFailed);
    }
  }

  const statusLabel = pendingOperation ? {
    dispute: m.successDispute, open: m.successOpen, evidence: m.successEvidence, commit: m.successCommit,
    reveal: m.successReveal, settle: m.successSettle, claim: m.successClaim,
    withdraw: m.successWithdraw, metrics: m.successMetrics, selectRandomJury: m.successSelectRandomJury,
  }[pendingOperation.kind] : undefined;

  return (
    <main className="page page-narrow space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="page-head"><h1 className="page-title">{t.pages.disputesTitle}</h1><p className="page-sub">{t.pages.disputesSubtitle}</p></div>
        <button className="button button-secondary" onClick={refresh}>{t.pages.reload}</button>
      </div>

      <section className="card space-y-3">
        <h2 className="card-title">{m.tradeSection}</h2>
        <input aria-label="Trade ID" placeholder="Trade ID" value={tradeIdInput} onChange={(event) => setTradeIdInput(event.target.value)} className="field-input" />
        <dl className="detail-grid">
          <div><dt className="text-gray-500">{m.exactBond}</dt><dd>{bondRead.data === undefined ? "—" : `${formatEther(bondRead.data)} ETH`}</dd></div>
          <div><dt className="text-gray-500">{m.tradeState}</dt><dd>{trade?.exists ? String(trade.state) : "—"}</dd></div>
          <div><dt className="text-gray-500">{m.immutableCaseStake}</dt><dd>{caseStakeRead.data === undefined ? "—" : `${formatEther(caseStakeRead.data)} ETH`}</dd></div>
          <div><dt className="text-gray-500">{m.tradeCase}</dt><dd>{hasCaseRead.data === true ? `Case #${mappedCaseRead.data?.toString() ?? m.loading}` : m.noCase}</dd></div>
        </dl>
        <div className="action-row">
          <GuardedButton label={m.disputeAction} ready={disputeReady} onClick={dispute} primary />
          <GuardedButton label={m.openCaseAction} ready={openReady} onClick={openCase} />
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="card-title">{m.evidenceSection}</h2>
        <dl className="detail-grid">
          <div><dt className="text-gray-500">{m.evidenceDeadline}</dt><dd>{formatDeadline(evidenceWindowEndRead.data, locale)}</dd></div>
          <div><dt className="text-gray-500">{m.chainTime}</dt><dd>{formatDeadline(chainTimestamp ? BigInt(chainTimestamp) : undefined, locale)}</dd></div>
        </dl>
        {evidenceWindowOpen && (
          <div className="callout space-y-2">
            <p className="text-sm">{m.evidenceHelp}</p>
            <input aria-label={m.evidenceCidAria} placeholder={m.evidenceCidPlaceholder} value={evidenceCid} onChange={(event) => setEvidenceCid(event.target.value)} className="field-input" />
            <textarea aria-label={m.evidenceSummaryAria} placeholder={m.evidenceSummaryPlaceholder} value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} className="field-input" rows={2} />
            <div className="flex gap-2 flex-wrap items-center">
              <input aria-label={m.pinataAria} placeholder={m.pinataPlaceholder} value={pinataJwt} onChange={(event) => setPinataJwt(event.target.value)} className="field-input flex-1 min-w-48" />
              <label className="button button-secondary cursor-pointer">
                {m.uploadEvidence}
                <input type="file" className="hidden" aria-label={m.chooseEvidence} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadEvidenceFile(file); }} />
              </label>
            </div>
            {pinStatus && <p className="form-hint">{pinStatus}</p>}
            <p className="form-hint">{m.persistenceHelp}</p>
            <GuardedButton label={m.submitEvidence} ready={evidenceReady} onClick={submitEvidence} primary />
          </div>
        )}
        {trade?.exists && (
          <div className="grid md:grid-cols-2 gap-3">
            <EvidencePartyBlock label={m.buyerEvidence} subject={trade.buyerSubject} evidence={buyerEvidence} count={buyerEvidenceCountRead.data} verifyResult={verifyResults.buyer} onVerify={() => void verifyEvidence("buyer")} locale={locale} messages={m} />
            <EvidencePartyBlock label={m.sellerEvidence} subject={trade.sellerSubject} evidence={sellerEvidence} count={sellerEvidenceCountRead.data} verifyResult={verifyResults.seller} onVerify={() => void verifyEvidence("seller")} locale={locale} messages={m} />
          </div>
        )}
        {trade?.exists && (
          <div className="grid md:grid-cols-2 gap-3">
            <PartyReputationBlock label={m.buyer} agentId={trade.buyerAgentId} subject={trade.buyerSubject} reputation={buyerReputation} score={buyerScoreRead.data} trades={recentTradesFor(trade.buyerSubject)} messages={m} />
            <PartyReputationBlock label={m.seller} agentId={trade.sellerAgentId} subject={trade.sellerSubject} reputation={sellerReputation} score={sellerScoreRead.data} trades={recentTradesFor(trade.sellerSubject)} messages={m} />
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="card-title">{m.caseSection}</h2>
        <input aria-label="Case ID" placeholder={m.casePlaceholder} value={caseIdInput} onChange={(event) => setCaseIdInput(event.target.value)} className="field-input" />
        {details ? (
          <dl className="detail-grid">
            <Metric label={m.phase} value={phase} /><Metric label="Trade ID" value={details.tradeId.toString()} /><Metric label={m.caseStake} value={`${formatEther(details.stake)} ETH`} />
            <Metric label={m.commitDeadline} value={formatDeadline(details.commitDeadline, locale)} /><Metric label={m.revealDeadline} value={formatDeadline(details.revealDeadline, locale)} /><Metric label={m.snapshotAgents} value={details.eligibilityAgentCount.toString()} />
            <Metric label={m.committed} value={details.committedCount.toString()} /><Metric label={m.buyerVotes} value={details.votesForBuyer.toString()} /><Metric label={m.sellerVotes} value={details.votesForSeller.toString()} />
            <Metric label={m.abstentions} value={details.abstentions.toString()} /><Metric label={m.effectiveRuling} value={details.settled ? (details.effective ? m.yes : m.no) : m.unsettled} /><Metric label={m.winner} value={details.settled ? sides[details.winner as VoteSide] : "—"} />
            <Metric label={m.randomCommitDeadline} value={formatDeadline(details.randomCommitDeadline, locale)} /><Metric label={m.jurySize} value={`${details.jurySize} (${details.voluntarySeats} + ${details.randomSeats})`} /><Metric label={m.randomInvitedCount} value={details.randomInvitedCount.toString()} /><Metric label={m.randomSelected} value={booleanLabel(details.randomSelected, m)} />
          </dl>
        ) : <p className="form-hint">{m.loadCaseHelp}</p>}
        <div className="callout text-sm">
          <strong>{m.currentJurorStatus}</strong>{juror ? ` committed=${booleanLabel(juror[0], m)} · revealed=${booleanLabel(juror[1], m)} · side=${sides[juror[2] as VoteSide]} · claimed=${booleanLabel(juror[3], m)}` : " —"}
          <div className="text-gray-500">{m.snapshotEligibility}: {booleanLabel(snapshotEligibleRead.data, m)} · {m.reputationEligibility}: {booleanLabel(reputationEligibleRead.data, m)} · {m.tradeActor}: {booleanLabel(isActor, m)}</div>
          <div className="text-gray-500">{m.randomInviteStatus}: {booleanLabel(randomInvited, m)} · {m.randomSelected}: {booleanLabel(details?.randomSelected, m)}</div>
        </div>
        <div className="action-row">
          <GuardedButton label={m.selectRandomJury} ready={selectRandomJuryReady} onClick={selectRandomJury} />
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="card-title">{m.voteSection}</h2>
        <fieldset className="flex gap-4 flex-wrap" disabled={!commitReady.ready}>
          <legend className="form-hint mb-1">{m.voteLegend}</legend>
          {sides.map((label, side) => <label key={label} className="flex gap-2 items-center"><input type="radio" name="vote-side" checked={selectedSide === side} onChange={() => setSelectedSide(side as VoteSide)} />{label}</label>)}
        </fieldset>
        <div className="action-row">
          <GuardedButton label={m.commitVote} ready={commitReady} onClick={commitVote} primary />
          <GuardedButton label={m.revealVote} ready={revealReady} onClick={revealVote} />
        </div>
        <div className="callout text-sm space-y-2">
          <p className="warning-text font-semibold">{m.secretWarning}</p>
          {secret ? <><p>{m.localSecret}: {sides[secret.side]} · {m.status} {secretStatusLabel(secret.status, m)}</p><code className="block break-all">salt: {secret.salt}</code><code className="block break-all">commitment: {secret.commitment}</code><button className="button button-secondary" onClick={copySecret}>{m.copySecret}</button></> : <p className="form-hint">{m.noSecret}</p>}
          {secretMessage && <p role="status">{secretMessage}</p>}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="card-title">{m.settlementSection}</h2>
        <p className="text-sm">{m.pendingWithdrawal}: <strong>{formatEther(withdrawalRead.data ?? BigInt(0))} ETH</strong></p>
        <div className="action-row">
          <GuardedButton label={m.settleCase} ready={settleReady} onClick={() => simpleCaseWrite("settle")} />
          <GuardedButton label={m.claim} ready={claimReady} onClick={() => simpleCaseWrite("claim")} />
          <GuardedButton label={m.withdraw} ready={withdrawReady} onClick={withdraw} />
          <GuardedButton label={m.finalizeMetrics} ready={metricsReady} onClick={() => simpleCaseWrite("metrics")} />
        </div>
      </section>

      <TransactionStatus
        feedback={feedback.receipt?.status === "reverted" && feedback.error ? { ...feedback, error: new Error(m.transactionReverted) } : feedback}
        successLabel={statusLabel}
      />
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-gray-500">{label}</dt><dd className="font-medium break-words">{value}</dd></div>;
}

function short(value?: Address) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

function EvidencePartyBlock({ label, subject, evidence, count, verifyResult, onVerify, locale, messages }: {
  label: string;
  subject: Address;
  evidence: EvidenceView | undefined;
  count: bigint | undefined;
  verifyResult?: string;
  onVerify: () => void;
  locale: Locale;
  messages: DisputeMessages;
}) {
  const exists = Boolean(evidence?.exists);
  const digest = exists && evidence!.contentHash !== `0x${"00".repeat(32)}` ? evidence!.contentHash : undefined;
  const cids = digest ? cidsFromDigest(digest) : undefined;
  return (
    <div className="callout text-sm space-y-1">
      <strong>{label} · {short(subject)}</strong>{" "}
      {exists ? <span>{messages.submissions}: {count?.toString() ?? "—"}</span> : <span className="warning-text">{messages.noEvidence}</span>}
      {exists && evidence!.summary && <p>{messages.summary}: {evidence!.summary}</p>}
      {exists && <p>{messages.submittedAt}: {formatDeadline(evidence!.submittedAt, locale)}</p>}
      {digest && cids && (
        <>
          <p className="break-all">{messages.contentHash}: {digest}</p>
          <p>
            {cids.cidv0 && <a className="link" href={gatewayUrl(cids.cidv0)} target="_blank" rel="noreferrer">{messages.gatewayV0}</a>}
            {cids.cidv1 && <> · <a className="link" href={gatewayUrl(cids.cidv1)} target="_blank" rel="noreferrer">{messages.gatewayV1}</a></>}
            {cids.cidv1 && <button className="button button-secondary" onClick={onVerify}>{messages.verifyRaw}</button>}
          </p>
          {verifyResult && <p className="form-hint">{verifyResult}</p>}
        </>
      )}
    </div>
  );
}

function PartyReputationBlock({ label, agentId, subject, reputation, score, trades, messages }: {
  label: string;
  agentId: bigint;
  subject: Address;
  reputation: ReputationView | undefined;
  score: bigint | undefined;
  trades: { id: bigint; state: number }[];
  messages: DisputeMessages;
}) {
  return (
    <div className="callout text-sm space-y-1">
      <strong>{label} {messages.reputationHistory} · Agent #{agentId.toString()} · {short(subject)}</strong>
      <p>
        {messages.reputationScore}: <strong>{score?.toString() ?? "—"}</strong> ·
        {messages.completed} {reputation?.tradesCompleted?.toString() ?? "—"} · {messages.defaulted} {reputation?.tradesDefaulted?.toString() ?? "—"} ·
        {messages.disputesWon} {reputation?.disputesWon?.toString() ?? "—"} · {messages.disputesLost} {reputation?.disputesLost?.toString() ?? "—"}
      </p>
      <p>{messages.recentTrades}: {trades.length === 0 ? messages.none : trades.map((item) => `#${item.id} (${messages.state} ${item.state})`).join(" · ")}</p>
    </div>
  );
}

function GuardedButton({ label, ready, onClick, primary = false }: { label: string; ready: WriteReadiness; onClick: () => void; primary?: boolean }) {
  return <div><button className={primary ? "button button-primary" : "button button-secondary"} disabled={!ready.ready} onClick={onClick}>{label}</button>{!ready.ready && <p className="form-hint mt-1 max-w-xs">{ready.reason}</p>}</div>;
}
