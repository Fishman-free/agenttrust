"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits, type Address, type Hash } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { TransactionStatus, useTransactionFeedback } from "@/app/components/transaction-status";
import { agentRegistryAbi, guaranteeEscrowAbi } from "@/lib/abi";
import { activeChain, CONTRACT_ADDRESSES, WRITES_ENABLED } from "@/lib/config";
import { parseTradeCreated } from "@/lib/receipt-events";
import { getTradeStateMeta, TRADE_STATE_META, type TradeAction } from "@/lib/trade-state";
import { getWriteReadiness, type WriteReadiness } from "@/lib/write-readiness";
import { TradeSubmissionGate, type TradeOperationKind } from "./workflow";
import { useLocale, type Locale } from "@/lib/locale";

const enTradeMessages = {
  walletDisconnected: "Connect a wallet using the header control; this page does not create duplicate connectors.",
  wrongChain: "Switch to {chain} (Chain ID {chainId}).",
  createSection: "1. Create trade (buyer)", buyerAgentId: "Buyer Agent ID", sellerAgentId: "Seller Agent ID",
  tradeAmount: "Trade amount (ETH)", maximumPremium: "Maximum premium (ETH)", guaranteePreview: "Guarantee terms preview",
  quotePreview: "quoteGuaranteeTerms preview", minimumCoverage: "Minimum coverage", minimumStake: "Minimum stake",
  referencePremium: "Reference premium", tierSurcharge: "Tier surcharge", insurable: "Insurable", yes: "Yes",
  noAdjustPremium: "No (adjust maximum premium)", quotePrompt: "Enter valid parameters to show the on-chain quote.", createTrade: "Create trade",
  querySection: "2. Query and advance trade", tradeId: "Trade ID", tradeIdPlaceholder: "Enter an ID or create a trade to load it automatically",
  loadingTrade: "Calling getTrade…", tradeReadError: "Unable to read this trade: ", allTradeStates: "All trade states", terminal: "terminal",
  trade: "Trade", amountAndPremium: "Amount / maximum premium", buyerAndSubject: "Buyer Agent / subject",
  sellerAndSubject: "Seller Agent / subject", guarantorAndSubject: "Guarantor Agent / subject", noQuote: "No quote yet",
  coverageActual: "Minimum / actual coverage", premiumActual: "Reference / actual premium", guaranteeStake: "Guarantee stake",
  reputationOutcome: "Reputation outcome", outcomePending: "Pending; retry available", outcomeRecorded: "Recorded", outcomeMissing: "Not produced",
  currentActions: "Actions for current state", guarantorQuote: "Guarantor quote", guarantorAgentId: "Guarantor Agent ID",
  coverage: "Coverage (%)", premium: "Premium (ETH)", exactStake: "requiredStake exact on-chain value:", remainingCapacity: "Remaining guarantee capacity for current account:",
  limit: "limit", offerGuarantee: "Offer guarantee and stake {stake}", disputeQuestion: "Need to dispute?",
  disputeHelp: "The disputes page reads and submits the exact dispute bond. This page only passes the Trade ID.",
  goToDisputes: "Go to disputes (Trade #{id})", disputeUnauthorized: "Only the buyer or seller responsible subject may dispute.",
  timeoutTitle: "Permissionless timeout action", timeoutHelp: "Any account may call after the contract window expires; calls before expiry revert.",
  outcomePendingTitle: "Reputation outcome is still pending", outcomeRetryHelp: "Settlement is complete; retryOutcome can safely retry the reputation record.",
  retryOutcome: "Retry outcome recording", withdrawSection: "3. Withdraw current-account balance", pendingWithdrawals: "pendingWithdrawals:",
  withdrawalRecipient: "The recipient is the connected account {address}.", withdrawAll: "Withdraw all balance",
  buyerCheck: "Checking the buyer Agent responsible subject.", buyerUnauthorized: "The current account is not the buyer Agent responsible subject.",
  guarantorCheck: "Checking the guarantor Agent responsible subject.", guarantorUnauthorized: "The current account is not this guarantor Agent responsible subject, or a trade party is attempting to self-guarantee.",
  sellerAccept: "Seller accepts trade", buyerFund: "Buyer escrows {amount}", sellerAcceptGuarantee: "Seller accepts guarantee",
  sellerDeliver: "Seller marks delivered", buyerConfirm: "Buyer confirms completion", sellerOnlyAccept: "Only the seller responsible subject may accept.",
  buyerOnlyFund: "Only the buyer responsible subject may fund.", sellerOnlyGuarantee: "Only the seller responsible subject may accept the guarantee.",
  sellerOnlyDeliver: "Only the seller responsible subject may deliver.", buyerOnlyConfirm: "Only the buyer responsible subject may confirm.",
  cancelAcceptance: "Cancel after acceptance window", cancelFunding: "Cancel after funding window", refundGuarantee: "Refund after guarantee window",
  rejectGuarantee: "Reject guarantee after acceptance window", refundDelivery: "Refund after delivery window", autoRelease: "Auto-release after confirmation window",
  voidDispute: "Void after case-opening timeout", createSuccess: "Trade created; Trade ID loaded automatically.", guaranteeSuccess: "Guarantee quote confirmed.",
  withdrawSuccess: "Balance withdrawn to the current account.", actionSuccess: "{action} succeeded.", retrySuccess: "Reputation outcome retry confirmed.",
} as const;

