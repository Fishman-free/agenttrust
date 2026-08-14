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
  const [successLabel, setSuccessLabel] = useState<string>();
  const [activeHash, setActiveHash] = useState<Hash>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const [submissionError, setSubmissionError] = useState<Error | null>(null);
  const [submissionGate] = useState(() => new TradeSubmissionGate());
  const processedReceipt = useRef<Hash | undefined>(undefined);

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

  const stakeRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "requiredStake",
    args: parsedTradeId === undefined || parsedCoverage === undefined ? undefined : [parsedTradeId, parsedCoverage],
    query: { enabled: configured && Boolean(trade) && parsedTradeId !== undefined && parsedCoverage !== undefined, retry: false },
  });

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
    successLabel,
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
      if (created) window.setTimeout(() => setTradeId(created.args.tradeId.toString()), 0);
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
    });

  const createReady = readiness(
    sameAddress(address, buyerOwnerRead.data),
    true,
    parsedBuyerId !== undefined && parsedSellerId !== undefined && parsedAmount !== undefined
      && parsedMaxPremium !== undefined && Boolean(quote?.[3])
      && Boolean(buyerOwnerRead.data && sellerOwnerRead.data)
      && !sameAddress(buyerOwnerRead.data, sellerOwnerRead.data),
    buyerOwnerRead.data ? "当前账户不是买家 Agent 的责任主体。" : "正在确认买家 Agent 的责任主体。",
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
  const guaranteeReady = actionReady(
    "guarantee",
    guarantorOwner && independentGuarantor,
    parsedGuarantorId !== undefined && parsedCoverage !== undefined && parsedPremium !== undefined
      && stakeRead.data !== undefined && Boolean(trade)
      && parsedCoverage >= (trade?.minCoverage ?? ZERO)
      && parsedPremium >= (trade?.referencePremium ?? ZERO)
      && parsedPremium <= (trade?.maxPremium ?? ZERO),
    guarantorOwnerRead.data
      ? "当前账户不是该担保 Agent 的责任主体，或交易方不能自担保。"
      : "正在确认担保 Agent 的责任主体。",
  );

  const startWrite = async (kind: TradeOperationKind, label: string, send: () => Promise<Hash>) => {
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
    void startWrite("create", "交易创建成功，已自动载入 Trade ID。", () => write.writeContractAsync({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "createTrade",
      args: [parsedBuyerId, parsedSellerId, parsedAmount, parsedMaxPremium],
    }));
  };

  const runSimpleAction = (action: WorkflowAction, label: string, guard: WriteReadiness) => {
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
    void startWrite("guarantee", "担保报价已确认。", () => write.writeContractAsync({
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
    void startWrite("withdraw", "余额已提取到当前账户。", () => write.writeContractAsync({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "withdraw",
      args: [address],
    }));
  };

  const simpleActions: Array<{ action: WorkflowAction; label: string; guard: WriteReadiness }> = [
    { action: "acceptTrade", label: "卖家接受交易", guard: actionReady("acceptTrade", seller, true, "仅卖家责任主体可接受交易。") },
    { action: "fund", label: `买家托管 ${eth(trade?.amount)}`, guard: actionReady("fund", buyer, Boolean(trade?.amount), "仅买家责任主体可付款。") },
    { action: "acceptGuarantee", label: "卖家接受担保", guard: actionReady("acceptGuarantee", seller, true, "仅卖家责任主体可接受担保。") },
    { action: "deliver", label: "卖家确认交付", guard: actionReady("deliver", seller, true, "仅卖家责任主体可交付。") },
    { action: "confirm", label: "买家确认完成", guard: actionReady("confirm", buyer, true, "仅买家责任主体可确认。") },
  ];

  const timeoutActions: Partial<Record<number, { action: SimpleAction; label: string }>> = {
    0: { action: "timeoutCancelUnaccepted", label: "接受窗口结束后取消" },
    1: { action: "timeoutCancelUnfunded", label: "付款窗口结束后取消" },
    2: { action: "timeoutRefund", label: "担保窗口结束后退款" },
    3: { action: "timeoutRejectGuarantee", label: "接受窗口结束后拒绝担保" },
    4: { action: "timeoutRefund", label: "交付窗口结束后退款" },
    5: { action: "timeoutAutoRelease", label: "确认窗口结束后自动放款" },
    6: { action: "timeoutVoidDispute", label: "未开案超时后作废" },
  };
  const timeout = stateMeta ? timeoutActions[stateMeta.value] : undefined;
  const retryReady = actionReady("retryOutcome", true, Boolean(trade?.outcomePending));

  return (
    <main className="page page-wide space-y-6">
      <div className="page-head">
        <h1 className="page-title">担保交易闭环</h1>
        <p className="page-sub">创建、接受、托管、担保、交付、确认、超时与提现均以链上状态和责任主体为准。</p>
        {!isConnected && <p className="text-sm mt-2" role="status">请使用页首钱包控件连接钱包；本页不会创建重复连接器。</p>}
        {isConnected && !rightChain && <p className="form-error mt-2" role="alert">请在页首切换至 {activeChain.name}（Chain ID {activeChain.id}）。</p>}
      </div>

      <section className="card space-y-3">
        <h2 className="card-title">1. 创建交易（买家）</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="field-label">买家 Agent ID<input aria-label="买家 Agent ID" value={buyerId} onChange={(event) => setBuyerId(event.target.value)} className="field-input" /></label>
          <label className="field-label">卖家 Agent ID<input aria-label="卖家 Agent ID" value={sellerId} onChange={(event) => setSellerId(event.target.value)} className="field-input" /></label>
          <label className="field-label">交易金额（ETH）<input aria-label="交易金额（ETH）" value={amount} onChange={(event) => setAmount(event.target.value)} className="field-input" /></label>
          <label className="field-label">最高保费（ETH）<input aria-label="最高保费（ETH）" value={maxPremium} onChange={(event) => setMaxPremium(event.target.value)} className="field-input" /></label>
        </div>
        <div className="callout text-sm" aria-label="担保条款预览">
          <strong>quoteGuaranteeTerms 预览</strong>
          {quote ? (
            <dl className="detail-grid mt-2">
              <div><dt className="text-gray-500">最低覆盖率</dt><dd>{percent(quote[0])}</dd></div>
              <div><dt className="text-gray-500">最低质押</dt><dd>{eth(quote[1])}</dd></div>
              <div><dt className="text-gray-500">参考保费</dt><dd>{eth(quote[2])}</dd></div>
              <div><dt className="text-gray-500">可承保</dt><dd>{quote[3] ? "是" : "否（调整最高保费）"}</dd></div>
            </dl>
          ) : <p className="text-gray-500 mt-1">填写有效参数后显示链上报价。</p>}
        </div>
        <ActionButton label="创建交易" readiness={createReady} onClick={createTrade} primary />
        {!createReady.ready && <p className="form-hint">{createReady.reason}</p>}
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="card-title">2. 查询并推进交易</h2>
          <label className="field-label mt-2">Trade ID<input aria-label="Trade ID" placeholder="输入或创建后自动载入" value={tradeId} onChange={(event) => setTradeId(event.target.value)} className="field-input" /></label>
          {tradeRead.isLoading && <p className="form-hint mt-2">正在调用 getTrade…</p>}
          {tradeRead.error && parsedTradeId !== undefined && <p className="form-error mt-2" role="alert">无法读取该交易：{tradeRead.error.message}</p>}
        </div>

        <ol className="state-track" aria-label="全部交易状态">
          {TRADE_STATE_META.map((item) => (
            <li key={item.value} className="state-step" aria-current={stateMeta?.value === item.value ? "step" : undefined}>
              <span className="font-mono">{item.value}</span> · <strong>{item.label}</strong><br />
              <span className="text-gray-500">{item.key}{item.terminal ? " · 终态" : ""}</span>
            </li>
          ))}
        </ol>

        {trade && stateMeta && (
          <>
            <div className="callout text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>Trade #{trade.id.toString()} · {stateMeta.label}</strong>
                <span className="font-mono text-gray-500">{stateMeta.key}</span>
              </div>
              <dl className="detail-grid mt-3">
                <div><dt className="text-gray-500">金额 / 最高保费</dt><dd>{eth(trade.amount)} / {eth(trade.maxPremium)}</dd></div>
                <div><dt className="text-gray-500">买家 Agent / 主体</dt><dd>#{trade.buyerAgentId.toString()} · {shortAddress(trade.buyerSubject)}</dd></div>
                <div><dt className="text-gray-500">卖家 Agent / 主体</dt><dd>#{trade.sellerAgentId.toString()} · {shortAddress(trade.sellerSubject)}</dd></div>
                <div><dt className="text-gray-500">担保 Agent / 主体</dt><dd>{trade.guarantorSubject === "0x0000000000000000000000000000000000000000" ? "尚未报价" : `#${trade.guarantorAgentId.toString()} · ${shortAddress(trade.guarantorSubject)}`}</dd></div>
                <div><dt className="text-gray-500">最低 / 实际覆盖率</dt><dd>{percent(trade.minCoverage)} / {percent(trade.coverage)}</dd></div>
                <div><dt className="text-gray-500">参考 / 实际保费</dt><dd>{eth(trade.referencePremium)} / {eth(trade.premium)}</dd></div>
                <div><dt className="text-gray-500">担保质押</dt><dd>{eth(trade.stake)}</dd></div>
                <div><dt className="text-gray-500">信誉结果</dt><dd>{trade.outcomePending ? "待记录，可重试" : trade.outcomeRecorded ? "已记录" : "尚未产生"}</dd></div>
              </dl>
            </div>

            <div className="space-y-3">
              <h3 className="section-title">当前状态操作</h3>
              <div className="action-row">
                {simpleActions.map((item) => (
                  <ActionButton key={item.action} label={item.label} readiness={item.guard} onClick={() => runSimpleAction(item.action, `${item.label}成功。`, item.guard)} primary={item.guard.ready} />
                ))}
              </div>

              <div className="callout space-y-3">
                <h3 className="section-title">担保人报价</h3>
                <div className="grid md:grid-cols-3 gap-3">
                  <label className="field-label">担保 Agent ID<input aria-label="担保 Agent ID" value={guarantorAgentId} onChange={(event) => setGuarantorAgentId(event.target.value)} className="field-input" /></label>
                  <label className="field-label">覆盖率（%）<input aria-label="覆盖率（%）" value={coverage} onChange={(event) => setCoverage(event.target.value)} className="field-input" /></label>
                  <label className="field-label">保费（ETH）<input aria-label="保费（ETH）" value={premium} onChange={(event) => setPremium(event.target.value)} className="field-input" /></label>
                </div>
                <p className="text-sm">requiredStake 链上精确值：<strong>{eth(stakeRead.data)}</strong></p>
                <ActionButton label={`提供担保并质押 ${eth(stakeRead.data)}`} readiness={guaranteeReady} onClick={offerGuarantee} primary />
                {!guaranteeReady.ready && <p className="text-xs text-gray-500">{guaranteeReady.reason}</p>}
              </div>

              {stateMeta.value === 5 && (
                <div className="callout">
                  <strong>需要争议？</strong>
                  <p className="form-hint mt-1">争议保证金由争议页读取并精确提交。本页只传递 Trade ID，避免重复实现 bond 流程。</p>
                  {buyer || seller ? <Link className="button button-warning inline-block mt-2 no-underline" href={`/disputes?tradeId=${trade.id.toString()}`}>前往争议页（Trade #{trade.id.toString()}）</Link> : <p className="text-sm mt-2">仅买卖双方责任主体可发起争议。</p>}
                </div>
              )}

              {timeout && (
                <div className="callout">
                  <strong>无人值守超时动作</strong>
                  <p className="form-hint my-2">任何账户均可在合约窗口实际到期后调用；若尚未到期，链上会拒绝。</p>
                  {(() => {
                    const guard = actionReady(timeout.action as TradeAction);
                    return <ActionButton label={timeout.label} readiness={guard} onClick={() => runSimpleAction(timeout.action, `${timeout.label}成功。`, guard)} />;
                  })()}
                </div>
              )}

              {trade.outcomePending && (
                <div className="callout">
                  <strong>信誉结果仍待写入</strong>
                  <p className="form-hint my-2">结算本身已完成，可安全调用 retryOutcome 重试信誉结果。</p>
                  <ActionButton label="重试记录结果" readiness={retryReady} onClick={() => runSimpleAction("retryOutcome", "信誉结果重试已确认。", retryReady)} />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="card-title">3. 提取当前账户余额</h2>
        <p className="text-sm">pendingWithdrawals：<strong>{eth(withdrawalRead.data)}</strong></p>
        <p className="form-hint">收款地址固定为当前连接账户 {address ?? "—"}。</p>
        <ActionButton label="提取全部余额" readiness={withdrawReady} onClick={withdraw} primary />
      </section>

      <TransactionStatus feedback={feedback} />
    </main>
  );
}
