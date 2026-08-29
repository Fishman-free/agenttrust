"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { formatEther, isAddress } from "viem";
import { RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { agentRegistryAbi } from "@/lib/abi";
import { CHAIN_ID, CHAIN_MODE, CONTRACT_ADDRESSES, WRITE_BLOCK_REASON, WRITES_ENABLED, activeChain, isZeroAddress } from "@/lib/config";
import { parseAgentRegistered } from "@/lib/receipt-events";
import { WorldIdButton } from "@/app/components/world-id-button";
import type { RegistryAttestation } from "@/lib/world-id";
import { getWriteReadiness } from "@/lib/write-readiness";
import { TransactionStatus, useTransactionFeedback } from "@/app/components/transaction-status";
import { useWalletPicker } from "@/app/components/wallet-picker";
import { formatMessage, useLocale } from "@/lib/locale";
import { useAgentIdentity } from "@/lib/agent-identity";
import { useTxHistory, type TxKind } from "@/lib/tx-history";

type AgentMetadata = readonly [
  name: string,
  description: string,
  endpoint: string,
  owner: `0x${string}`,
  createdAt: bigint,
];

const NULLIFIER_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function shortAddress(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

function describeError(cause: unknown) {
  return cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
}

export default function AgentsPage() {
  const { locale, dictionary: t } = useLocale();
  const a = t.agents;
  const ui = t.agentUi;
  const { address, chainId, isConnected } = useAccount();
  const picker = useWalletPicker();
  const history = useTxHistory();

  const identity = useAgentIdentity();
  const {
    registryConfigured,
    depositAmount,
    lockedDeposit,
    deregistered,
    activeSubject,
    pohVerified,
    pendingWithdrawal,
    recovery: ownRecoveryData,
    hasActiveTrades,
    hasOpenCommitments,
  } = identity;
  const ownRecovery = ownRecoveryData;
  const pendingAmount = pendingWithdrawal ?? 0n;

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [guardian1, setGuardian1] = useState("");
  const [guardian2, setGuardian2] = useState("");
  const [guardian3, setGuardian3] = useState("");
  const [verifiedMode, setVerifiedMode] = useState(false);
  const [attestation, setAttestation] = useState<RegistryAttestation>();
  const [mockNullifier, setMockNullifier] = useState("");
  const [mockProof, setMockProof] = useState("0x01");
  const [bindMockNullifier, setBindMockNullifier] = useState("");
  const [bindMockProof, setBindMockProof] = useState("0x01");
  const [recoverySubject, setRecoverySubject] = useState("");
  const [opLabel, setOpLabel] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [directoryToken, setDirectoryToken] = useState(0);
  const refreshedReceipt = useRef<string | undefined>(undefined);

  const registration = useWriteContract();
  const operations = useWriteContract();

  // Registry 尚未绑定 World ID 验证器时，验证注册与 Labs 门禁不可用（上游行为，保持不变）。
  const { data: poHVerifier } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "pohVerifier",
    query: { enabled: registryConfigured },
  });
  const verifierBound = poHVerifier !== undefined && !isZeroAddress(poHVerifier);
  const isLocalMock = CHAIN_MODE === "anvil";

  const registrationFeedback = useTransactionFeedback({
    hash: registration.data,
    isSubmitting: registration.isPending,
    writeError: registration.error,
  });
  const operationsFeedback = useTransactionFeedback({
    hash: operations.data,
    isSubmitting: operations.isPending,
    writeError: operations.error,
    successLabel: opLabel,
  });
  const registrationEvent = registrationFeedback.receipt
    ? parseAgentRegistered(registrationFeedback.receipt, CONTRACT_ADDRESSES.agentRegistry, agentRegistryAbi)
    : undefined;

  useEffect(() => {
    if (registrationFeedback.phase !== "success" || !registrationFeedback.receipt) return;
    const receiptKey = registrationFeedback.receipt.transactionHash;
    if (refreshedReceipt.current === receiptKey) return;
    refreshedReceipt.current = receiptKey;
    void identity.refetchAll();
    setDirectoryToken((token) => token + 1);
  }, [registrationFeedback.phase, registrationFeedback.receipt, identity]);

  useEffect(() => {
    if (operationsFeedback.phase !== "success") return;
    void identity.refetchAll();
  }, [operationsFeedback.phase, identity]);

  const filledGuardians = [guardian1.trim(), guardian2.trim(), guardian3.trim()]
    .filter(Boolean)
    .map((guardian) => guardian as `0x${string}`);
  const guardianError =
    guardian1.trim() === "" || guardian2.trim() === ""
      ? a.guardiansRequired
      : !filledGuardians.every((g) => isAddress(g))
        ? a.guardianInvalid
        : filledGuardians.some((g) => g.toLowerCase() === address?.toLowerCase())
          ? a.guardianSelf
          : new Set(filledGuardians.map((g) => g.toLowerCase())).size !== filledGuardians.length
            ? a.guardianDuplicate
            : undefined;

  const verifiedNullifier = isLocalMock ? mockNullifier.trim() : attestation?.nullifier;
  const verifiedProof = isLocalMock ? mockProof.trim() : attestation?.proof;
  const verifiedInputsValid = !verifiedMode || (Boolean(verifierBound || isLocalMock) && NULLIFIER_PATTERN.test(verifiedNullifier ?? "") && Boolean(verifiedProof));
  const inputValid = Boolean(name.trim() && desc.trim() && endpoint.trim()) && !guardianError && verifiedInputsValid;
  const busy = registration.isPending || registrationFeedback.phase === "confirming";
  const opsBusy = operations.isPending || operationsFeedback.phase === "confirming";
  const readiness = getWriteReadiness({
    configured: WRITES_ENABLED,
    connected: isConnected,
    rightChain: chainId === CHAIN_ID,
    busy,
    authorized: true,
    stateValid: depositAmount !== undefined,
    inputValid,
    reasons: {
      "not-configured": WRITE_BLOCK_REASON,
      "wrong-chain": formatMessage(a.wrongNetwork, { chain: activeChain.name, chainId: CHAIN_ID }),
      "invalid-state": a.depositLoading,
      "invalid-input": guardianError ?? (verifiedMode && !verifiedInputsValid ? a.validWorldId : a.completeInfo),
    },
    locale,
  });

  const hasLiveRecovery = Boolean(ownRecovery?.[7]);
  const obligationReason = hasActiveTrades
    ? a.activeTrades
    : hasOpenCommitments
      ? a.openVotes
      : undefined;
  const deregisterReady =
    WRITES_ENABLED && isConnected && chainId === CHAIN_ID && !opsBusy && Boolean(activeSubject)
    && !deregistered && !hasLiveRecovery && !obligationReason && Boolean(lockedDeposit !== undefined);

  const bindMockValid = NULLIFIER_PATTERN.test(bindMockNullifier.trim()) && bindMockProof.trim() !== "";
  const bindReady =
    isLocalMock && WRITES_ENABLED && isConnected && chainId === CHAIN_ID && !opsBusy && Boolean(activeSubject)
    && !deregistered && pohVerified === false && bindMockValid;

  function record(hash: `0x${string}`, label: string, kind: TxKind) {
    history.record({ hash, label, kind, status: "pending", chainId: chainId ?? CHAIN_ID });
  }

  async function submitRegistration() {
    setActionError(undefined);
    const label = formatMessage(a.registerDeposit, { amount: depositEth });
    try {
      const hash = verifiedMode
        ? await registration.writeContractAsync({
          address: CONTRACT_ADDRESSES.agentRegistry,
          abi: agentRegistryAbi,
          functionName: "registerAgentVerified",
          args: [
            name.trim(),
            desc.trim(),
            endpoint.trim(),
            verifiedNullifier as `0x${string}`,
            verifiedProof as `0x${string}`,
            filledGuardians,
          ],
          value: depositAmount,
        })
        : await registration.writeContractAsync({
          address: CONTRACT_ADDRESSES.agentRegistry,
          abi: agentRegistryAbi,
          functionName: "registerAgent",
          args: [name.trim(), desc.trim(), endpoint.trim(), filledGuardians],
          value: depositAmount,
        });
      record(hash, label, "register");
    } catch (cause) {
      setActionError(describeError(cause));
    }
  }

  async function submitOperation(
    functionName: "bindPoH" | "deregister" | "withdraw" | "vetoRecovery" | "approveRecovery",
    args: unknown[],
    label: string,
    kind: TxKind,
  ) {
    setActionError(undefined);
    setOpLabel(label);
    try {
      const hash = await operations.writeContractAsync({
        address: CONTRACT_ADDRESSES.agentRegistry,
        abi: agentRegistryAbi,
        functionName,
        args: args as never,
      });
      record(hash, label, kind);
    } catch (cause) {
      setActionError(describeError(cause));
    }
  }

  function register() {
    if (!readiness.ready) {
      // 不再用 alert()：错误就近显示在提交按钮旁（Apple 原则 17 · 内联验证）。
      setActionError(readiness.reason);
      return;
    }
    void submitRegistration();
  }

  const depositEth = depositAmount === undefined ? "0" : formatEther(depositAmount);
  const successLabel = registrationEvent
    ? formatMessage(a.registered, { id: registrationEvent.args.tokenId.toString() })
    : registrationFeedback.phase === "success"
      ? a.missingEvent
      : undefined;

  const recoveryWindowHours = ownRecovery?.[6] === 0 ? 24 : 48;
  const recoveryRequiredApprovals = ownRecovery?.[6] === 0 ? "1" : a.all;
  const recoverySubjectValid = recoverySubject.trim() !== "" && isAddress(recoverySubject.trim());

  const statusPill = !isConnected
    ? undefined
    : activeSubject
      ? deregistered
        ? { text: ui.statusClosed, className: "status-pill" }
        : { text: ui.statusActive, className: "status-pill status-pill-active" }
      : { text: ui.statusNotRegistered, className: "status-pill" };

  return (
    <main className="page page-wide">
      <div className="page-head">
        <h1 className="page-title">{a.title}</h1>
        <p className="page-sub">{a.subtitle}</p>

        <dl className="agents-stats">
          <div className="agents-stat">
            <dt>{ui.networkCard}</dt>
            <dd>{activeChain.name}</dd>
          </div>
          <div className="agents-stat">
            <dt>{ui.depositCard}</dt>
            <dd>{depositAmount === undefined ? t.common.loading : `${depositEth} ETH`}</dd>
          </div>
          <div className="agents-stat">
            <dt>{ui.statusCard}</dt>
            <dd>{statusPill ? <span className={statusPill.className}>{statusPill.text}</span> : "—"}</dd>
          </div>
        </dl>
      </div>

      {!registryConfigured && <p className="form-warning mt-3" role="status">{a.registryMissing}</p>}
      {isConnected && chainId !== CHAIN_ID && (
        <p className="form-error mb-4" role="alert">
          {formatMessage(a.wrongNetwork, { chain: activeChain.name, chainId: CHAIN_ID })}
        </p>
      )}

      {!isConnected ? (
        <div className="card connect-cta">
          <h2>{ui.connectTitle}</h2>
          <p>{ui.connectBody}</p>
          <button type="button" className="button button-primary" onClick={() => picker.open("connect")}>
            {t.common.connectWallet}
          </button>
        </div>
      ) : (
        <>
          {!activeSubject ? (
            <form className="card" onSubmit={(event) => { event.preventDefault(); register(); }}>
              <section className="form-section">
                <div className="form-section-head">
                  <h2 className="form-section-title">{ui.sectionBasics}</h2>
                  <p className="form-hint">{ui.sectionBasicsHint}</p>
                </div>
                <label className="field-label">
                  {a.name}
                  <input aria-label={a.name} placeholder={a.name} value={name} onChange={(e) => setName(e.target.value)} className="field-input" />
                </label>
                <label className="field-label">
                  {a.description}
                  <input aria-label={a.description} placeholder={a.description} value={desc} onChange={(e) => setDesc(e.target.value)} className="field-input" />
                </label>
                <label className="field-label">
                  {a.endpoint}
                  <input aria-label={a.endpoint} placeholder={a.endpoint} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="field-input" inputMode="url" />
                </label>
              </section>

              <section className="form-section">
                <div className="form-section-head">
                  <h2 className="form-section-title">{ui.sectionGuardians}</h2>
                  <p className="form-hint">{ui.sectionGuardiansHint}</p>
                </div>
                <div className="form-grid-2">
                  <label className="field-label">
                    {a.guardian1}
                    <input aria-label={a.guardian1Aria} placeholder="0x…" value={guardian1} onChange={(e) => setGuardian1(e.target.value)} className="field-input" />
                  </label>
                  <label className="field-label">
                    {a.guardian2}
                    <input aria-label={a.guardian2} placeholder="0x…" value={guardian2} onChange={(e) => setGuardian2(e.target.value)} className="field-input" />
                  </label>
                </div>
                <label className="field-label">
                  {a.guardian3}
                  <input aria-label={a.guardian3} placeholder={a.optionalAddress} value={guardian3} onChange={(e) => setGuardian3(e.target.value)} className="field-input" />
                </label>
                {guardianError && <p className="form-hint">{ui.guardianHint}</p>}
              </section>

              <section className="form-section">
                <details className="labs-card agent-labs">
                  <summary>{t.auth.labs}</summary>
                  <p className="form-hint">{t.auth.worldIdLabs}</p>
                  <div className="switch-row">
                    <span className="switch-row-text">
                      <span>{a.verifiedMode}</span>
                      <span>{a.verifiedModeHelp}</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={verifiedMode}
                      aria-label={a.verifiedMode}
                      className="switch"
                      onClick={() => setVerifiedMode((current) => !current)}
                    />
                  </div>
                  {verifiedMode && address && (isLocalMock ? (
                    <div className="form-grid-2">
                      <label className="field-label">{a.nullifier}<input aria-label={a.nullifierAria} placeholder="0x…" value={mockNullifier} onChange={(e) => setMockNullifier(e.target.value)} className="field-input" /></label>
                      <label className="field-label">{a.proof}<input aria-label={a.proofAria} placeholder="0x01" value={mockProof} onChange={(e) => setMockProof(e.target.value)} className="field-input" /></label>
                    </div>
                  ) : verifierBound ? (
                    <WorldIdButton subject={address} disabled={busy} label={a.worldIdButton} loadingLabel={a.worldIdLoading} errorLabel={a.worldIdError} onAttestation={setAttestation} />
                  ) : <p className="form-warning" role="status">{a.verifierMissing}</p>)}
                </details>
              </section>

              <div className="form-section">
                <p className="form-hint">{a.depositHelp}</p>
                <div className="action-row">
                  <button
                    type="submit"
                    disabled={!readiness.ready}
                    title={readiness.ready ? undefined : readiness.reason}
                    className="button button-primary"
                  >
                    {busy
                      ? a.registering
                      : depositAmount === undefined
                        ? t.common.loading
                        : formatMessage(a.registerDeposit, { amount: depositEth })}
                  </button>
                </div>
                {!readiness.ready && readiness.code !== "invalid-input" && (
                  <p className="form-warning" role="status">{readiness.reason}</p>
                )}
                {actionError && <p className="form-error" role="alert">{actionError}</p>}
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <section className="card">
                <h2 className="card-title">{a.identity}</h2>
                <dl className="detail-grid mt-3">
                  <div>
                    <dt>{a.status}</dt>
                    <dd>
                      <span className={deregistered ? "status-pill" : "status-pill status-pill-active"}>
                        {deregistered ? a.deregistered : a.active}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>{a.poh}</dt>
                    <dd>
                      <span className={pohVerified ? "status-pill status-pill-active" : "status-pill status-pill-warning"}>
                        {pohVerified ? a.verified : a.unverified}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>{a.lockedDeposit}</dt>
                    <dd>{lockedDeposit === undefined ? "—" : `${formatEther(lockedDeposit)} ETH`}</dd>
                  </div>
                  <div>
                    <dt>{a.pending}</dt>
                    <dd>{pendingAmount > 0n ? `${formatEther(pendingAmount)} ETH` : "—"}</dd>
                  </div>
                </dl>

                {!deregistered && pohVerified === false && (
                  <div className="callout callout-action mt-3" role="alert">
                    <p className="warning-text"><TriangleAlert size={14} aria-hidden="true" /> {a.notVerified}</p>
                    <p className="form-hint">{a.notVerifiedRisk}</p>
                    {isLocalMock ? (
                      <>
                        <div className="form-grid-2">
                          <label className="field-label">{a.bindNullifier}<input aria-label={a.bindNullifier} placeholder="0x…" value={bindMockNullifier} onChange={(e) => setBindMockNullifier(e.target.value)} className="field-input" /></label>
                          <label className="field-label">{a.bindProof}<input aria-label={a.bindProof} placeholder="0x01" value={bindMockProof} onChange={(e) => setBindMockProof(e.target.value)} className="field-input" /></label>
                        </div>
                        <div>
                          <button type="button" className="button button-primary" disabled={!bindReady} title={bindReady ? undefined : a.bindInvalid} onClick={() => void submitOperation("bindPoH", [bindMockNullifier.trim(), bindMockProof.trim()], a.bindSuccess, "bind")}>
                            <ShieldCheck size={15} aria-hidden="true" />
                            {a.bindButton}
                          </button>
                        </div>
                      </>
                    ) : verifierBound && address ? (
                      <WorldIdButton subject={address} disabled={opsBusy} label={a.bindButton} loadingLabel={a.worldIdLoading} errorLabel={a.worldIdError} onAttestation={(value) => void submitOperation("bindPoH", [value.nullifier, value.proof], a.bindSuccess, "bind")} />
                    ) : <p className="form-warning" role="status">{a.verifierMissing}</p>}
                  </div>
                )}

                {pendingAmount > 0n && (
                  <div className="action-row mt-3">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={!WRITES_ENABLED || opsBusy}
                      onClick={() => void submitOperation("withdraw", [address], a.withdrawSuccess, "withdraw")}
                    >
                      {a.withdrawDeposit}
                    </button>
                  </div>
                )}
                <TransactionStatus feedback={operationsFeedback} />
              </section>

              {!deregistered && (
                <section className="card danger-zone">
                  <h2 className="card-title">{ui.dangerZone}</h2>
                  <p className="form-hint">{ui.dangerZoneHint}</p>
                  <div className="action-row mt-3">
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={!deregisterReady}
                      title={deregisterReady ? undefined : (hasLiveRecovery ? a.recoveryBlocks : (obligationReason ?? a.conditions))}
                      onClick={() => void submitOperation("deregister", [], a.deregisterSuccess, "deregister")}
                    >
                      {a.deregister}
                    </button>
                  </div>
                  {!deregisterReady && (
                    <p className="form-warning" role="status">
                      {hasLiveRecovery ? a.recoveryDeregisterBlock : (obligationReason ?? a.walletCheck)}
                    </p>
                  )}
                </section>
              )}

              <section className="card">
                <h2 className="card-title">{a.recovery}</h2>
                {hasLiveRecovery ? (
                  <div className="callout callout-action mt-3">
                    <p className="text-sm">
                      {formatMessage(a.recoveryLive, {
                        wallet: shortAddress(ownRecovery?.[0] ?? ""),
                        approvals: String(ownRecovery?.[5] ?? 0),
                        required: recoveryRequiredApprovals,
                        path: ownRecovery?.[6] === 0 ? a.samePersonPath : a.guardianPath,
                        date: new Date(Number(ownRecovery?.[2] ?? 0) * 1000).toLocaleString(locale),
                      })}
                    </p>
                    <p className="form-hint">{formatMessage(a.vetoWarning, { hours: recoveryWindowHours })}</p>
                    <div>
                      <button
                        type="button"
                        className="button button-warning"
                        disabled={!WRITES_ENABLED || opsBusy}
                        onClick={() => void submitOperation("vetoRecovery", [address], a.vetoSuccess, "recovery")}
                      >
                        {a.veto}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="form-hint mt-3">{a.noRecovery}</p>
                )}
                <label className="field-label mt-3">
                  {a.approveHelp}
                  <input aria-label={a.protectedAddress} placeholder="0x…" value={recoverySubject} onChange={(e) => setRecoverySubject(e.target.value)} className="field-input" />
                </label>
                <div className="action-row mt-3">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!WRITES_ENABLED || opsBusy || !recoverySubjectValid}
                    onClick={() => void submitOperation("approveRecovery", [recoverySubject.trim()], a.approveSuccess, "recovery")}
                  >
                    {a.approve}
                  </button>
                </div>
              </section>
            </div>
          )}

          {actionError && activeSubject && <p className="form-error" role="alert">{actionError}</p>}
          <TransactionStatus feedback={registrationFeedback} successLabel={successLabel} />

          <AgentDirectory
            locale={locale}
            registryConfigured={registryConfigured}
            refreshToken={directoryToken}
          />
        </>
      )}
    </main>
  );
}