type TradeMessages = { [Key in keyof typeof enTradeMessages]: string };
const TRADE_MESSAGES = {
  en: enTradeMessages,
  "zh-CN": {
    walletDisconnected: "请使用页首控件连接钱包；本页不会创建重复连接器。", wrongChain: "请切换到 {chain}（Chain ID {chainId}）。",
    createSection: "1. 创建交易（买家）", buyerAgentId: "买家 Agent ID", sellerAgentId: "卖家 Agent ID", tradeAmount: "交易金额（ETH）",
    maximumPremium: "最高保费（ETH）", guaranteePreview: "担保条款预览", quotePreview: "quoteGuaranteeTerms 预览", minimumCoverage: "最低覆盖率",
    minimumStake: "最低质押", referencePremium: "参考保费", tierSurcharge: "档位附加费", insurable: "可承保", yes: "是",
    noAdjustPremium: "否（请调整最高保费）", quotePrompt: "请输入有效参数以显示链上报价。", createTrade: "创建交易",
    querySection: "2. 查询并推进交易", tradeId: "交易 ID", tradeIdPlaceholder: "输入 ID，或创建交易后自动载入", loadingTrade: "正在调用 getTrade…",
    tradeReadError: "无法读取该交易：", allTradeStates: "全部交易状态", terminal: "终态", trade: "交易", amountAndPremium: "金额 / 最高保费",
    buyerAndSubject: "买家 Agent / 责任主体", sellerAndSubject: "卖家 Agent / 责任主体", guarantorAndSubject: "担保人 Agent / 责任主体", noQuote: "尚无报价",
    coverageActual: "最低 / 实际覆盖率", premiumActual: "参考 / 实际保费", guaranteeStake: "担保质押", reputationOutcome: "信誉结果",
    outcomePending: "待处理；可重试", outcomeRecorded: "已记录", outcomeMissing: "未生成", currentActions: "当前状态可执行操作", guarantorQuote: "担保人报价",
    guarantorAgentId: "担保人 Agent ID", coverage: "覆盖率（%）", premium: "保费（ETH）", exactStake: "requiredStake 链上精确值：",
    remainingCapacity: "当前账户剩余担保容量：", limit: "上限", offerGuarantee: "提供担保并质押 {stake}", disputeQuestion: "需要发起争议？",
    disputeHelp: "争议页面会读取并提交精确的争议保证金；本页仅传递交易 ID。", goToDisputes: "前往争议页面（交易 #{id}）",
    disputeUnauthorized: "仅买家或卖家的责任主体可发起争议。", timeoutTitle: "无需许可的超时操作",
    timeoutHelp: "合约时间窗口届满后，任何账户均可调用；提前调用会回滚。", outcomePendingTitle: "信誉结果仍待处理",
    outcomeRetryHelp: "结算已完成；可安全调用 retryOutcome 重试记录信誉结果。", retryOutcome: "重试记录结果",
    withdrawSection: "3. 提取当前账户余额", pendingWithdrawals: "pendingWithdrawals：", withdrawalRecipient: "接收方为当前连接账户 {address}。",
    withdrawAll: "提取全部余额", buyerCheck: "正在检查买家 Agent 的责任主体。", buyerUnauthorized: "当前账户不是买家 Agent 的责任主体。",
    guarantorCheck: "正在检查担保人 Agent 的责任主体。", guarantorUnauthorized: "当前账户不是该担保人 Agent 的责任主体，或交易参与方正尝试自我担保。",
    sellerAccept: "卖家接受交易", buyerFund: "买家托管 {amount}", sellerAcceptGuarantee: "卖家接受担保", sellerDeliver: "卖家标记已交付",
    buyerConfirm: "买家确认完成", sellerOnlyAccept: "仅卖家的责任主体可接受交易。", buyerOnlyFund: "仅买家的责任主体可托管资金。",
    sellerOnlyGuarantee: "仅卖家的责任主体可接受担保。", sellerOnlyDeliver: "仅卖家的责任主体可确认交付。", buyerOnlyConfirm: "仅买家的责任主体可确认完成。",
    cancelAcceptance: "接受窗口届满后取消", cancelFunding: "出资窗口届满后取消", refundGuarantee: "担保窗口届满后退款",
    rejectGuarantee: "接受窗口届满后拒绝担保", refundDelivery: "交付窗口届满后退款", autoRelease: "确认窗口届满后自动放款",
    voidDispute: "立案超时后撤销争议", createSuccess: "交易已创建；交易 ID 已自动载入。", guaranteeSuccess: "担保报价已确认。",
    withdrawSuccess: "余额已提取至当前账户。", actionSuccess: "{action}成功。", retrySuccess: "已确认重试记录信誉结果。",
  } satisfies TradeMessages,
} satisfies Record<Locale, TradeMessages>;

