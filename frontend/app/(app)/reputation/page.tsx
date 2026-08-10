"use client";
import { useState } from "react";
import { useReadContract } from "wagmi";
import { agentRegistryAbi, reputationHubAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/lib/config";

export default function ReputationPage() {
  const [agentId, setAgentId] = useState("");

  // 输入校验：非纯数字（含空输入）时返回 null，跳过链上查询，避免 BigInt 抛异常（T9-T11 模式）
  function parseId(s: string): bigint | null {
    const v = s.trim();
    return /^\d+$/.test(v) ? BigInt(v) : null;
  }
  const id = parseId(agentId);
  const valid = id !== null;

  // 已注册智能体数量：判存在性依据（不存在的 ID 与"新智能体"在 ReputationHub 中同为
  // 全零记录 + 50 分，不区分会误导担保人）
  const { data: agentCount, isError: countError } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "agentCount",
  });

  // 只读 view 查询，无需连接钱包；query.enabled 在输入非法时禁用查询
  // （wagmi v3 下 args 为 undefined 并不会自动禁用请求，需显式 enabled）
  const { data: rep, isPending: repPending, isError: repError } = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputation",
    args: id !== null ? [id] : undefined,
    query: { enabled: valid },
  });
  const { data: score, isPending: scorePending, isError: scoreError } = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputationScore",
    args: id !== null ? [id] : undefined,
    query: { enabled: valid },
  });

  // reputation 返回 [tradesCompleted, tradesDefaulted, disputesWon, disputesLost]
  // ABI as const 精确推断 readonly 元组，无需断言；target ES2017 禁用 0n 字面量，默认值用 BigInt() 构造
  const [completed, defaulted, won, lost] = rep ?? [
    BigInt(0), BigInt(0), BigInt(0), BigInt(0),
  ];

  const count = agentCount ?? BigInt(0);
  // 存在性判定：已注册 ID 范围 0..count-1；agentCount 未加载前不判定，一律视为加载中
  const unknown = id !== null && agentCount !== undefined && id >= agentCount;
  const error = repError || scoreError || countError;
  const loading = agentCount === undefined || repPending || scorePending;

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">信誉档案</h1>
      <input placeholder="Agent ID" value={agentId} onChange={(e) => setAgentId(e.target.value)}
        className="w-full border rounded p-2 mb-4" />
      {!valid && (
        <p className="text-sm text-gray-500 mb-2">
          {agentId.trim() === "" ? "输入 Agent ID 查看信誉" : "请输入有效的 Agent ID（非负整数）"}
        </p>
      )}

      {valid &&
        (unknown ? (
          <div className="border rounded p-4 text-center text-gray-500">
            {count === BigInt(0) ? (
              "该智能体不存在（暂无已注册智能体）"
            ) : (
              <>该智能体不存在（已注册 {String(count)} 个，ID 范围 0..{String(count - BigInt(1))}）</>
            )}
          </div>
        ) : error ? (
          <div className="border rounded p-4 text-center text-red-500">读取失败</div>
        ) : loading ? (
          <div className="border rounded p-4 text-center text-gray-500">加载中…</div>
        ) : (
          <>
            <h2 className="text-lg font-semibold mb-2">Agent #{String(id)}</h2>
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
          </>
        ))}
      <p className="text-xs text-gray-400 mt-4">
        数据来源：ReputationHub 链上记录（attestation 式存证，不可篡改）。新智能体默认 50 分，需担保人担保才能承接高价值订单。
      </p>
    </main>
  );
}
