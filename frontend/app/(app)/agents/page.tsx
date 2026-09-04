"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { formatEther, isAddress } from "viem";
import { agentRegistryAbi, guaranteeEscrowAbi, schellingVotingAbi } from "@/lib/abi";
import { mcpGuideUrl } from "@/lib/docs";
import { CHAIN_ID, CHAIN_MODE, CONTRACT_ADDRESSES, WRITE_BLOCK_REASON, WRITES_ENABLED, activeChain, isZeroAddress } from "@/lib/config";
import { parseAgentRegistered } from "@/lib/receipt-events";
import { WorldIdButton } from "@/app/components/world-id-button";
import type { RegistryAttestation } from "@/lib/world-id";
import { getWriteReadiness } from "@/lib/write-readiness";
import { TransactionStatus, useTransactionFeedback } from "@/app/components/transaction-status";
import { ConnectWalletButton } from "@/app/components/wallet-status";
import { WalletPicker } from "@/app/components/wallet-picker";
import { AmbientBackground } from "@/app/components/ambient-background";
import { formatMessage, useLocale } from "@/lib/locale";
import { useTxRecorder } from "@/lib/tx-history";

type AgentMetadata = readonly [
  name: string,
  description: string,
  endpoint: string,
  owner: `0x${string}`,
  createdAt: bigint,
];

type RecoveryView = readonly [
  newWallet: `0x${string}`,
  nullifier: `0x${string}`,
  executeAfter: bigint,
  expiresAt: bigint,
  nonce: bigint,
  approvals: number,
  proofLevel: number,
  exists: boolean,
];

const NULLIFIER_PATTERN = /^0x[0-9a-fA-F]{64}$/;

// 端点会永久写进链上（AgentInfo 没有 setter，注册后谁都改不了），
// 所以这里必须在前端拦住两类必然无用的值：
//   1. 本机/内网地址（localhost、127.0.0.1、192.168.x）—— 其他 agent 根本连不上；
//   2. 非 https 地址 —— 明文端点不适合作为对外身份的一部分。
// 注意这只是格式校验，不验证端点真的存在或真的能提供服务。
const PRIVATE_HOST_PATTERN =
  /^(?:localhost|::1|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/;
const PRIVATE_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function isPublicEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERN.test(host)) return false;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  return host.includes(".");
}