/**
 * 已注册智能体目录。
 * 单独成组件：注册表单里的每次按键都不会牵动这里的批量读取。
 */
function AgentDirectory({
  locale,
  registryConfigured,
  refreshToken,
}: {
  locale: string;
  registryConfigured: boolean;
  refreshToken: number;
}) {
  const { dictionary: t } = useLocale();
  const a = t.agents;
  const ui = t.agentUi;

  const { data: agentCount, refetch: refetchCount } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "agentCount" as const,
    query: { enabled: registryConfigured },
  });
  const count = Number(agentCount ?? 0);
  const { data: agentList, refetch: refetchList } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: CONTRACT_ADDRESSES.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "agents" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: registryConfigured && count > 0 },
  });

  // 只在真的有新注册落地后刷新，避免挂载时打一次无谓的请求。
  const skipInitial = useRef(true);
  useEffect(() => {
    if (skipInitial.current) {
      skipInitial.current = false;
      return;
    }
    void refetchCount();
    void refetchList();
  }, [refreshToken, refetchCount, refetchList]);

  return (
    <section className="mt-8">
      <div className="agents-head mb-3">
        <h2 className="section-title">{formatMessage(a.registeredAgents, { count: String(count) })}</h2>
        <button
          type="button"
          className="chip-button"
          onClick={() => { void refetchCount(); void refetchList(); }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {ui.refreshList}
        </button>
      </div>
      {count === 0 ? (
        <p className="form-hint">{a.noAgents}</p>
      ) : (
        <ul className="agents-grid" role="list">
          {agentList?.map((item, i) => {
            const agent = item?.status === "success" ? (item.result as unknown as AgentMetadata) : undefined;
            return (
              <li key={i} className="agent-card">
                <div className="agent-card-head">
                  <span className="agent-card-id">#{i}</span>
                  <span className="agent-card-id">
                    {agent && Number(agent[4]) > 0 ? new Date(Number(agent[4]) * 1000).toLocaleDateString(locale) : "—"}
                  </span>
                </div>
                {agent ? (
                  <>
                    <h3 className="agent-card-name">{agent[0]}</h3>
                    <p className="agent-card-desc">{agent[1]}</p>
                    <div className="agent-card-meta">
                      <span title={ui.agentEndpoint}>{agent[2] || "—"}</span>
                      <span title={ui.agentOwner}>{agent[3]}</span>
                    </div>
                  </>
                ) : (
                  <p className="agent-card-desc">{t.common.failedToLoad}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
