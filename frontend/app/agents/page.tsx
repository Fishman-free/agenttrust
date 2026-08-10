"use client";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useWriteContract, useReadContract, useReadContracts } from "wagmi";
import { injected } from "wagmi/connectors";
import { agentRegistryAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES, WRITES_ENABLED } from "@/lib/config";
import { parseEther, formatEther } from "viem";

// agents(tokenId) 返回 [name, description, endpoint, owner, createdAt]
// useReadContracts 的动态 contracts 数组无法推断 ABI 结果，需显式断言
type AgentMetadata = readonly [
  name: string,
  description: string,
  endpoint: string,
  owner: `0x${string}`,
  createdAt: bigint,
];

export default function AgentsPage() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContract, isPending, isSuccess: writeSuccess } = useWriteContract();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [endpoint, setEndpoint] = useState("");

  const { data: feeData } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "registrationFee",
  });

  const fee = feeData === undefined ? "0" : formatEther(feeData);

  const { data: agentCount, refetch: refetchCount } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "agentCount",
  });

  // 批量读取已注册智能体元数据（agents(tokenId) 返回 [name, description, endpoint, owner, createdAt]）
  const count = Number(agentCount ?? 0);
  const { data: agentList, refetch: refetchList } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: CONTRACT_ADDRESSES.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "agents",
      args: [BigInt(i)],
    })),
  });

  // 注册交易成功后刷新计数与列表
  useEffect(() => {
    if (writeSuccess) {
      refetchCount();
      refetchList();
    }
  }, [writeSuccess, refetchCount, refetchList]);

  function register() {
    if (!name || !desc || !endpoint) return alert("请填写完整信息");
    writeContract({
      address: CONTRACT_ADDRESSES.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "registerAgent",
      args: [name, desc, endpoint],
      value: parseEther(fee),
    });
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">智能体注册</h1>
      {!isConnected && (
        <button className="border px-4 py-2 rounded" onClick={() => connect({ connector: injected() })}>
          连接钱包
        </button>
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
              disabled={!WRITES_ENABLED || isPending || feeData === undefined}
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? "注册中…" : feeData === undefined ? "加载中…" : `注册（注册费 ${fee} ETH）`}
            </button>
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
