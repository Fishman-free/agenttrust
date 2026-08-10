"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { formatEther } from "viem";
import { agentRegistryAbi } from "@/lib/abi";
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

export default function AgentsPage() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { data: hash, writeContract, isPending, error: writeError } = useWriteContract();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const refreshedReceipt = useRef<string | undefined>(undefined);
  const registryConfigured = !isZeroAddress(CONTRACT_ADDRESSES.agentRegistry);

  const { data: feeData } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "registrationFee",
    query: { enabled: registryConfigured },
  });
  const fee = feeData === undefined ? "0" : formatEther(feeData);

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

  const feedback = useTransactionFeedback({
    hash,
    isSubmitting: isPending,
    writeError,
  });
  const registrationEvent = feedback.receipt
    ? parseAgentRegistered(feedback.receipt, CONTRACT_ADDRESSES.agentRegistry, agentRegistryAbi)
    : undefined;

  useEffect(() => {
    if (feedback.phase !== "success" || !feedback.receipt) return;
    const receiptKey = feedback.receipt.transactionHash;
    if (refreshedReceipt.current === receiptKey) return;
    refreshedReceipt.current = receiptKey;
    void Promise.all([refetchCount(), refetchList()]);
  }, [feedback.phase, feedback.receipt, refetchCount, refetchList]);

  const inputValid = Boolean(name.trim() && desc.trim() && endpoint.trim());
  const busy = isPending || feedback.phase === "confirming";
  const readiness = getWriteReadiness({
    configured: WRITES_ENABLED,
    connected: isConnected,
    rightChain: chainId === CHAIN_ID,
    busy,
    authorized: true,
    stateValid: feeData !== undefined,
    inputValid,
    reasons: {
      "not-configured": WRITE_BLOCK_REASON,
      "wrong-chain": `请切换到 ${activeChain.name}（Chain ID ${CHAIN_ID}）。`,
      "invalid-state": "注册费尚未加载。",
      "invalid-input": "请填写完整信息。",
    },
  });

  function register() {
    if (!readiness.ready) {
      alert(readiness.reason);
      return;
    }
    writeContract({
      address: CONTRACT_ADDRESSES.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "registerAgent",
      args: [name.trim(), desc.trim(), endpoint.trim()],
      value: feeData,
    });
  }

  const successLabel = registrationEvent
    ? `注册成功，新 Agent ID：${registrationEvent.args.tokenId.toString()}。`
    : feedback.phase === "success"
      ? "交易已确认，但回执中未找到 AgentRegistered 事件。"
      : undefined;

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">智能体注册</h1>
      {!isConnected && (
        <button
          className="border px-4 py-2 rounded disabled:opacity-50"
          onClick={() => connectors[0] && connect({ connector: connectors[0] })}
          disabled={!connectors[0] || isConnecting}
        >
          {isConnecting ? "连接中…" : "连接钱包"}
        </button>
      )}
      {!registryConfigured && <p className="text-sm text-amber-700 mt-3" role="status">当前网络的 AgentRegistry 尚未部署，读取与注册均已禁用。</p>}
      {isConnected && chainId !== CHAIN_ID && (
        <p className="text-sm text-red-600 mb-4" role="alert">
          网络错误：请切换到 {activeChain.name}（Chain ID {CHAIN_ID}）。
        </p>
      )}
      {isConnected && (
        <>
          <p className="text-sm text-gray-500 mb-4">当前责任主体：{address}</p>
          <div className="space-y-3">
            <input aria-label="智能体名称（如 DataAgent）" placeholder="智能体名称（如 DataAgent）" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border rounded p-2" />
            <input aria-label="能力描述（如：链上数据分析服务）" placeholder="能力描述（如：链上数据分析服务）" value={desc} onChange={(e) => setDesc(e.target.value)}
              className="w-full border rounded p-2" />
            <input aria-label="MCP/A2A 端点（https://…）" placeholder="MCP/A2A 端点（https://…）" value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
              className="w-full border rounded p-2" />
            <button
              onClick={register}
              disabled={!readiness.ready}
              title={readiness.ready ? undefined : readiness.reason}
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "注册中…" : feeData === undefined ? "加载中…" : `注册（注册费 ${fee} ETH）`}
            </button>
            {!readiness.ready && readiness.code !== "invalid-input" && (
              <p className="text-xs text-amber-700" role="status">{readiness.reason}</p>
            )}
            <TransactionStatus feedback={feedback} successLabel={successLabel} />
          </div>
          <h2 className="text-xl font-semibold mt-8 mb-2">已注册智能体（{String(agentCount ?? 0)}）</h2>
          {count === 0 ? (
            <p className="text-sm text-gray-500">暂无智能体，注册第一个吧</p>
          ) : (
            <ul className="space-y-2">
              {agentList?.map((item, i) => {
                const agent = item?.status === "success" ? (item.result as unknown as AgentMetadata) : undefined;
                return (
                  <li key={i} className="border rounded p-3 text-sm break-all">
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