const TRADE_STATE_LABELS = {
  en: { CREATED: "Created", ACCEPTED: "Accepted", FUNDED: "Funded", GUARANTEE_OFFERED: "Guarantee offered", GUARANTEED: "Guaranteed", DELIVERED: "Delivered", DISPUTED: "Disputed", RELEASED: "Released", RESOLVED: "Resolved", VOIDED: "Voided" },
  "zh-CN": { CREATED: "已创建", ACCEPTED: "已接受", FUNDED: "已托管", GUARANTEE_OFFERED: "担保已报价", GUARANTEED: "担保生效", DELIVERED: "已交付", DISPUTED: "争议中", RELEASED: "已放款", RESOLVED: "已裁决", VOIDED: "已作废" },
} as const;

function formatLocal(template: string, values: Record<string, string | number | bigint> = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

const ZERO = BigInt(0);
const ACTION_FUNCTIONS = {
  acceptTrade: "acceptTrade",
  acceptGuarantee: "acceptGuarantee",
  deliver: "deliver",
  confirm: "confirm",
  timeoutCancelUnaccepted: "timeoutCancelUnaccepted",
  timeoutCancelUnfunded: "timeoutCancelUnfunded",
  timeoutRejectGuarantee: "timeoutRejectGuarantee",
  timeoutRefund: "timeoutRefund",
  timeoutAutoRelease: "timeoutAutoRelease",
  timeoutVoidDispute: "timeoutVoidDispute",
  retryOutcome: "retryOutcome",
} as const;

type SimpleAction = keyof typeof ACTION_FUNCTIONS;
type WorkflowAction = SimpleAction | "fund";

function parseId(value: string): bigint | undefined {
  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? BigInt(normalized) : undefined;
}

function parseEtherValue(value: string, allowZero = false): bigint | undefined {
  try {
    const parsed = parseEther(value.trim());
    return parsed > ZERO || (allowZero && parsed === ZERO) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseCoverage(value: string): bigint | undefined {
  try {
    const parsed = parseUnits(value.trim(), 16); // Percent input: 100% = 1e18 contract units.
    return parsed > ZERO ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function sameAddress(left?: Address, right?: Address) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function eth(value?: bigint) {
  return value === undefined ? "—" : `${formatEther(value)} ETH`;
}

function percent(value?: bigint) {
  return value === undefined ? "—" : `${formatUnits(value, 16)}%`;
}

function shortAddress(value?: Address) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

function ActionButton({ label, readiness, onClick, primary = false }: {
  label: string;
  readiness: WriteReadiness;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={primary ? "button button-primary" : "button button-secondary"}
      disabled={!readiness.ready}
      title={readiness.ready ? undefined : readiness.reason}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default function TradePage() {
  const { locale, dictionary: t } = useLocale();
  const m = TRADE_MESSAGES[locale];
  const message = (template: string, values?: Record<string, string | number | bigint>) => formatLocal(template, values);
  const bilingual = (en: string, zhCN: string): Record<Locale, string> => ({ en, "zh-CN": zhCN });
  const { address, chainId, isConnected } = useAccount();
  const write = useWriteContract();
  const [buyerId, setBuyerId] = useState("0");
  const [sellerId, setSellerId] = useState("1");
  const [amount, setAmount] = useState("0.1");
  const [maxPremium, setMaxPremium] = useState("0.005");
  const [tradeId, setTradeId] = useState("");
  const [guarantorAgentId, setGuarantorAgentId] = useState("2");
  const [coverage, setCoverage] = useState("100");
  const [premium, setPremium] = useState("0.005");
  const [successLabel, setSuccessLabel] = useState<Record<Locale, string>>();
  const [activeHash, setActiveHash] = useState<Hash>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const [submissionError, setSubmissionError] = useState<Error | null>(null);
  const [submissionGate] = useState(() => new TradeSubmissionGate());
  const processedReceipt = useRef<Hash | undefined>(undefined);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("tradeId");
    if (!value || !/^\d+$/.test(value)) return;
    const timer = window.setTimeout(() => setTradeId(value), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const updateTradeId = (value: string) => {
    setTradeId(value);
    const url = new URL(window.location.href);
    if (/^\d+$/.test(value.trim())) url.searchParams.set("tradeId", value.trim());
    else url.searchParams.delete("tradeId");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const parsedBuyerId = parseId(buyerId);
  const parsedSellerId = parseId(sellerId);
  const parsedAmount = parseEtherValue(amount);
  const parsedMaxPremium = parseEtherValue(maxPremium, true);
  const parsedTradeId = parseId(tradeId);
  const parsedGuarantorId = parseId(guarantorAgentId);
  const parsedCoverage = parseCoverage(coverage);
  const parsedPremium = parseEtherValue(premium, true);
  const configured = WRITES_ENABLED;
  const rightChain = chainId === activeChain.id;

  const tradeRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "getTrade",
    args: parsedTradeId === undefined ? undefined : [parsedTradeId],
    query: { enabled: configured && parsedTradeId !== undefined, refetchInterval: 4_000, retry: false },
  });
  const trade = tradeRead.data;
  const stateMeta = trade ? getTradeStateMeta(trade.state) : undefined;

  const quoteRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "quoteGuaranteeTerms",
    args: parsedSellerId === undefined || parsedAmount === undefined || parsedMaxPremium === undefined
      ? undefined : [parsedSellerId, parsedAmount, parsedMaxPremium],
    query: {
      enabled: configured && parsedSellerId !== undefined && parsedAmount !== undefined && parsedMaxPremium !== undefined,
      retry: false,
    },
  });
  const quote = quoteRead.data;

  const buyerOwnerRead = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "responsibleParty",
    args: parsedBuyerId === undefined ? undefined : [parsedBuyerId],
    query: { enabled: configured && parsedBuyerId !== undefined, retry: false },
  });

  const sellerOwnerRead = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "responsibleParty",
    args: parsedSellerId === undefined ? undefined : [parsedSellerId],
    query: { enabled: configured && parsedSellerId !== undefined, retry: false },
  });

  const guarantorOwnerRead = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "responsibleParty",
    args: parsedGuarantorId === undefined ? undefined : [parsedGuarantorId],
    query: { enabled: configured && parsedGuarantorId !== undefined, retry: false },
  });

  const guarantorPoHRead = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "isPoHVerified",
    args: guarantorOwnerRead.data ? [guarantorOwnerRead.data] : undefined,
    query: { enabled: configured && Boolean(guarantorOwnerRead.data), retry: false },
  });

  const stakeRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "requiredStake",
    args: parsedTradeId === undefined || parsedCoverage === undefined ? undefined : [parsedTradeId, parsedCoverage],
    query: { enabled: configured && Boolean(trade) && parsedTradeId !== undefined && parsedCoverage !== undefined, retry: false },
  });

  const tierSurchargeRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "premiumTierSurchargeBps",
    args: parsedAmount === undefined ? undefined : [parsedAmount],
    query: { enabled: configured && parsedAmount !== undefined, retry: false },
  });

  const guarantorOpenStakeRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "openStakeBySubject",
    args: address ? [address] : undefined,
    query: { enabled: configured && Boolean(address), refetchInterval: 4_000 },
  });

  const maxOpenStakeRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "maxOpenStake",
    query: { enabled: configured, refetchInterval: 4_000 },
  });

  const remainingCapacity =
    guarantorOpenStakeRead.data !== undefined && maxOpenStakeRead.data !== undefined
      ? (guarantorOpenStakeRead.data < maxOpenStakeRead.data ? maxOpenStakeRead.data - guarantorOpenStakeRead.data : 0n)
      : undefined;

  const withdrawalRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "pendingWithdrawals",
    args: address ? [address] : undefined,
    query: { enabled: configured && Boolean(address), refetchInterval: 4_000 },
  });

  // Hide every previous hash while the wallet prompt is open. The shared feedback hook
  // prioritizes a resolved receipt over isSubmitting, so the page must not pass a stale hash.
  const feedback = useTransactionFeedback({
    hash: isSubmitting ? undefined : activeHash,
    isSubmitting,
    writeError: submissionError,
    successLabel: successLabel?.[locale],
  });
  const busy = submissionLocked || feedback.phase === "submitting" || feedback.phase === "confirming";

  useEffect(() => {
    const operation = submissionGate.current();
    if (!operation) return;

    if (feedback.phase === "error") {
      if (feedback.hash && !submissionGate.matches(feedback.hash)) return;
      submissionGate.finish(operation.id);
      window.setTimeout(() => setSubmissionLocked(false), 0);
      return;
    }

    if (feedback.phase !== "success" || !feedback.receipt || !feedback.hash) return;
    if (!submissionGate.matches(feedback.hash) || processedReceipt.current === feedback.hash) return;
    processedReceipt.current = feedback.hash;

    // Only the receipt belonging to the create operation may select a new trade.
    if (operation.kind === "create") {
      const created = parseTradeCreated(feedback.receipt, CONTRACT_ADDRESSES.guaranteeEscrow, guaranteeEscrowAbi);
      if (created) window.setTimeout(() => updateTradeId(created.args.tradeId.toString()), 0);
    }

    submissionGate.finish(operation.id);
    window.setTimeout(() => setSubmissionLocked(false), 0);
    void tradeRead.refetch();
    void withdrawalRead.refetch();
  }, [feedback, submissionGate, tradeRead, withdrawalRead]);

  const readiness = (authorized: boolean, stateValid: boolean, inputValid: boolean, unauthorizedReason?: string) =>
    getWriteReadiness({
      configured,
      connected: isConnected,
      rightChain,
      busy,
      authorized,
      stateValid,
      inputValid,
      reasons: unauthorizedReason ? { unauthorized: unauthorizedReason } : undefined,
      locale,
    });

  const createReady = readiness(
    sameAddress(address, buyerOwnerRead.data),
    true,
    parsedBuyerId !== undefined && parsedSellerId !== undefined && parsedAmount !== undefined
      && parsedMaxPremium !== undefined && Boolean(quote?.[3])
      && Boolean(buyerOwnerRead.data && sellerOwnerRead.data)
      && !sameAddress(buyerOwnerRead.data, sellerOwnerRead.data),
    buyerOwnerRead.data ? m.buyerUnauthorized : m.buyerCheck,
  );

  const actionReady = (action: TradeAction, authorized = true, inputValid = parsedTradeId !== undefined, reason?: string) =>
    readiness(authorized, Boolean(stateMeta?.actions.some((item) => item.action === action)), inputValid && Boolean(trade), reason);

  const buyer = sameAddress(address, trade?.buyerSubject);
  const seller = sameAddress(address, trade?.sellerSubject);
  const guarantorOwner = sameAddress(address, guarantorOwnerRead.data);
  const independentGuarantor = Boolean(
    guarantorOwnerRead.data
      && !sameAddress(guarantorOwnerRead.data, trade?.buyerSubject)
      && !sameAddress(guarantorOwnerRead.data, trade?.sellerSubject),
  );
  const guarantorPoHConfirmed = guarantorPoHRead.data === true;
  const guaranteeReady = actionReady(
    "guarantee",
    guarantorOwner && independentGuarantor && guarantorPoHConfirmed,
    parsedGuarantorId !== undefined && parsedCoverage !== undefined && parsedPremium !== undefined
      && stakeRead.data !== undefined && Boolean(trade)
      && parsedCoverage >= (trade?.minCoverage ?? ZERO)
      && parsedPremium >= (trade?.referencePremium ?? ZERO)
      && parsedPremium <= (trade?.maxPremium ?? ZERO),
    !guarantorOwnerRead.data ? m.guarantorCheck
      : !guarantorOwner || !independentGuarantor ? m.guarantorUnauthorized
        : guarantorPoHRead.isLoading ? t.poh.checking
          : guarantorPoHRead.error ? t.poh.unavailable : t.poh.requiredGuarantor,
  );

  const startWrite = async (kind: TradeOperationKind, label: Record<Locale, string>, send: () => Promise<Hash>) => {
    // The gate closes the same-tick gap before React can render disabled buttons.
    const operation = submissionGate.begin(kind);
    if (!operation) return;

    // Clear both wagmi and page-owned transaction state before opening the wallet.
    write.reset();
    setActiveHash(undefined);
    setSubmissionError(null);
    setSuccessLabel(label);
    setSubmissionLocked(true);
    setIsSubmitting(true);

    try {
      const hash = await send();
      if (!submissionGate.bindHash(operation.id, hash)) return;
      setActiveHash(hash);
      setIsSubmitting(false);
    } catch (cause) {
      if (!submissionGate.finish(operation.id)) return;
      setSubmissionError(cause instanceof Error ? cause : new Error(String(cause)));
      setIsSubmitting(false);
      setSubmissionLocked(false);
    }
  };

  const createTrade = () => {
    if (!createReady.ready || parsedBuyerId === undefined || parsedSellerId === undefined
      || parsedAmount === undefined || parsedMaxPremium === undefined) return;
    void startWrite("create", bilingual(enTradeMessages.createSuccess, TRADE_MESSAGES["zh-CN"].createSuccess), () => write.writeContractAsync({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "createTrade",
      args: [parsedBuyerId, parsedSellerId, parsedAmount, parsedMaxPremium],
    }));
  };

  const runSimpleAction = (action: WorkflowAction, label: Record<Locale, string>, guard: WriteReadiness) => {
    if (!guard.ready || parsedTradeId === undefined) return;
    if (action === "fund") {
      if (!trade?.amount) return;
      void startWrite("fund", label, () => write.writeContractAsync({
        address: CONTRACT_ADDRESSES.guaranteeEscrow,
        abi: guaranteeEscrowAbi,
        functionName: "fund",
        args: [parsedTradeId],
        value: trade.amount,
      }));
      return;
    }
    void startWrite(action, label, () => write.writeContractAsync({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: ACTION_FUNCTIONS[action],
      args: [parsedTradeId],
    }));
  };

  const offerGuarantee = () => {
    if (!guaranteeReady.ready || parsedTradeId === undefined || parsedGuarantorId === undefined
      || parsedCoverage === undefined || parsedPremium === undefined || stakeRead.data === undefined) return;
    void startWrite("guarantee", bilingual(enTradeMessages.guaranteeSuccess, TRADE_MESSAGES["zh-CN"].guaranteeSuccess), () => write.writeContractAsync({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "guarantee",
      args: [parsedTradeId, parsedGuarantorId, parsedCoverage, parsedPremium],
      value: stakeRead.data,
    }));
  };

  const withdrawReady = readiness(true, true, Boolean(address && withdrawalRead.data && withdrawalRead.data > ZERO));
  const withdraw = () => {
    if (!withdrawReady.ready || !address) return;
    void startWrite("withdraw", bilingual(enTradeMessages.withdrawSuccess, TRADE_MESSAGES["zh-CN"].withdrawSuccess), () => write.writeContractAsync({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "withdraw",
      args: [address],
    }));
  };

  const simpleActions: Array<{ action: WorkflowAction; label: string; success: Record<Locale, string>; guard: WriteReadiness }> = [
    { action: "acceptTrade", label: m.sellerAccept, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.sellerAccept }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].sellerAccept })), guard: actionReady("acceptTrade", seller, true, m.sellerOnlyAccept) },
    { action: "fund", label: message(m.buyerFund, { amount: eth(trade?.amount) }), success: bilingual(message(enTradeMessages.actionSuccess, { action: message(enTradeMessages.buyerFund, { amount: eth(trade?.amount) }) }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: message(TRADE_MESSAGES["zh-CN"].buyerFund, { amount: eth(trade?.amount) }) })), guard: actionReady("fund", buyer, Boolean(trade?.amount), m.buyerOnlyFund) },
    { action: "acceptGuarantee", label: m.sellerAcceptGuarantee, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.sellerAcceptGuarantee }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].sellerAcceptGuarantee })), guard: actionReady("acceptGuarantee", seller, true, m.sellerOnlyGuarantee) },
    { action: "deliver", label: m.sellerDeliver, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.sellerDeliver }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].sellerDeliver })), guard: actionReady("deliver", seller, true, m.sellerOnlyDeliver) },
    { action: "confirm", label: m.buyerConfirm, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.buyerConfirm }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].buyerConfirm })), guard: actionReady("confirm", buyer, true, m.buyerOnlyConfirm) },
  ];

  const timeoutActions: Partial<Record<number, { action: SimpleAction; label: string; success: Record<Locale, string> }>> = {
    0: { action: "timeoutCancelUnaccepted", label: m.cancelAcceptance, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.cancelAcceptance }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].cancelAcceptance })) },
    1: { action: "timeoutCancelUnfunded", label: m.cancelFunding, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.cancelFunding }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].cancelFunding })) },
    2: { action: "timeoutRefund", label: m.refundGuarantee, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.refundGuarantee }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].refundGuarantee })) },
    3: { action: "timeoutRejectGuarantee", label: m.rejectGuarantee, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.rejectGuarantee }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].rejectGuarantee })) },
    4: { action: "timeoutRefund", label: m.refundDelivery, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.refundDelivery }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].refundDelivery })) },
    5: { action: "timeoutAutoRelease", label: m.autoRelease, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.autoRelease }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].autoRelease })) },
    6: { action: "timeoutVoidDispute", label: m.voidDispute, success: bilingual(message(enTradeMessages.actionSuccess, { action: enTradeMessages.voidDispute }), message(TRADE_MESSAGES["zh-CN"].actionSuccess, { action: TRADE_MESSAGES["zh-CN"].voidDispute })) },
  };
  const timeout = stateMeta ? timeoutActions[stateMeta.value] : undefined;
  const retryReady = actionReady("retryOutcome", true, Boolean(trade?.outcomePending));

  return (
    <main className="page page-wide space-y-6">
      <div className="page-head">
        <h1 className="page-title">{t.pages.tradeTitle}</h1>
        <p className="page-sub">{t.pages.tradeSubtitle}</p>
        {!isConnected && <p className="text-sm mt-2" role="status">{m.walletDisconnected}</p>}
        {isConnected && !rightChain && <p className="form-error mt-2" role="alert">{message(m.wrongChain, { chain: activeChain.name, chainId: activeChain.id })}</p>}
      </div>

      <section className="card space-y-3">
        <h2 className="card-title">{m.createSection}</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="field-label">{m.buyerAgentId}<input aria-label={m.buyerAgentId} value={buyerId} onChange={(event) => setBuyerId(event.target.value)} className="field-input" /></label>
          <label className="field-label">{m.sellerAgentId}<input aria-label={m.sellerAgentId} value={sellerId} onChange={(event) => setSellerId(event.target.value)} className="field-input" /></label>
          <label className="field-label">{m.tradeAmount}<input aria-label={m.tradeAmount} value={amount} onChange={(event) => setAmount(event.target.value)} className="field-input" /></label>
          <label className="field-label">{m.maximumPremium}<input aria-label={m.maximumPremium} value={maxPremium} onChange={(event) => setMaxPremium(event.target.value)} className="field-input" /></label>
        </div>
        <div className="callout text-sm" aria-label={m.guaranteePreview}>
          <strong>{m.quotePreview}</strong>
          {quote ? (
            <dl className="detail-grid mt-2">
              <div><dt className="text-gray-500">{m.minimumCoverage}</dt><dd>{percent(quote[0])}</dd></div>
              <div><dt className="text-gray-500">{m.minimumStake}</dt><dd>{eth(quote[1])}</dd></div>
              <div><dt className="text-gray-500">{m.referencePremium}</dt><dd>{eth(quote[2])}</dd></div>
              <div><dt className="text-gray-500">{m.tierSurcharge}</dt><dd>{tierSurchargeRead.data === undefined ? "—" : `${Number(tierSurchargeRead.data) / 100}%`}</dd></div>
              <div><dt className="text-gray-500">{m.insurable}</dt><dd>{quote[3] ? m.yes : m.noAdjustPremium}</dd></div>
            </dl>
          ) : <p className="text-gray-500 mt-1">{m.quotePrompt}</p>}
        </div>
        <ActionButton label={m.createTrade} readiness={createReady} onClick={createTrade} primary />
        {!createReady.ready && <p className="form-hint">{createReady.reason}</p>}
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="card-title">{m.querySection}</h2>
          <label className="field-label mt-2">{m.tradeId}<input aria-label={m.tradeId} placeholder={m.tradeIdPlaceholder} value={tradeId} onChange={(event) => updateTradeId(event.target.value)} className="field-input" /></label>
          {tradeRead.isLoading && <p className="form-hint mt-2">{m.loadingTrade}</p>}
          {tradeRead.error && parsedTradeId !== undefined && <p className="form-error mt-2" role="alert">{m.tradeReadError}{tradeRead.error.message}</p>}
        </div>

        <ol className="state-track" aria-label={m.allTradeStates}>
          {TRADE_STATE_META.map((item) => (
            <li key={item.value} className="state-step" aria-current={stateMeta?.value === item.value ? "step" : undefined}>
              <span className="font-mono">{item.value}</span> · <strong>{TRADE_STATE_LABELS[locale][item.key]}</strong><br />
              <span className="text-gray-500">{item.key}{item.terminal ? ` · ${m.terminal}` : ""}</span>
            </li>
          ))}
        </ol>

        {trade && stateMeta && (
          <>
            <div className="callout text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{m.trade} #{trade.id.toString()} · {TRADE_STATE_LABELS[locale][stateMeta.key]}</strong>
                <span className="font-mono text-gray-500">{stateMeta.key}</span>
              </div>
              <dl className="detail-grid mt-3">
                <div><dt className="text-gray-500">{m.amountAndPremium}</dt><dd>{eth(trade.amount)} / {eth(trade.maxPremium)}</dd></div>
                <div><dt className="text-gray-500">{m.buyerAndSubject}</dt><dd>#{trade.buyerAgentId.toString()} · {shortAddress(trade.buyerSubject)}</dd></div>
                <div><dt className="text-gray-500">{m.sellerAndSubject}</dt><dd>#{trade.sellerAgentId.toString()} · {shortAddress(trade.sellerSubject)}</dd></div>
                <div><dt className="text-gray-500">{m.guarantorAndSubject}</dt><dd>{trade.guarantorSubject === "0x0000000000000000000000000000000000000000" ? m.noQuote : `#${trade.guarantorAgentId.toString()} · ${shortAddress(trade.guarantorSubject)}`}</dd></div>
                <div><dt className="text-gray-500">{m.coverageActual}</dt><dd>{percent(trade.minCoverage)} / {percent(trade.coverage)}</dd></div>
                <div><dt className="text-gray-500">{m.premiumActual}</dt><dd>{eth(trade.referencePremium)} / {eth(trade.premium)}</dd></div>
                <div><dt className="text-gray-500">{m.guaranteeStake}</dt><dd>{eth(trade.stake)}</dd></div>
                <div><dt className="text-gray-500">{m.reputationOutcome}</dt><dd>{trade.outcomePending ? m.outcomePending : trade.outcomeRecorded ? m.outcomeRecorded : m.outcomeMissing}</dd></div>
              </dl>
            </div>

            <div className="space-y-3">
              <h3 className="section-title">{m.currentActions}</h3>
              <div className="action-row">
                {simpleActions.map((item) => (
                  <ActionButton key={item.action} label={item.label} readiness={item.guard} onClick={() => runSimpleAction(item.action, item.success, item.guard)} primary={item.guard.ready} />
                ))}
              </div>

              <div className="callout space-y-3">
                <h3 className="section-title">{m.guarantorQuote}</h3>
                <div className="grid md:grid-cols-3 gap-3">
                  <label className="field-label">{m.guarantorAgentId}<input aria-label={m.guarantorAgentId} value={guarantorAgentId} onChange={(event) => setGuarantorAgentId(event.target.value)} className="field-input" /></label>
                  <label className="field-label">{m.coverage}<input aria-label={m.coverage} value={coverage} onChange={(event) => setCoverage(event.target.value)} className="field-input" /></label>
                  <label className="field-label">{m.premium}<input aria-label={m.premium} value={premium} onChange={(event) => setPremium(event.target.value)} className="field-input" /></label>
                </div>
                <p className="text-sm">{m.exactStake}<strong>{eth(stakeRead.data)}</strong></p>
                <p className="text-sm">{m.remainingCapacity}<strong>{remainingCapacity === undefined ? "—" : eth(remainingCapacity)}</strong> ({m.limit} {eth(maxOpenStakeRead.data)})</p>
                <ActionButton label={message(m.offerGuarantee, { stake: eth(stakeRead.data) })} readiness={guaranteeReady} onClick={offerGuarantee} primary />
                {!guaranteeReady.ready && <p className="text-xs text-gray-500">{guaranteeReady.reason}</p>}
              </div>

              {stateMeta.value === 5 && (
                <div className="callout">
                  <strong>{m.disputeQuestion}</strong>
                  <p className="form-hint mt-1">{m.disputeHelp}</p>
                  {buyer || seller ? <Link className="button button-warning inline-block mt-2 no-underline" href={`/disputes?tradeId=${trade.id.toString()}`}>{message(m.goToDisputes, { id: trade.id })}</Link> : <p className="text-sm mt-2">{m.disputeUnauthorized}</p>}
                </div>
              )}

              {timeout && (
                <div className="callout">
                  <strong>{m.timeoutTitle}</strong>
                  <p className="form-hint my-2">{m.timeoutHelp}</p>
                  {(() => {
                    const guard = actionReady(timeout.action as TradeAction);
                    return <ActionButton label={timeout.label} readiness={guard} onClick={() => runSimpleAction(timeout.action, timeout.success, guard)} />;
                  })()}
                </div>
              )}

              {trade.outcomePending && (
                <div className="callout">
                  <strong>{m.outcomePendingTitle}</strong>
                  <p className="form-hint my-2">{m.outcomeRetryHelp}</p>
                  <ActionButton label={m.retryOutcome} readiness={retryReady} onClick={() => runSimpleAction("retryOutcome", bilingual(enTradeMessages.retrySuccess, TRADE_MESSAGES["zh-CN"].retrySuccess), retryReady)} />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="card-title">{m.withdrawSection}</h2>
        <p className="text-sm">{m.pendingWithdrawals}<strong>{eth(withdrawalRead.data)}</strong></p>
        <p className="form-hint">{message(m.withdrawalRecipient, { address: address ?? "—" })}</p>
        <ActionButton label={m.withdrawAll} readiness={withdrawReady} onClick={withdraw} primary />
      </section>

      <TransactionStatus feedback={feedback} />
    </main>
  );
}
