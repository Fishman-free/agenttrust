"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatEther, type Hash } from "viem";
import { Camera, Check, Copy, Receipt, Trash2, TriangleAlert } from "lucide-react";
import { agentRegistryAbi } from "@/lib/abi";
import { CHAIN_ID, CONTRACT_ADDRESSES, WRITES_ENABLED, activeChain } from "@/lib/config";
import { fileToAvatar, useProfile } from "@/lib/profile";
import { useTxHistory, type TxEntry, type TxStatus } from "@/lib/tx-history";
import { useAgentIdentity } from "@/lib/agent-identity";
import { formatMessage, useLocale } from "@/lib/locale";
import { AccountAvatar } from "./account-avatar";
import { TransactionStatus, useTransactionFeedback } from "./transaction-status";

const EXPLORER = (activeChain as { blockExplorers?: { default?: { url: string } } }).blockExplorers?.default?.url;

export function shortAddress(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

function relativeTime(timestamp: number, locale: string, t: { now: string; minutes: string; hours: string; days: string }) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t.now;
  if (minutes < 60) return formatMessage(t.minutes, { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatMessage(t.hours, { count: hours });
  return formatMessage(t.days, { count: Math.floor(hours / 24) });
}

/* ------------------------------ 资料面板 ------------------------------ */

/**
 * 资料面板。
 * 由外层用 `key={address + ready}` 挂载：账户切换或本地资料加载完成时重新挂载，
 * 草稿自然跟着初始化，不需要额外的同步 effect。
 */
export function ProfilePanel() {
  const { dictionary: t } = useLocale();
  const a = t.account;
  const { address } = useAccount();
  const profile = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(profile.nickname);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!copied && !saved) return;
    const timer = window.setTimeout(() => { setCopied(false); setSaved(false); }, 1800);
    return () => window.clearTimeout(timer);
  }, [copied, saved]);

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    setUploading(true);
    try {
      profile.setAvatar(await fileToAvatar(file));
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "too-large" ? a.avatarTooLarge : a.avatarInvalid);
    } finally {
      setUploading(false);
    }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="panel">
      <div className="profile-editor">
        <div className="profile-avatar-wrap">
          <AccountAvatar address={address} avatar={profile.avatar} nickname={draft} size={72} />
          {uploading && <span className="profile-avatar-veil"><span className="spin-dot" /></span>}
        </div>
        <div className="profile-avatar-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="visually-hidden"
            aria-label={a.avatarUpload}
            onChange={(event) => void onPickFile(event.target.files?.[0])}
          />
          <button type="button" className="chip-button" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Camera size={14} aria-hidden="true" />
            {a.avatarUpload}
          </button>
          {profile.avatar && (
            <button type="button" className="chip-button chip-button-quiet" onClick={() => profile.setAvatar(undefined)}>
              <Trash2 size={14} aria-hidden="true" />
              {a.avatarRemove}
            </button>
          )}
        </div>
      </div>

      <label className="field-label" htmlFor="account-nickname">{a.nickname}</label>
      <div className="profile-nickname-row">
        <input
          id="account-nickname"
          className="field-input"
          value={draft}
          maxLength={32}
          placeholder={a.nicknamePlaceholder}
          onChange={(event) => { setDraft(event.target.value); setSaved(false); }}
        />
        <button
          type="button"
          className="button button-primary button-compact"
          disabled={draft === profile.nickname}
          onClick={() => { profile.setNickname(draft.trim()); setSaved(true); }}
        >
          {saved ? <Check size={14} aria-hidden="true" /> : null}
          {saved ? t.common.saved : t.common.save}
        </button>
      </div>
      <p className="form-hint">{a.nicknameHint}</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="profile-address">
        <span className="mono">{address ? shortAddress(address) : "—"}</span>
        <button type="button" className="chip-button chip-button-quiet" onClick={() => void copyAddress()}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? a.addressCopied : a.copyAddress}
        </button>
      </div>
      <p className="form-hint">{a.localOnly}</p>
    </div>
  );
}

/* ---------------------------- 交易记录面板 ---------------------------- */