function shortAddress(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

export default function AgentsPage() {
  const { locale, dictionary: t } = useLocale();
  const a = t.agents;
  const { address, chainId, isConnected, connector } = useAccount();
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const connectorName = connector?.name && connector.name !== "Injected" ? connector.name : t.common.unknown;
  const registration = useWriteContract();
  const operations = useWriteContract();
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
  const [bindPlatform, setBindPlatform] = useState("");
  const [bindExternalId, setBindExternalId] = useState("");
  const [recoverySubject, setRecoverySubject] = useState("");
  const [opLabel, setOpLabel] = useState<string>();
  const refreshedReceipt = useRef<string | undefined>(undefined);
  const registryConfigured = !isZeroAddress(CONTRACT_ADDRESSES.agentRegistry);
  const escrowConfigured = !isZeroAddress(CONTRACT_ADDRESSES.guaranteeEscrow);
  const votingConfigured = !isZeroAddress(CONTRACT_ADDRESSES.schellingVoting);

  const { data: depositData } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "registrationDeposit",
    query: { enabled: registryConfigured },
  });
  const depositEth = depositData === undefined ? "0" : formatEther(depositData);
  const plainDeposit = depositData;
  const plainDepositEth = plainDeposit === undefined ? "0" : formatEther(plainDeposit);
  const { data: poHVerifier } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "pohVerifier",
    query: { enabled: registryConfigured },
  });
  const verifierBound = poHVerifier !== undefined && !isZeroAddress(poHVerifier);
  const isLocalMock = CHAIN_MODE === "anvil";

  const { data: lockedDeposit, refetch: refetchDeposit } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "deposits",
    args: address ? [address] : undefined,
    query: { enabled: registryConfigured && Boolean(address) },
  });
  const { data: deregistered, refetch: refetchDeregistered } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "deregistered",
    args: address ? [address] : undefined,
    query: { enabled: registryConfigured && Boolean(address) },
  });
  const { data: activeSubject, refetch: refetchActive } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "activeSubjects",
    args: address ? [address] : undefined,
    query: { enabled: registryConfigured && Boolean(address) },
  });
  const { data: poHVerified, refetch: refetchPoH } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "isPoHVerified",
    args: address ? [address] : undefined,
    query: { enabled: registryConfigured && Boolean(address) },
  });
  const { data: pendingBalance, refetch: refetchPending } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "pendingWithdrawals",
    args: address ? [address] : undefined,
    query: { enabled: registryConfigured && Boolean(address) },
  });
  const { data: hasActiveTrades } = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "subjectHasActiveTrades",
    args: address ? [address] : undefined,
    query: { enabled: escrowConfigured && Boolean(address) },
  });
  const { data: hasOpenCommitments } = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "subjectHasOpenCommitments",
    args: address ? [address] : undefined,
    query: { enabled: votingConfigured && Boolean(address) },
  });
  const { data: ownRecovery, refetch: refetchRecovery } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "recoveryRequests",
    args: address ? [address] : undefined,
    query: { enabled: registryConfigured && Boolean(address) },
  });

  const { data: firstAgentIdPlusOne } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "firstAgentIdPlusOne",
    args: address ? [address] : undefined,
    query: { enabled: registryConfigured && Boolean(address) },
  });
  const ownAgentId = firstAgentIdPlusOne && firstAgentIdPlusOne > 0n ? firstAgentIdPlusOne - 1n : undefined;

  const { data: externalIdentity, refetch: refetchExternal } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "externalIdentities",
    args: ownAgentId !== undefined ? [ownAgentId] : undefined,
    query: { enabled: registryConfigured && ownAgentId !== undefined },
  });
  const { data: externalLevel, refetch: refetchExternalLevel } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "verificationLevelOf",
    args: ownAgentId !== undefined ? [ownAgentId] : undefined,
    query: { enabled: registryConfigured && ownAgentId !== undefined },
  });
  const externalBound = Boolean(externalIdentity && externalIdentity[0]);

  const { data: agentCount, refetch: refetchCount } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "agentCount",
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
  useTxRecorder(registrationFeedback, { kind: "agent", subject: address, chainId });
  useTxRecorder(operationsFeedback, { kind: "agent", subject: address, chainId });
  const registrationEvent = registrationFeedback.receipt
    ? parseAgentRegistered(registrationFeedback.receipt, CONTRACT_ADDRESSES.agentRegistry, agentRegistryAbi)
    : undefined;

  useEffect(() => {
    if (registrationFeedback.phase !== "success" || !registrationFeedback.receipt) return;
    const receiptKey = registrationFeedback.receipt.transactionHash;
    if (refreshedReceipt.current === receiptKey) return;
    refreshedReceipt.current = receiptKey;
    void Promise.all([refetchCount(), refetchList(), refetchDeposit(), refetchActive(), refetchPoH()]);
  }, [registrationFeedback.phase, registrationFeedback.receipt, refetchCount, refetchList, refetchDeposit, refetchActive, refetchPoH]);

  useEffect(() => {
    if (operationsFeedback.phase !== "success") return;
    void Promise.all([refetchDeposit(), refetchDeregistered(), refetchActive(), refetchPending(), refetchRecovery(), refetchPoH(), refetchExternal(), refetchExternalLevel()]);
  }, [operationsFeedback.phase, refetchDeposit, refetchDeregistered, refetchActive, refetchPending, refetchRecovery, refetchPoH, refetchExternal, refetchExternalLevel]);

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

  // 空着交给 completeInfo 提示；填了但不合法才报端点错误。
  const endpointError = endpoint.trim() !== "" && !isPublicEndpoint(endpoint) ? a.endpointInvalid : undefined;
  const verifiedNullifier = isLocalMock ? mockNullifier.trim() : attestation?.nullifier;
  const verifiedProof = isLocalMock ? mockProof.trim() : attestation?.proof;
  const verifiedInputsValid = !verifiedMode || (Boolean(verifierBound || isLocalMock) && NULLIFIER_PATTERN.test(verifiedNullifier ?? "") && Boolean(verifiedProof));
  const inputValid = Boolean(name.trim() && desc.trim() && endpoint.trim()) && !guardianError && !endpointError && verifiedInputsValid;
  const busy = registration.isPending || registrationFeedback.phase === "confirming";
  const opsBusy = operations.isPending || operationsFeedback.phase === "confirming";
  const readiness = getWriteReadiness({
    configured: WRITES_ENABLED,
    connected: isConnected,
    rightChain: chainId === CHAIN_ID,
    busy,
    authorized: true,
    stateValid: depositData !== undefined,
    inputValid,
    reasons: {
      "not-configured": WRITE_BLOCK_REASON,
      "wrong-chain": formatMessage(a.wrongNetwork, { chain: activeChain.name, chainId: CHAIN_ID }),
      "invalid-state": a.depositLoading,
      "invalid-input": guardianError ?? endpointError ?? (verifiedMode && !verifiedInputsValid ? a.validWorldId : a.completeInfo),
    },
    locale,
  });

  const ownRecoveryView = ownRecovery as RecoveryView | undefined;
  const hasLiveRecovery = Boolean(ownRecoveryView?.[7]);
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
    && !deregistered && poHVerified === false && bindMockValid;

  const externalBindValid = bindPlatform.trim() !== "" && bindExternalId.trim() !== "";
  const externalBindReady =
    WRITES_ENABLED && isConnected && chainId === CHAIN_ID && !opsBusy && Boolean(activeSubject)
    && !deregistered && ownAgentId !== undefined && !externalBound && externalBindValid;

  function register() {
    if (!readiness.ready) {
      alert(readiness.reason);
      return;
    }
    if (verifiedMode) {
      registration.writeContract({
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
        value: depositData,
      });
      return;
    }
    registration.writeContract({
      address: CONTRACT_ADDRESSES.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "registerAgent",
      args: [name.trim(), desc.trim(), endpoint.trim(), filledGuardians],
      value: plainDeposit,
    });
  }

  function runOperation(
    functionName: "deregister" | "vetoRecovery" | "approveRecovery" | "withdraw" | "bindPoH" | "bindExternalIdentity",
    args: unknown[],
    label: string,
  ) {
    setOpLabel(label);
    operations.writeContract({
      address: CONTRACT_ADDRESSES.agentRegistry,
      abi: agentRegistryAbi,
      functionName,
      args: args as never,
    });
  }

  const successLabel = registrationEvent
    ? formatMessage(a.registered, { id: registrationEvent.args.tokenId.toString() })
    : registrationFeedback.phase === "success"
      ? a.missingEvent
      : undefined;

  const recoveryWindowHours = ownRecoveryView?.[6] === 0 ? 24 : 48;
  const recoveryRequiredApprovals = ownRecoveryView?.[6] === 0 ? "1" : a.all;
  const recoverySubjectValid = recoverySubject.trim() !== "" && isAddress(recoverySubject.trim());

  return (
    <>
      {/* 氛围背景必须留在 .page 之外：.page 带 page-enter 入场动画，末帧的
          transform 因为 fill-mode:both 会一直保留，使内部 position:fixed 退化成
          相对 .page 定位 —— 背景就只剩中间 46rem 宽的一条窄框。提到外层后，
          fixed 才认视口，整页通铺。 */}
      <AmbientBackground intense />
      <main className="page">
        <div className="page-head">
          <h1 className="page-title">{a.title}</h1>
          <p className="page-sub">{a.subtitle}</p>
        </div>
        {!isConnected && <div className="mt-4"><ConnectWalletButton /></div>}
        {!registryConfigured && <p className="form-warning mt-3" role="status">{a.registryMissing}</p>}
        {isConnected && chainId !== CHAIN_ID && (
          <p className="form-error mb-4" role="alert">
            {formatMessage(a.wrongNetwork, { chain: activeChain.name, chainId: CHAIN_ID })}
          </p>
        )}
        {isConnected && (
          <>
            {/* 责任主体就是当前钱包地址，所以切换入口必须留在这页里：
                未连接时下方有连接按钮，但一旦连上它就没了，只剩这行纯文本，
                用户在这页根本换不了钱包（唯一入口藏在页头头像菜单里）。 */}
            <div className="subject-bar">
              <span className="subject-bar-text">
                <span className="subject-bar-label">{a.currentWallet}</span>
                <span className="subject-bar-value">{connectorName} · {shortAddress(address ?? "")}</span>
              </span>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setWalletPickerOpen(true)}
              >
                {t.wallet.switchWallet}
              </button>
            </div>
            <p className="form-hint mb-4">{formatMessage(a.currentSubject, { address: address ?? "" })}</p>

            {!activeSubject && (
              <div className="card space-y-3">
                <input aria-label={a.name} placeholder={a.name} value={name} onChange={(e) => setName(e.target.value)}
                  className="field-input" />
                <input aria-label={a.description} placeholder={a.description} value={desc} onChange={(e) => setDesc(e.target.value)}
                  className="field-input" />
                <input aria-label={a.endpoint} placeholder={a.endpoint} value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
                  className="field-input" />
                {/* 端点是注册时卡得最多的字段（要填什么？怎么暴露？），直接给教程入口 */}
                <p className="form-hint"><a href={mcpGuideUrl(locale)} target="_blank" rel="noopener noreferrer">{a.endpointGuide}</a></p>
                <label className="field-label">
                  {a.guardian1}
                  <input aria-label={a.guardian1Aria} placeholder="0x…" value={guardian1} onChange={(e) => setGuardian1(e.target.value)} className="field-input" />
                </label>
                <label className="field-label">
                  {a.guardian2}
                  <input aria-label={a.guardian2} placeholder="0x…" value={guardian2} onChange={(e) => setGuardian2(e.target.value)} className="field-input" />
                </label>
                <label className="field-label">
                  {a.guardian3}
                  <input aria-label={a.guardian3} placeholder={a.optionalAddress} value={guardian3} onChange={(e) => setGuardian3(e.target.value)} className="field-input" />
                </label>
                <details className="labs-card agent-labs">
                  <summary>{t.auth.labs}</summary>
                  <p className="form-hint">{t.auth.worldIdLabs}</p>
                  <label className="field-checkbox">
                    <input type="checkbox" aria-label={a.verifiedMode} checked={verifiedMode} onChange={(e) => setVerifiedMode(e.target.checked)} />
                    {a.verifiedModeHelp}
                  </label>
                  {verifiedMode && address && (isLocalMock ? (
                    <>
                      <label className="field-label">{a.nullifier}<input aria-label={a.nullifierAria} placeholder="0x…" value={mockNullifier} onChange={(e) => setMockNullifier(e.target.value)} className="field-input" /></label>
                      <label className="field-label">{a.proof}<input aria-label={a.proofAria} placeholder="0x01" value={mockProof} onChange={(e) => setMockProof(e.target.value)} className="field-input" /></label>
                    </>
                  ) : verifierBound ? (
                    <WorldIdButton subject={address} disabled={busy} label={a.worldIdButton} loadingLabel={a.worldIdLoading} errorLabel={a.worldIdError} onAttestation={setAttestation} />
                  ) : <p className="form-warning" role="status">{a.verifierMissing}</p>)}
                </details>
                <p className="form-hint">
                  {a.depositHelp}
                </p>
                <button
                  onClick={register}
                  disabled={!readiness.ready}
                  title={readiness.ready ? undefined : readiness.reason}
                  className="button button-primary"
                >
                  {busy
                    ? a.registering
                    : depositData === undefined
                      ? t.common.loading
                      : formatMessage(a.registerDeposit, { amount: verifiedMode ? depositEth : plainDepositEth })}
                </button>
                {!readiness.ready && readiness.code !== "invalid-input" && (
                  <p className="form-warning" role="status">{readiness.reason}</p>
                )}
              </div>
            )}

            {activeSubject && (
              <div className="space-y-3">
                <div className="card space-y-3">
                  <h2 className="card-title">{a.identity}</h2>
                  <p className="text-sm">
                    {a.status} {deregistered ? <strong className="warning-text">{a.deregistered}</strong> : <strong>{a.active}</strong>} ·{" "}
                    {a.poh} {poHVerified ? <strong>{a.verified}</strong> : <strong className="warning-text">{a.unverified}</strong>} ·{" "}
                    {a.lockedDeposit} <strong>{lockedDeposit === undefined ? "—" : `${formatEther(lockedDeposit)} ETH`}</strong> ·{" "}
                    {a.pending} <strong>{pendingBalance === undefined ? "—" : `${formatEther(pendingBalance)} ETH`}</strong>
                  </p>
                  {activeSubject && !deregistered && poHVerified === false && (
                    <div className="callout space-y-2" role="alert">
                      <p className="warning-text">{a.notVerified}</p>
                      <p className="text-sm">
                        {a.notVerifiedRisk}
                      </p>
                      {isLocalMock ? (
                        <>
                          <label className="field-label">{a.bindNullifier}<input aria-label={a.bindNullifier} placeholder="0x…" value={bindMockNullifier} onChange={(e) => setBindMockNullifier(e.target.value)} className="field-input" /></label>
                          <label className="field-label">{a.bindProof}<input aria-label={a.bindProof} placeholder="0x01" value={bindMockProof} onChange={(e) => setBindMockProof(e.target.value)} className="field-input" /></label>
                          <button className="button button-primary" disabled={!bindReady} title={bindReady ? undefined : a.bindInvalid} onClick={() => runOperation("bindPoH", [bindMockNullifier.trim(), bindMockProof.trim()], a.bindSuccess)}>{a.bindButton}</button>
                        </>
                      ) : verifierBound && address ? (
                        <WorldIdButton subject={address} disabled={opsBusy} label={a.bindButton} loadingLabel={a.worldIdLoading} errorLabel={a.worldIdError} onAttestation={(value) => runOperation("bindPoH", [value.nullifier, value.proof], a.bindSuccess)} />
                      ) : <p className="form-warning" role="status">{a.verifierMissing}</p>}
                    </div>
                  )}
                  {activeSubject && !deregistered && (
                    <div className="callout space-y-2" role="status">
                      <p className="text-sm">
                        {a.externalIdentityTitle}{" "}
                        {externalBound
                          ? formatMessage(a.externalBound, {
                              platform: externalIdentity?.[0] ?? "",
                              externalId: externalIdentity?.[1] ?? "",
                              level: Number(externalLevel ?? 0) + 1,
                            })
                          : a.externalUnbound}
                      </p>
                      {!externalBound && (
                        <>
                          <p className="text-sm">{a.externalIdentityHelp}</p>
                          <label className="field-label">{a.externalPlatform}<input aria-label={a.externalPlatform} placeholder="dify / coze / openai / a2a / mcp / erc8004" value={bindPlatform} onChange={(e) => setBindPlatform(e.target.value)} className="field-input" /></label>
                          <label className="field-label">{a.externalAgentIdLabel}<input aria-label={a.externalAgentIdLabel} placeholder="app-123" value={bindExternalId} onChange={(e) => setBindExternalId(e.target.value)} className="field-input" /></label>
                          <button
                            className="button button-secondary"
                            disabled={!externalBindReady}
                            title={externalBindReady ? undefined : a.externalBindInvalid}
                            onClick={() => ownAgentId !== undefined && runOperation("bindExternalIdentity", [ownAgentId, bindPlatform.trim(), bindExternalId.trim()], a.externalBindSuccess)}
                          >
                            {a.externalBindButton}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {!deregistered && (
                    <div className="action-row">
                      <button
                        className="button button-secondary"
                        disabled={!deregisterReady}
                        title={deregisterReady ? undefined : (hasLiveRecovery ? a.recoveryBlocks : (obligationReason ?? a.conditions))}
                        onClick={() => runOperation("deregister", [], a.deregisterSuccess)}
                      >
                        {a.deregister}
                      </button>
                    </div>
                  )}
                  {!deregisterReady && activeSubject && !deregistered && (
                    <p className="form-warning" role="status">
                      {hasLiveRecovery ? a.recoveryDeregisterBlock : (obligationReason ?? a.walletCheck)}
                    </p>
                  )}
                  {Number(pendingBalance ?? 0) > 0 && (
                    <div className="action-row">
                      <button
                        className="button button-primary"
                        disabled={!WRITES_ENABLED || opsBusy}
                        onClick={() => runOperation("withdraw", [address], a.withdrawSuccess)}
                      >
                        {a.withdrawDeposit}
                      </button>
                    </div>
                  )}
                  <TransactionStatus feedback={operationsFeedback} />
                </div>

                <div className="card space-y-3">
                  <h2 className="card-title">{a.recovery}</h2>
                  {hasLiveRecovery ? (
                    <div className="callout space-y-2">
                      <p className="text-sm">
                        {formatMessage(a.recoveryLive, {
                          wallet: shortAddress(ownRecoveryView?.[0] ?? ""),
                          approvals: String(ownRecoveryView?.[5] ?? 0),
                          required: recoveryRequiredApprovals,
                          path: ownRecoveryView?.[6] === 0 ? a.samePersonPath : a.guardianPath,
                          date: new Date(Number(ownRecoveryView?.[2] ?? 0) * 1000).toLocaleString(locale),
                        })}
                      </p>
                      <p className="form-hint">{formatMessage(a.vetoWarning, { hours: recoveryWindowHours })}</p>
                      <button
                        className="button button-warning"
                        disabled={!WRITES_ENABLED || opsBusy}
                        onClick={() => runOperation("vetoRecovery", [address], a.vetoSuccess)}
                      >
                        {a.veto}
                      </button>
                    </div>
                  ) : (
                    <p className="form-hint">
                      {a.noRecovery}
                    </p>
                  )}
                  <label className="field-label">
                    {a.approveHelp}
                    <input aria-label={a.protectedAddress} placeholder="0x…" value={recoverySubject} onChange={(e) => setRecoverySubject(e.target.value)} className="field-input" />
                  </label>
                  <button
                    className="button button-secondary"
                    disabled={!WRITES_ENABLED || opsBusy || !recoverySubjectValid}
                    onClick={() => runOperation("approveRecovery", [recoverySubject.trim()], a.approveSuccess)}
                  >
                    {a.approve}
                  </button>
                </div>
              </div>
            )}

            <TransactionStatus feedback={registrationFeedback} successLabel={successLabel} />

            <h2 className="section-title mt-8 mb-2">{formatMessage(a.registeredAgents, { count: String(agentCount ?? 0) })}</h2>
            {count === 0 ? (
              <p className="form-hint">{a.noAgents}</p>
            ) : (
              <ul className="agent-list space-y-2">
                {agentList?.map((item, i) => {
                  const agent = item?.status === "success" ? (item.result as unknown as AgentMetadata) : undefined;
                  return (
                    <li key={i} className="list-row text-sm break-all">
                      <span className="font-semibold">#{i}</span>
                      {agent ? (
                        <> · {agent[0]} ({agent[1]}) · {agent[2]} · {agent[3]}</>
                      ) : (
                        <> · {t.common.failedToLoad}</>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        <WalletPicker open={walletPickerOpen} onClose={() => setWalletPickerOpen(false)} />
      </main>
    </>
  );
}
