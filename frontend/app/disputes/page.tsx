"use client";
import { useState } from "react";
import { useAccount, useConnect, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { guaranteeEscrowAbi, schellingVotingAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/lib/config";
import { parseEther } from "viem";

export default function DisputesPage() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContract, isPending } = useWriteContract();

  const [tradeId, setTradeId] = useState("");
  const [buyerId, setBuyerId] = useState("0");
  const [sellerId, setSellerId] = useState("1");
  const [caseId, setCaseId] = useState("");
  const [stake, setStake] = useState("0.05");

  // 输入校验：非法 ID / 金额直接提示，避免 BigInt/parseEther 抛异常（同交易页模式）
  function parseId(s: string): bigint | null {
    const v = s.trim();
    return /^\d+$/.test(v) ? BigInt(v) : null;
  }
  function parseAmount(s: string): bigint | null {
    try {
      return parseEther(s.trim());
    } catch {
      return null;
    }
  }

  // 发起争议：GuaranteeEscrow.dispute(tradeId)，仅交易双方可调（合约校验）
  function openDispute() {
    const t = parseId(tradeId);
    if (t === null) return alert("请填写有效的 Trade ID");
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "dispute",
      args: [t],
    });
  }
  // 开设投票案：SchellingVoting.openCase(tradeId, buyer, seller, stake, window)，onlyOwner（平台）
  // 窗口 1 天（tsconfig target ES2017 禁用 86400n 字面量，用 BigInt() 构造，同交易页 WEI_ONE 注释）
  function openCase() {
    const t = parseId(tradeId);
    const b = parseId(buyerId);
    const s = parseId(sellerId);
    const st = parseAmount(stake);
    if (t === null || b === null || s === null || st === null) {
      return alert("请填写有效的 Trade ID、Agent ID 与质押金额");
    }
    writeContract({
      address: CONTRACT_ADDRESSES.schellingVoting,
      abi: schellingVotingAbi,
      functionName: "openCase",
      args: [t, b, s, st, BigInt(86400)],
    });
  }
  // 投票：SchellingVoting.vote(caseId, side)，value = stake（T6 语义 msg.value == c.stake 精确匹配）
  function vote(side: 0 | 1) {
    const c = parseId(caseId);
    const st = parseAmount(stake);
    if (c === null || st === null) return alert("请填写有效的 Case ID 与质押金额");
    writeContract({
      address: CONTRACT_ADDRESSES.schellingVoting,
      abi: schellingVotingAbi,
      functionName: "vote",
      args: [c, side],
      value: st,
    });
  }
  function settle() {
    const c = parseId(caseId);
    if (c === null) return alert("请填写有效的 Case ID");
    writeContract({
      address: CONTRACT_ADDRESSES.schellingVoting,
      abi: schellingVotingAbi,
      functionName: "settle",
      args: [c],
    });
  }
  function claim(kind: "reward" | "refund") {
    const c = parseId(caseId);
    if (c === null) return alert("请填写有效的 Case ID");
    writeContract({
      address: CONTRACT_ADDRESSES.schellingVoting,
      abi: schellingVotingAbi,
      functionName: kind === "reward" ? "claimReward" : "claimRefund",
      args: [c],
    });
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">争议与裁决</h1>
      {!isConnected && (
        <button className="border px-4 py-2 rounded" onClick={() => connect({ connector: injected() })}>
          连接钱包
        </button>
      )}
      {isConnected && (
        <div className="space-y-4">
          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">发起争议（交易双方）</h2>
            <input placeholder="Trade ID" value={tradeId} onChange={(e) => setTradeId(e.target.value)}
              className="w-full border rounded p-2 mb-2" />
            <button onClick={openDispute} disabled={isPending}
              className="bg-orange-600 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
              {isPending ? "提交中…" : "发起争议"}
            </button>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">开设投票案（平台）</h2>
            <input placeholder="Trade ID" value={tradeId} onChange={(e) => setTradeId(e.target.value)}
              className="w-full border rounded p-2 mb-2" />
            <input placeholder="买家 Agent ID" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}
              className="w-full border rounded p-2 mb-2" />
            <input placeholder="卖家 Agent ID" value={sellerId} onChange={(e) => setSellerId(e.target.value)}
              className="w-full border rounded p-2 mb-2" />
            <button onClick={openCase} disabled={isPending}
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
              {isPending ? "提交中…" : "开设投票案（窗口 1 天）"}
            </button>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">社区投票（Schelling 收敛）</h2>
            <input placeholder="Case ID" value={caseId} onChange={(e) => setCaseId(e.target.value)}
              className="w-full border rounded p-2 mb-2" />
            <input placeholder="质押（ETH）" value={stake} onChange={(e) => setStake(e.target.value)}
              className="w-full border rounded p-2 mb-2" />
            <div className="flex gap-2">
              <button onClick={() => vote(0)} disabled={isPending}
                className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                支持买家
              </button>
              <button onClick={() => vote(1)} disabled={isPending}
                className="bg-red-600 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                支持卖家
              </button>
              <button onClick={settle} disabled={isPending}
                className="bg-gray-700 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                结算（窗口结束后）
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => claim("reward")} disabled={isPending}
                className="border px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                领取奖励（多数派）
              </button>
              <button onClick={() => claim("refund")} disabled={isPending}
                className="border px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                领取退款（作废/弃权）
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