const STATUS_LABEL: Record<TxStatus, { className: string }> = {
  pending: { className: "tx-pill tx-pill-pending" },
  success: { className: "tx-pill tx-pill-success" },
  error: { className: "tx-pill tx-pill-error" },
};

/** 单条待确认交易的落定监听；每条记录各占一个组件，符合 Hook 规则。 */
function PendingTxWatcher({ hash, onSettled }: { hash: Hash; onSettled: (status: TxStatus) => void }) {
  const receipt = useWaitForTransactionReceipt({ hash, query: { enabled: true } });
  useEffect(() => {
    if (receipt.isSuccess && receipt.data) onSettled(receipt.data.status === "reverted" ? "error" : "success");
    if (receipt.isError) onSettled("error");
  }, [receipt.isSuccess, receipt.isError, receipt.data, onSettled]);
  return null;
}

export function TransactionsPanel() {
  const { dictionary: t } = useLocale();
  const a = t.account;
  const { entries, markStatus, clear } = useTxHistory();

  return (
    <div className="panel">
      {entries.length === 0 ? (
        <div className="empty-state" role="status">
          <Receipt size={22} aria-hidden="true" />
          <p className="empty-title">{a.txEmpty}</p>
          <p className="form-hint">{a.txEmptyHint}</p>
        </div>
      ) : (
        <>
          <ul className="tx-list" role="list">
            {entries.map((entry) => <TxRow key={entry.hash} entry={entry} onSettled={markStatus} />)}
          </ul>
          <div className="panel-foot">
            <button type="button" className="chip-button chip-button-quiet" onClick={clear}>
              <Trash2 size={14} aria-hidden="true" />
              {a.txClear}
            </button>
            <span className="form-hint">{a.localOnly}</span>
          </div>
        </>
      )}
    </div>
  );
}

function TxRow({
  entry,
  onSettled,
}: {
  entry: TxEntry;
  onSettled: (hash: Hash, status: TxStatus) => void;
}) {
  const { locale, dictionary: t } = useLocale();
  const a = t.account;
  const settled = (status: TxStatus) => onSettled(entry.hash, status);
  const statusText = entry.status === "pending" ? a.txPending : entry.status === "success" ? a.txSuccess : a.txFailed;

  return (
    <li className="tx-row">
      {entry.status === "pending" && <PendingTxWatcher hash={entry.hash} onSettled={settled} />}
      <div className="tx-main">
        <span className="tx-label">{entry.label}</span>
        <span className="tx-meta">
          <span className={STATUS_LABEL[entry.status].className}>{statusText}</span>
          <span>{relativeTime(entry.timestamp, locale, { now: a.txNow, minutes: a.txMinutes, hours: a.txHours, days: a.txDays })}</span>
        </span>
      </div>
      <div className="tx-side">
        <span className="tx-hash mono">{shortAddress(entry.hash)}</span>
        {EXPLORER ? (
          <a className="tx-link" href={`${EXPLORER}/tx/${entry.hash}`} target="_blank" rel="noopener noreferrer">
            {a.txView}
          </a>
        ) : (
          <span className="tx-date">{new Date(entry.timestamp).toLocaleString(locale)}</span>
        )}
      </div>
    </li>
  );
}

/* --------------------------- 注销并取回押金 --------------------------- */

