"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { formatEther, isAddress } from "viem";
import { agentRegistryAbi, guaranteeEscrowAbi, schellingVotingAbi } from "@/lib/abi";
import { CHAIN_ID, CONTRACT_ADDRESSES, WRITE_BLOCK_REASON, WRITES_ENABLED, activeChain, isZeroAddress } from "@/lib/config";
import { parseAgentRegistered } from "@/lib/receipt-events";
import { getWriteReadiness } from "@/lib/write-readiness";
import { TransactionStatus, useTransactionFeedback } from "@/app/components/transaction-status";

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
  exists: boolean,
];

function shortAddress(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

export default function AgentsPage() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const registration = useWriteContract();
  const operations = useWriteContract();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [guardian1, setGuardian1] = useState("");
  const [guardian2, setGuardian2] = useState("");
  const [guardian3, setGuardian3] = useState("");
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
  const registrationEvent = registrationFeedback.receipt
    ? parseAgentRegistered(registrationFeedback.receipt, CONTRACT_ADDRESSES.agentRegistry, agentRegistryAbi)
    : undefined;

  useEffect(() => {
    if (registrationFeedback.phase !== "success" || !registrationFeedback.receipt) return;
    const receiptKey = registrationFeedback.receipt.transactionHash;
    if (refreshedReceipt.current === receiptKey) return;
    refreshedReceipt.current = receiptKey;
    void Promise.all([refetchCount(), refetchList(), refetchDeposit(), refetchActive()]);
  }, [registrationFeedback.phase, registrationFeedback.receipt, refetchCount, refetchList, refetchDeposit, refetchActive]);

  useEffect(() => {
    if (operationsFeedback.phase !== "success") return;
    void Promise.all([refetchDeposit(), refetchDeregistered(), refetchActive(), refetchPending(), refetchRecovery()]);
  }, [operationsFeedback.phase, refetchDeposit, refetchDeregistered, refetchActive, refetchPending, refetchRecovery]);

  const filledGuardians = [guardian1.trim(), guardian2.trim(), guardian3.trim()]
    .filter(Boolean)
    .map((guardian) => guardian as `0x${string}`);
  const guardianError =
    guardian1.trim() === "" || guardian2.trim() === ""
      ? "请填写至少两位守护人（紧急联系人）。"
      : !filledGuardians.every((g) => isAddress(g))
        ? "守护人地址格式无效。"
        : filledGuardians.some((g) => g.toLowerCase() === address?.toLowerCase())
          ? "不能把自己设为守护人。"
          : new Set(filledGuardians.map((g) => g.toLowerCase())).size !== filledGuardians.length
            ? "守护人地址重复。"
            : undefined;

  const inputValid = Boolean(name.trim() && desc.trim() && endpoint.trim()) && !guardianError;
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
      "wrong-chain": `请切换到 ${activeChain.name}（Chain ID ${CHAIN_ID}）。`,
      "invalid-state": "注册押金尚未加载。",
      "invalid-input": guardianError ?? "请填写完整信息。",
    },
  });

  const hasLiveRecovery = Boolean(ownRecovery && (ownRecovery as RecoveryView)[6]);
  const obligationReason = hasActiveTrades
    ? "存在未了结的交易（等待对方操作或超时）。"
    : hasOpenCommitments
      ? "存在未清结的陪审投票义务。"
      : undefined;
  const deregisterReady =
    WRITES_ENABLED && isConnected && chainId === CHAIN_ID && !opsBusy && Boolean(activeSubject)
    && !deregistered && !hasLiveRecovery && !obligationReason && Boolean(lockedDeposit !== undefined);

  function register() {
    if (!readiness.ready) {
      alert(readiness.reason);
      return;
    }
    registration.writeContract({
      address: CONTRACT_ADDRESSES.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "registerAgent",
      args: [name.trim(), desc.trim(), endpoint.trim(), filledGuardians],
      value: depositData,
    });
  }

  function runOperation(functionName: "deregister" | "vetoRecovery" | "approveRecovery" | "withdraw", args: unknown[], label: string) {
    setOpLabel(label);
    operations.writeContract({
      address: CONTRACT_ADDRESSES.agentRegistry,
      abi: agentRegistryAbi,
      functionName,
      args: args as never,
    });
  }

  const successLabel = registrationEvent
    ? `注册成功，新 Agent ID：${registrationEvent.args.tokenId.toString()}。`
    : registrationFeedback.phase === "success"
      ? "交易已确认，但回执中未找到 AgentRegistered 事件。"
      : undefined;

  const ownRecoveryView = ownRecovery as RecoveryView | undefined;
  const recoverySubjectValid = recoverySubject.trim() !== "" && isAddress(recoverySubject.trim());

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="page-title">智能体注册</h1>
        <p className="page-sub">以链上 NFT 绑定智能体与责任主体；注册押金可全额退还，丢钥可通过 World ID + 守护人找回。</p>
      </div>
      {!isConnected && (
        <button
          className="button button-primary mt-4"
          onClick={() => connectors[0] && connect({ connector: connectors[0] })}
          disabled={!connectors[0] || isConnecting}
        >
          {isConnecting ? "连接中…" : "连接钱包"}
        </button>
      )}
      {!registryConfigured && <p className="form-warning mt-3" role="status">当前网络的 AgentRegistry 尚未部署，读取与注册均已禁用。</p>}
      {isConnected && chainId !== CHAIN_ID && (
        <p className="form-error mb-4" role="alert">
          网络错误：请切换到 {activeChain.name}（Chain ID {CHAIN_ID}）。
        </p>
      )}
      {isConnected && (
        <>
          <p className="form-hint mb-4">当前责任主体：{address}</p>

          {!activeSubject && (
            <div className="card space-y-3">
              <input aria-label="智能体名称（如 DataAgent）" placeholder="智能体名称（如 DataAgent）" value={name} onChange={(e) => setName(e.target.value)}
                className="field-input" />
              <input aria-label="能力描述（如：链上数据分析服务）" placeholder="能力描述（如：链上数据分析服务）" value={desc} onChange={(e) => setDesc(e.target.value)}
                className="field-input" />
              <input aria-label="MCP/A2A 端点（https://…）" placeholder="MCP/A2A 端点（https://…）" value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
                className="field-input" />
              <label className="field-label">
                守护人 1（必填，紧急联系人地址）
                <input aria-label="守护人 1（必填）" placeholder="0x…" value={guardian1} onChange={(e) => setGuardian1(e.target.value)} className="field-input" />
              </label>
              <label className="field-label">
                守护人 2（必填）
                <input aria-label="守护人 2（必填）" placeholder="0x…" value={guardian2} onChange={(e) => setGuardian2(e.target.value)} className="field-input" />
              </label>
              <label className="field-label">
                守护人 3（可选）
                <input aria-label="守护人 3（可选）" placeholder="0x…（可选）" value={guardian3} onChange={(e) => setGuardian3(e.target.value)} className="field-input" />
              </label>
              <p className="form-hint">私钥丢失时，任一守护人批准 + World ID 同人证明即可在 24 小时否决窗口后找回身份。</p>
              <button
                onClick={register}
                disabled={!readiness.ready}
                title={readiness.ready ? undefined : readiness.reason}
                className="button button-primary"
              >
                {busy ? "注册中…" : depositData === undefined ? "加载中…" : `注册（押金 ${depositEth} ETH，可退还）`}
              </button>
              {!readiness.ready && readiness.code !== "invalid-input" && (
                <p className="form-warning" role="status">{readiness.reason}</p>
              )}
            </div>
          )}

          {activeSubject && (
            <div className="space-y-3">
              <div className="card space-y-3">
                <h2 className="card-title">我的社区身份</h2>
                <p className="text-sm">
                  状态：{deregistered ? <strong className="warning-text">已注销</strong> : <strong>活跃</strong>} ·
                  锁定押金：<strong>{lockedDeposit === undefined ? "—" : `${formatEther(lockedDeposit)} ETH`}</strong> ·
                  待提取余额：<strong>{pendingBalance === undefined ? "—" : `${formatEther(pendingBalance)} ETH`}</strong>
                </p>
                {!deregistered && (
                  <div className="action-row">
                    <button
                      className="button button-secondary"
                      disabled={!deregisterReady}
                      title={deregisterReady ? undefined : (hasLiveRecovery ? "有进行中的找回请求，先否决或等待过期。" : (obligationReason ?? "条件未满足。"))}
                      onClick={() => runOperation("deregister", [], "已注销，押金已转入待提取余额。")}
                    >
                      注销并退还押金
                    </button>
                  </div>
                )}
                {!deregisterReady && activeSubject && !deregistered && (
                  <p className="form-warning" role="status">
                    {hasLiveRecovery ? "有进行中的找回请求，注销暂不可用。" : (obligationReason ?? "请确保网络与钱包状态正确。")}
                  </p>
                )}
                {Number(pendingBalance ?? 0) > 0 && (
                  <div className="action-row">
                    <button
                      className="button button-primary"
                      disabled={!WRITES_ENABLED || opsBusy}
                      onClick={() => runOperation("withdraw", [address], "押金已提取。")}
                    >
                      提取待提取余额
                    </button>
                  </div>
                )}
                <TransactionStatus feedback={operationsFeedback} />
              </div>

              <div className="card space-y-3">
                <h2 className="card-title">找回与守护</h2>
                {ownRecoveryView?.[6] ? (
                  <div className="callout space-y-2">
                    <p className="text-sm">
                      找回请求进行中：新钱包 <code>{shortAddress(ownRecoveryView[0])}</code> ·
                      守护人批准 <strong>{String(ownRecoveryView[5])}</strong> ·
                      可执行时间 <code>{new Date(Number(ownRecoveryView[2]) * 1000).toLocaleString()}</code>
                    </p>
                    <p className="form-hint">若你并未丢失私钥，请在窗口内立即否决，否则 24 小时后身份将被迁移。</p>
                    <button
                      className="button button-warning"
                      disabled={!WRITES_ENABLED || opsBusy}
                      onClick={() => runOperation("vetoRecovery", [address], "已否决找回请求。")}
                    >
                      否决找回
                    </button>
                  </div>
                ) : (
                  <p className="form-hint">当前没有针对你的找回请求。丢失私钥时，新钱包可携带 World ID 证明发起找回（需命令行工具），守护人在下方批准。</p>
                )}
                <label className="field-label">
                  作为守护人：输入被守护人地址并批准其找回请求
                  <input aria-label="被守护人地址" placeholder="0x…" value={recoverySubject} onChange={(e) => setRecoverySubject(e.target.value)} className="field-input" />
                </label>
                <button
                  className="button button-secondary"
                  disabled={!WRITES_ENABLED || opsBusy || !recoverySubjectValid}
                  onClick={() => runOperation("approveRecovery", [recoverySubject.trim()], "已批准该找回请求。")}
                >
                  批准找回
                </button>
              </div>
            </div>
          )}

          <TransactionStatus feedback={registrationFeedback} successLabel={successLabel} />

          <h2 className="section-title mt-8 mb-2">已注册智能体（{String(agentCount ?? 0)}）</h2>
          {count === 0 ? (
            <p className="form-hint">暂无智能体，注册第一个吧</p>
          ) : (
            <ul className="agent-list space-y-2">
              {agentList?.map((item, i) => {
                const agent = item?.status === "success" ? (item.result as unknown as AgentMetadata) : undefined;
                return (
                  <li key={i} className="list-row text-sm break-all">
                    <span className="font-semibold">#{i}</span>
                    {agent ? (
                      <> · {agent[0]}（{agent[1]}） · {agent[2]} · {agent[3]}</>
                    ) : (
                      <> · 加载失败</>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
