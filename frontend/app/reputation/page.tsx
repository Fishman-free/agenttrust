"use client";
import { useState } from "react";
import { useReadContract } from "wagmi";
import { reputationHubAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/lib/config";

export default function ReputationPage() {
  const [agentId, setAgentId] = useState("0");

  // 输入校验：非纯数字（含空输入）时返回 null，跳过链上查询，避免 BigInt 抛异常（T9-T11 模式）
  function parseId(s: string): bigint | null {
    const v = s.trim();
    return /^\d+$/.test(v) ? BigInt(v) : null;
  }
  const id = parseId(agentId);

  // 只读 view 查询，无需连接钱包；args 为 undefined 时 wagmi 不发起请求
  // reputation 返回 [tradesCompleted, tradesDefaulted, disputesWon, disputesLost]
  const { data: rep } = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputation",
    args: id === null ? undefined : [id],
  });
  const { data: score } = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputationScore",
    args: id === null ? undefined : [id],
  });

  // ABI as const 精确推断 readonly 元组，无需断言
  // tsconfig target ES2017 禁用 0n 字面量，默认值用 BigInt() 构造（同交易/争议页注释）
  const [completed, defaulted, won, lost] = rep ?? [
    BigInt(0), BigInt(0), BigInt(0), BigInt(0),
  ];

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">信誉档案</h1>
      <input placeholder="Agent ID" value={agentId} onChange={(e) => setAgentId(e.target.value)}
        className="w-full border rounded p-2 mb-4" />
      {agentId.trim() !== "" && id === null && (
        <p className="text-sm text-red-500 mb-2">请输入有效的 Agent ID（非负整数）</p>
      )}

      <div className="border rounded p-4 mb-4 text-center">
        <div className="text-5xl font-bold">{String(score ?? BigInt(0))}</div>
        <div className="text-gray-500 mt-1">信誉分（0-100，新智能体默认 50）</div>
      </div>

      <div className="grid grid-cols-4 gap-3 text-center">
        {[
          ["完成交易", completed],
          ["违约次数", defaulted],
          ["争议胜诉", won],
          ["争议败诉", lost],
        ].map(([label, v]) => (
          <div key={label} className="border rounded p-3">
            <div className="text-2xl font-semibold">{String(v)}</div>
            <div className="text-xs text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-4">
        数据来源：ReputationHub 链上记录（attestation 式存证，不可篡改）。新智能体默认 50 分，需担保人担保才能承接高价值订单。
      </p>
    </main>
  );
}