export function DeregisterPanel({ onDone }: { onDone?: () => void }) {
  const { dictionary: t } = useLocale();
  const a = t.account;
  const ui = t.agents;
  const { address, chainId, isConnected } = useAccount();
  const identity = useAgentIdentity();
  const history = useTxHistory();
  const [flowError, setFlowError] = useState<string>();

  const deregister = useWriteContract();
  const withdraw = useWriteContract();

  const deregisterFeedback = useTransactionFeedback({
    hash: deregister.data,
    isSubmitting: deregister.isPending,
    writeError: deregister.error,
    successLabel: a.deregisterDone,
  });
  const withdrawFeedback = useTransactionFeedback({
    hash: withdraw.data,
    isSubmitting: withdraw.isPending,
    writeError: withdraw.error,
    successLabel: a.withdrawDone,
  });
  const feedback = withdraw.data ? withdrawFeedback : deregisterFeedback;

  const { activeSubject, deregistered, pendingWithdrawal, recovery, hasActiveTrades, hasOpenCommitments } = identity;
  const hasLiveRecovery = Boolean(recovery?.[7]);
  const obligation = hasActiveTrades ? ui.activeTrades : hasOpenCommitments ? ui.openVotes : undefined;
  const blocker = !activeSubject
    ? a.deregisterRequiresIdentity
    : deregistered
      ? undefined
      : hasLiveRecovery
        ? ui.recoveryBlocks
        : obligation;

  const wrongChain = isConnected && chainId !== CHAIN_ID;
  const busy = deregister.isPending || withdraw.isPending
    || feedback.phase === "confirming";

  useEffect(() => {
    if (feedback.phase !== "success") return;
    void identity.refetchAll();
  }, [feedback.phase, identity]);

  useEffect(() => {
    if (withdraw.data && withdrawFeedback.phase === "success") onDone?.();
  }, [withdraw.data, withdrawFeedback.phase, onDone]);

  async function run(action: "deregister" | "withdraw") {
    if (!address) return;
    setFlowError(undefined);
    const label = action === "deregister"
      ? a.deregisterAction
      : formatMessage(a.withdrawAction, { amount: formatEther(pendingWithdrawal ?? 0n) });
    try {
      const hash = await (action === "deregister" ? deregister : withdraw).writeContractAsync({
        address: CONTRACT_ADDRESSES.agentRegistry,
        abi: agentRegistryAbi,
        functionName: action,
        args: action === "deregister" ? [] : [address],
      });
      history.record({ hash, label, kind: action, status: "pending", chainId: chainId ?? CHAIN_ID });
    } catch (cause) {
      setFlowError(cause instanceof Error ? cause.message.split("\n")[0] : String(cause));
    }
  }

  const pendingAmount = pendingWithdrawal ?? 0n;
  const step = deregistered || pendingAmount > 0n ? 2 : 1;

  return (
    <div className="panel">
      <div className="callout callout-danger">
        <p className="callout-title">
          <TriangleAlert size={15} aria-hidden="true" />
          {a.deregisterTitle}
        </p>
        <p className="form-hint">{a.deregisterWarning}</p>
      </div>

      <ol className="state-track" aria-label={a.deregisterTitle}>
        <li className="state-step" aria-current={step === 1 ? "step" : undefined}>1 · {a.deregisterAction}</li>
        <li className="state-step" aria-current={step === 2 ? "step" : undefined}>2 · {a.withdrawAction}</li>
      </ol>

      <dl className="detail-grid">
        <div>
          <dt>{ui.lockedDeposit}</dt>
          <dd>{identity.lockedDeposit === undefined ? "—" : `${formatEther(identity.lockedDeposit)} ETH`}</dd>
        </div>
        <div>
          <dt>{ui.pending}</dt>
          <dd>{pendingAmount > 0n ? `${formatEther(pendingAmount)} ETH` : "—"}</dd>
        </div>
      </dl>

      {!deregistered && activeSubject && (
        <button
          type="button"
          className="button button-danger"
          disabled={!WRITES_ENABLED || busy || wrongChain || Boolean(blocker)}
          onClick={() => void run("deregister")}
        >
          {deregister.isPending || (deregister.data && feedback.phase === "confirming")
            ? a.deregistering
            : a.deregisterAction}
        </button>
      )}

      {pendingAmount > 0n && (
        <button
          type="button"
          className="button button-primary"
          disabled={!WRITES_ENABLED || busy || wrongChain}
          onClick={() => void run("withdraw")}
        >
          {withdraw.isPending || (withdraw.data && feedback.phase === "confirming")
            ? a.withdrawing
            : formatMessage(a.withdrawAction, { amount: formatEther(pendingAmount) })}
        </button>
      )}

      {blocker && !deregistered && <p className="form-warning" role="status">{formatMessage(a.deregisterBlocked, { reason: blocker })}</p>}
      {flowError && <p className="form-error" role="alert">{flowError}</p>}

      <TransactionStatus feedback={feedback} />
    </div>
  );
}
