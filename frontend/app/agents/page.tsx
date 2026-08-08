"use client";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useWriteContract, useReadContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { agentRegistryAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/lib/config";
import { parseEther, formatEther, type Address } from "viem";

// CONTRACT_ADDRESSES 未标注 as const，字段类型为 string；收窄为 0x 地址类型
const REGISTRY_ADDRESS: Address = CONTRACT_ADDRESSES.agentRegistry as Address;

export default function AgentsPage() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContract } = useWriteContract();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [fee, setFee] = useState("0");

  const { data: feeData } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: agentRegistryAbi,
    functionName: "registrationFee",
  });

  // wagmi v3 / react-query v5 移除了查询 onSuccess 回调，改用 effect 同步
  useEffect(() => {
    if (feeData !== undefined) setFee(formatEther(feeData));
  }, [feeData]);

  const { data: agentCount } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: agentRegistryAbi,
    functionName: "agentCount",
  });

  function register() {
    if (!name || !desc || !endpoint) return alert("请填写完整信息");
    writeContract({
      address: REGISTRY_ADDRESS,
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
            <input placeholder="智能体名称（如 DataAgent）" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border rounded p-2" />
            <input placeholder="能力描述（如：链上数据分析服务）" value={desc} onChange={(e) => setDesc(e.target.value)}
              className="w-full border rounded p-2" />
            <input placeholder="MCP/A2A 端点（https://…）" value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
              className="w-full border rounded p-2" />
            <button onClick={register} className="bg-blue-600 text-white px-4 py-2 rounded">
              注册（注册费 {fee} ETH）
            </button>
          </div>
          <h2 className="text-xl font-semibold mt-8 mb-2">已注册智能体（{String(agentCount ?? 0)}）</h2>
        </>
      )}
    </main>
  );
}
