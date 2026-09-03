"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEther } from "viem";
import { useAccount, useDisconnect, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { agentRegistryAbi, guaranteeEscrowAbi, schellingVotingAbi } from "@/lib/abi";
import { CHAIN_ID, CONTRACT_ADDRESSES, WRITES_ENABLED, activeChain, isZeroAddress } from "@/lib/config";
import { formatMessage, useLocale } from "@/lib/locale";
import { useNickname } from "@/lib/nickname";
import { useTxHistory, useTxRecorder, type TxKind } from "@/lib/tx-history";
import { useTransactionFeedback } from "@/app/components/transaction-status";
import { WalletPicker } from "@/app/components/wallet-picker";
import { NetworkSwitchDialog } from "@/app/components/network-switch-dialog";

type MenuView = "root" | "nickname" | "transactions" | "deregister";
type RecoveryTuple = readonly [unknown, unknown, unknown, unknown, unknown, unknown, unknown, exists: boolean];

const ZERO = 0n;

export function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}

/** 由地址派生的稳定头像渐变：同一账户每次渲染都一致，无需任何网络资源。 */
export function avatarGradient(address: string): string {
  let hash = 0;
  for (let i = 2; i < address.length; i += 1) hash = (hash * 31 + address.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(150deg, hsl(${hue} 68% 58%), hsl(${(hue + 46) % 360} 72% 44%))`;
}

function useDepositStatus(address?: `0x${string}`) {
  const registry = CONTRACT_ADDRESSES.agentRegistry;
  const registryReady = !isZeroAddress(registry);
  const escrowReady = !isZeroAddress(CONTRACT_ADDRESSES.guaranteeEscrow);
  const votingReady = !isZeroAddress(CONTRACT_ADDRESSES.schellingVoting);
  const enabled = registryReady && Boolean(address);
  const args = address ? ([address] as const) : undefined;
  const query = (ready: boolean) => ({ enabled: ready && Boolean(address) });

  const { data: locked, refetch: refetchLocked } = useReadContract({
    address: registry, abi: agentRegistryAbi, functionName: "deposits", args, query: query(registryReady),
  });
  const { data: pending, refetch: refetchPending } = useReadContract({
    address: registry, abi: agentRegistryAbi, functionName: "pendingWithdrawals", args, query: query(registryReady),
  });
  const { data: activeSubject, refetch: refetchActive } = useReadContract({
    address: registry, abi: agentRegistryAbi, functionName: "activeSubjects", args, query: query(registryReady),
  });
  const { data: deregistered, refetch: refetchDeregistered } = useReadContract({
    address: registry, abi: agentRegistryAbi, functionName: "deregistered", args, query: query(registryReady),
  });
  const { data: ownRecovery, refetch: refetchRecovery } = useReadContract({
    address: registry, abi: agentRegistryAbi, functionName: "recoveryRequests", args, query: query(registryReady),
  });
  const { data: hasActiveTrades } = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow, abi: guaranteeEscrowAbi,
    functionName: "subjectHasActiveTrades", args, query: query(escrowReady),
  });
  const { data: hasOpenCommitments } = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting, abi: schellingVotingAbi,
    functionName: "subjectHasOpenCommitments", args, query: query(votingReady),
  });

  return {
    locked: locked as bigint | undefined,
    pending: pending as bigint | undefined,
    activeSubject: activeSubject as `0x${string}` | undefined,
    deregistered: deregistered as boolean | undefined,
    hasLiveRecovery: Boolean((ownRecovery as RecoveryTuple | undefined)?.[7]),
    hasActiveTrades: hasActiveTrades as boolean | undefined,
    hasOpenCommitments: hasOpenCommitments as boolean | undefined,
    ready: enabled,
    refetchAll: useCallback(async () => {
      await Promise.all([refetchLocked(), refetchPending(), refetchActive(), refetchDeregistered(), refetchRecovery()]);
    }, [refetchLocked, refetchPending, refetchActive, refetchDeregistered, refetchRecovery]),
  };
}

export function AccountMenu() {
  const { dictionary: t } = useLocale();
  const a = t.account;
  const { address, chainId, isConnected, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();
  const { nickname, save: saveNickname } = useNickname(address);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>("root");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  const wrongNetwork = isConnected && chainId !== CHAIN_ID;

  // 关闭时一并回到根视图，下次打开是干净的起点。
  const closeMenu = useCallback(() => {
    setView("root");
    setOpen(false);
  }, []);

  const openMenu = useCallback(() => {
    setView("root");
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeMenu]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [address]);

  if (!isConnected) {
    return (
      <>
        <button type="button" className="button button-primary" onClick={() => setPickerOpen(true)}>
          {t.common.connectWallet}
        </button>
        <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      </>
    );
  }

  const popover = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.16 } }
    : {
        initial: { opacity: 0, y: -6, scale: 0.97 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -4, scale: 0.985 },
        transition: { type: "spring" as const, bounce: 0, duration: 0.3 },
      };

  return (
    <div className="account-menu" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={a.open}
        title={address}
        onClick={openMenu}
      >
        <span className="account-avatar" style={{ backgroundImage: avatarGradient(address ?? "0x") }} aria-hidden="true">
          {(nickname ?? address ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="account-trigger-text">
          <span className="account-trigger-name">{nickname ?? shortAddress(address ?? "")}</span>
          <span className="account-trigger-net">{chainId === CHAIN_ID ? activeChain.name : t.wallet.networkShort}</span>
        </span>
        <svg className="account-chevron" width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path d="M2.5 4L5.5 7L8.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="account-popover"
            role="menu"
            aria-label={a.menu}
            {...popover}
          >
            <div className="account-popover-head">
              <span className="account-avatar account-avatar-lg" style={{ backgroundImage: avatarGradient(address ?? "0x") }} aria-hidden="true">
                {(nickname ?? address ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="account-identity">
                <strong>{nickname ?? a.unnamed}</strong>
                <button type="button" className="account-copy" onClick={() => void copyAddress()} aria-label={t.wallet.copyAddress}>
                  <span>{shortAddress(address ?? "")}</span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <rect x="3.5" y="3.5" width="6" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M8 3.5V3A1.5 1.5 0 006.5 1.5H3A1.5 1.5 0 001.5 3v3.5A1.5 1.5 0 003 8h.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            {copied && <p className="account-toast" role="status">{t.wallet.addressCopied}</p>}
            {wrongNetwork && (
              <div className="account-alert" role="alert">
                <p>{formatMessage(t.wallet.networkError, { chain: activeChain.name, chainId: CHAIN_ID })}</p>
                <button type="button" className="button button-warning" disabled={isSwitching} onClick={() => switchChain({ chainId: CHAIN_ID })}>
                  {isSwitching ? t.wallet.switching : formatMessage(t.wallet.switchTo, { chain: activeChain.name })}
                </button>
                {/* 全局引导弹窗被关掉之后的兜底入口：随时可以再看一遍切换步骤。 */}
                <button type="button" className="account-alert-link" onClick={() => setGuideOpen(true)}>
                  {t.wallet.networkGuideReopen}
                </button>
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              {view === "root" && (
                <motion.div key="root" className="account-view" {...subView(reduceMotion, 0)}>
                  <DepositSummary address={address} />
                  <div className="account-actions">
                    <MenuRow icon="user" label={a.editNickname} hint={nickname ?? shortAddress(address ?? "")} onClick={() => setView("nickname")} />
                    <MenuRow icon="list" label={a.transactions} onClick={() => setView("transactions")} />
                    <MenuRow icon="logout" label={a.deregister} tone="danger" onClick={() => setView("deregister")} />
                  </div>
                  <div className="account-actions">
                    <MenuRow icon="swap" label={t.wallet.switchWallet} onClick={() => setPickerOpen(true)} />
                    <MenuRow icon="power" label={t.wallet.disconnect} tone="danger" onClick={() => { disconnect(); closeMenu(); }} />
                  </div>
                </motion.div>
              )}

              {view === "nickname" && (
                <motion.div key="nickname" className="account-view" {...subView(reduceMotion, 1)}>
                  <NicknameView
                    initial={nickname ?? ""}
                    onCancel={() => setView("root")}
                    onSave={(value) => { saveNickname(value); setView("root"); }}
                  />
                </motion.div>
              )}

              {view === "transactions" && (
                <motion.div key="transactions" className="account-view" {...subView(reduceMotion, 1)}>
                  <TransactionsView address={address?.toLowerCase()} onBack={() => setView("root")} />
                </motion.div>
              )}

              {view === "deregister" && (
                <motion.div key="deregister" className="account-view" {...subView(reduceMotion, 1)}>
                  <DeregisterView address={address} onBack={() => setView("root")} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <NetworkSwitchDialog
        open={guideOpen}
        currentChainId={chainId}
        expectedChainId={CHAIN_ID}
        expectedChainName={activeChain.name}
        walletName={connector?.name && connector.name !== "Injected" ? connector.name : t.wallet.networkGuideWalletFallback}
        isSwitching={isSwitching}
        error={switchError
          ? formatMessage(t.wallet.networkGuideError, { wallet: connector?.name ?? t.wallet.networkGuideWalletFallback, chain: activeChain.name, chainId: CHAIN_ID })
          : undefined}
        onSwitch={() => switchChain({ chainId: CHAIN_ID })}
        onDismiss={() => setGuideOpen(false)}
      />
    </div>
  );
}

/** 子视图从右侧推入、从右侧退出，进出同路（空间一致性）。 */
function subView(reduceMotion: boolean | null, direction: number) {
  if (reduceMotion) {
    return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.14 } };
  }
  return {
    initial: { opacity: 0, x: direction * 18 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: direction * 18 },
    transition: { type: "spring" as const, bounce: 0, duration: 0.3 },
  };
}

function MenuRow({
  icon, label, hint, tone, onClick,
}: {
  icon: "user" | "list" | "logout" | "swap" | "power";
  label: string;
  hint?: string;
  tone?: "danger";
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" className={tone === "danger" ? "account-row is-danger" : "account-row"} onClick={onClick}>
      <span className="account-row-icon" aria-hidden="true">{menuIcon(icon)}</span>
      <span className="account-row-label">{label}</span>
      {hint && <span className="account-row-hint">{hint}</span>}
      <svg className="account-row-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function menuIcon(name: "user" | "list" | "logout" | "swap" | "power") {
  const paths: Record<typeof name, React.ReactNode> = {
    user: <><circle cx="7" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.3" /><path d="M2.6 12.2a4.6 4.6 0 018.8 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></>,
    list: <><path d="M3 4h8M3 7h8M3 10h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></>,
    logout: <><path d="M6.2 2.6H3.4A1.4 1.4 0 002 4v6a1.4 1.4 0 001.4 1.4h2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M9 5l2.6 2.6L9 10.2M11.4 7.6H5.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></>,
    swap: <><path d="M2.6 5.2h8.8L9.6 3.4M11.4 8.8H2.6l1.8 1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></>,
    power: <><path d="M7 1.8v5.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M4.1 3.6a4.2 4.2 0 105.8 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></>,
  };
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function DepositSummary({ address }: { address?: `0x${string}` }) {
  const { dictionary: t } = useLocale();
  const a = t.account;
  const status = useDepositStatus(address);
  if (!status.ready) return null;
  return (
    <div className="account-stats">
      <div>
        <span>{a.lockedDeposit}</span>
        <strong>{status.locked === undefined ? "—" : `${formatEther(status.locked)} ETH`}</strong>
      </div>
      <div>
        <span>{a.withdrawable}</span>
        <strong>{status.pending === undefined ? "—" : `${formatEther(status.pending)} ETH`}</strong>
      </div>
    </div>
  );
}

function NicknameView({ initial, onSave, onCancel }: { initial: string; onSave: (value: string) => void; onCancel: () => void }) {
  const { dictionary: t } = useLocale();
  const a = t.account;
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="account-panel">
      <label className="field-label" htmlFor="account-nickname">
        {a.nicknameLabel}
        <input
          id="account-nickname"
          ref={inputRef}
          className="field-input"
          value={value}
          maxLength={24}
          placeholder={a.nicknamePlaceholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSave(value);
            if (event.key === "Escape") onCancel();
          }}
        />
      </label>
      <p className="form-hint">{a.nicknameHint}</p>
      <div className="account-panel-actions">
        <button type="button" className="button button-secondary" onClick={onCancel}>{a.cancel}</button>
        <button type="button" className="button button-primary" onClick={() => onSave(value)}>{a.save}</button>
      </div>
    </div>
  );
}

function TransactionsView({ address, onBack }: { address?: string; onBack: () => void }) {
  const { locale, dictionary: t } = useLocale();
  const a = t.account;
  const { records, ready, clear } = useTxHistory();
  const [confirming, setConfirming] = useState(false);
  const explorer = activeChain.blockExplorers?.default?.url;

  const own = useMemo(
    () => (address ? records.filter((item) => item.subject === address) : []),
    [records, address],
  );

  if (!ready) return <div className="account-panel"><p className="form-hint">{t.common.loading}</p></div>;

  if (own.length === 0) {
    return (
      <div className="account-panel">
        <p className="form-hint">{a.transactionsEmpty}</p>
        <div className="account-panel-actions"><button type="button" className="button button-secondary" onClick={onBack}>{a.back}</button></div>
      </div>
    );
  }

  return (
    <div className="account-panel">
      <ul className="tx-list">
        {own.slice(0, 30).map((item) => (
          <li key={item.id} className={`tx-item is-${item.status}`}>
            <div className="tx-item-top">
              <span className={`tx-badge is-${item.status}`}>
                {item.status === "success" ? a.txSuccess : item.status === "failed" ? a.txFailed : a.txPending}
              </span>
              <span className="tx-kind">{kindLabel(item.kind, t.account)}</span>
              <time className="tx-time" dateTime={new Date(item.timestamp).toISOString()}>
                {new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(item.timestamp)}
              </time>
            </div>
            <p className="tx-label">{item.label ?? (item.hash ? shortAddress(item.hash) : a.txUnknown)}</p>
            {item.error && <p className="tx-error">{item.error}</p>}
            {item.hash && (
              <p className="tx-hash">
                <code>{shortAddress(item.hash)}</code>
                {explorer && (
                  <a href={`${explorer}/tx/${item.hash}`} target="_blank" rel="noopener noreferrer">{t.wallet.viewOnExplorer}</a>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="account-panel-actions">
        {confirming ? (
          <>
            <button type="button" className="button button-secondary" onClick={() => setConfirming(false)}>{a.cancel}</button>
            <button type="button" className="button button-warning" onClick={() => { clear(address); setConfirming(false); }}>
              {formatMessage(a.txClearConfirm, { count: own.length })}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button button-secondary" onClick={onBack}>{a.back}</button>
            <button type="button" className="button button-secondary" onClick={() => setConfirming(true)}>{a.txClear}</button>
          </>
        )}
      </div>
    </div>
  );
}

function kindLabel(kind: TxKind, a: { txKindAgent: string; txKindTrade: string; txKindDispute: string; txKindDeposit: string }): string {
  if (kind === "agent") return a.txKindAgent;
  if (kind === "trade") return a.txKindTrade;
  if (kind === "dispute") return a.txKindDispute;
  return a.txKindDeposit;
}

function DeregisterView({ address, onBack }: { address?: `0x${string}`; onBack: () => void }) {
  const { dictionary: t } = useLocale();
  const a = t.account;
  const { chainId, isConnected } = useAccount();
  const status = useDepositStatus(address);
  const write = useWriteContract();
  const [confirming, setConfirming] = useState(false);
  const [opLabel, setOpLabel] = useState<string>();

  const feedback = useTransactionFeedback({
    hash: write.data,
    isSubmitting: write.isPending,
    writeError: write.error,
    successLabel: opLabel,
  });
  useTxRecorder(feedback, { kind: "deposit", subject: address, chainId: CHAIN_ID });

  // 交易确认后刷新链上读数。无需复位 confirming：注销成功后 status.deregistered 变 true，
  // 面板会自动切到「赎回押金」分支。
  const refetchAll = status.refetchAll;
  useEffect(() => {
    if (feedback.phase !== "success") return;
    void refetchAll();
  }, [feedback.phase, refetchAll]);

  const rightChain = isConnected && chainId === CHAIN_ID;
  const pending = status.pending ?? ZERO;
  const blocked = !WRITES_ENABLED || !rightChain || !status.activeSubject || status.deregistered
    || status.hasLiveRecovery || status.hasActiveTrades || status.hasOpenCommitments;
  const blockReason = !WRITES_ENABLED
    ? t.write.notConfigured
    : !rightChain
      ? t.write.wrongChain
      : !status.activeSubject
        ? a.notRegistered
        : status.deregistered
          ? a.alreadyDeregistered
          : status.hasLiveRecovery
            ? t.agents.recoveryDeregisterBlock
            : status.hasActiveTrades
              ? t.agents.activeTrades
              : status.hasOpenCommitments
                ? t.agents.openVotes
                : undefined;

  const run = (action: "deregister" | "withdraw", label: string) => {
    setOpLabel(label);
    if (action === "withdraw") {
      if (!address) return;
      write.writeContract({
        address: CONTRACT_ADDRESSES.agentRegistry,
        abi: agentRegistryAbi,
        functionName: "withdraw",
        args: [address],
      });
      return;
    }
    write.writeContract({
      address: CONTRACT_ADDRESSES.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "deregister",
      args: [],
    });
  };

  const busy = write.isPending || feedback.phase === "confirming" || feedback.phase === "submitting";
  const canWithdraw = WRITES_ENABLED && rightChain && pending > ZERO;

  return (
    <div className="account-panel">
      <p className="form-hint">{a.deregisterBody}</p>

      {blockReason && <p className="form-warning" role="status">{blockReason}</p>}

      {status.deregistered ? (
        <>
          <p className="account-figure">{a.pendingAfterDelete}: <strong>{formatEther(pending)} ETH</strong></p>
          <div className="account-panel-actions">
            <button type="button" className="button button-secondary" onClick={onBack}>{a.back}</button>
            <button
              type="button"
              className="button button-primary"
              disabled={!canWithdraw || busy}
              title={canWithdraw ? undefined : blockReason}
              onClick={() => run("withdraw", a.withdrawSuccess)}
            >
              {busy ? t.common.loading : a.withdraw}
            </button>
          </div>
        </>
      ) : confirming ? (
        <>
          <p className="account-warning-text">{a.deregisterConfirm}</p>
          <div className="account-panel-actions">
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => setConfirming(false)}>{a.cancel}</button>
            <button
              type="button"
              className="button button-warning"
              disabled={blocked || busy}
              onClick={() => run("deregister", a.deregisterSuccess)}
            >
              {busy ? t.common.loading : a.deregisterConfirmAction}
            </button>
          </div>
        </>
      ) : (
        <div className="account-panel-actions">
          <button type="button" className="button button-secondary" onClick={onBack}>{a.back}</button>
          <button type="button" className="button button-warning" disabled={blocked || busy} onClick={() => setConfirming(true)}>
            {a.deregister}
          </button>
        </div>
      )}

      {feedback.phase === "error" && feedback.error && (
        <p className="form-error" role="alert">
          {"shortMessage" in feedback.error && typeof feedback.error.shortMessage === "string"
            ? feedback.error.shortMessage
            : feedback.error.message}
        </p>
      )}
    </div>
  );
}
