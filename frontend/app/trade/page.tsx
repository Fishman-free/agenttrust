"use client";
import { useState } from "react";
import { useAccount, useConnect, useReadContract, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { guaranteeEscrowAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/lib/config";
import { parseEther } from "viem";

// 对应合约 GuaranteeEscrow.State 枚举（0-6）
const STATE_LABEL = ["已创建", "已付款", "已担保", "已交付", "争议中", "已释放", "已结算"] as const;

// 合约 coverage 单位：1e18 = 100%（tsconfig target ES2017，禁用 10n 字面量，用 BigInt() 构造）
const WEI_ONE = BigInt(10) ** BigInt(18);

// 各状态下的下一步可用操作（用于操作台提示）
const STATE_ACTIONS: Record<number, string> = {
  0: "买家可付款（①）",
  1: "担保人可担保（②）",
  2: "卖家可交付（③）",
  3: "买家可确认（④）或发起争议（争议页）",
  4: "争议中——需平台仲裁（争议页）",
  5: "已释放（终态）",
  6: "已结算（终态）",
};

export default function TradePage() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContract, isPending } = useWriteContract();

  const [buyerId, setBuyerId] = useState("0");
  const [sellerId, setSellerId] = useState("1");
  const [amount, setAmount] = useState("0.1");
  const [tradeId, setTradeId] = useState("");
  const [coverage, setCoverage] = useState("100");
  const [premium, setPremium] = useState("0.005");

  // 读取当前交易状态：state 位于 trades(tradeId) 返回元组的下标 7；
  // args 传 undefined 时跳过查询（未输入合法 Trade ID 时所有操作保持可用）
  const tradeIdValid = /^\d+$/.test(tradeId.trim());
  const { data: tradeData } = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "trades",
    args: tradeIdValid ? [BigInt(tradeId.trim())] : undefined,
    query: { refetchInterval: 4000 }, // 交易确认后自动刷新状态，演示无需手动刷新
  });
  const tradeState = tradeData === undefined ? undefined : Number(tradeData[7]);

  // 某操作是否适用于当前状态（未读取到状态时不限制）
  const canAct = (state: number) => tradeState === undefined || tradeState === state;

  // 输入校验：非法 ID / 金额直接提示，避免 BigInt/parseEther 抛异常
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

  function create() {
    const b = parseId(buyerId);
    const s = parseId(sellerId);
    const a = parseAmount(amount);
    if (b === null || s === null || a === null) return alert("请填写有效的 Agent ID 与交易金额");
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "createTrade",
      args: [b, s, a],
    });
  }
  function fund() {
    const t = parseId(tradeId);
    const a = parseAmount(amount);
    if (t === null || a === null) return alert("请填写有效的 Trade ID 与交易金额");
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "fund",
      args: [t],
      value: a,
    });
  }
  function guarantee() {
    // T5 语义：担保人只质押本金（覆盖率×金额），保费仅报价记录、由卖家承担
    const t = parseId(tradeId);
    const covPct = Number(coverage); // 用户输入的百分比（默认 100）
    const prem = parseAmount(premium);
    const formAmount = parseAmount(amount);
    if (t === null || !(covPct > 0 && covPct <= 200) || prem === null || formAmount === null) {
      return alert("请填写有效的 Trade ID、覆盖率（0-200%）与保费");
    }
    // coverage 合约单位为 1e18 = 100%：百分比（精度 0.01%）→ 1e18 单位，纯 wei 整数运算
    // （与合约 requiredStake = amount*coverage/1e18 同式），避免浮点/舍入导致的金额不符 revert
    const coverageWei = (BigInt(Math.round(covPct * 100)) * WEI_ONE) / BigInt(10000);
    if (coverageWei === BigInt(0)) return alert("覆盖率至少 0.01%");
    // 优先用链上真实金额（trades 下标 3），表单金额仅作回退
    const amountWei = tradeData !== undefined ? tradeData[3] : formAmount;
    const stakeWei = (amountWei * coverageWei) / WEI_ONE;
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "guarantee",
      args: [t, coverageWei, prem],
      value: stakeWei,
    });
  }
  function deliver() {
    const t = parseId(tradeId);
    if (t === null) return alert("请填写有效的 Trade ID");
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "deliver",
      args: [t],
    });
  }
  function confirm() {
    const t = parseId(tradeId);
    if (t === null) return alert("请填写有效的 Trade ID");
    writeContract({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "confirm",
      args: [t],
    });
  }

  // 担保质押额展示：与 guarantee 逻辑一致（链上金额优先 × 覆盖率）
  const covPct = Number(coverage);
  const chainAmount = tradeData !== undefined ? Number(tradeData[3]) / 1e18 : Number(amount);
  const stakeDisplay =
    Number.isFinite(chainAmount) && Number.isFinite(covPct) ? chainAmount * (covPct / 100) : 0;

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">担保交易</h1>
      {!isConnected && (
        <button className="border px-4 py-2 rounded" onClick={() => connect({ connector: injected() })}>
          连接钱包
        </button>
      )}
      {isConnected && (
        <div className="space-y-4">
          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">创建交易（买方发起）</h2>
            <input placeholder="买家 Agent ID" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}
              className="w-full border rounded p-2 mb-2" />
            <input placeholder="卖家 Agent ID" value={sellerId} onChange={(e) => setSellerId(e.target.value)}
              className="w-full border rounded p-2 mb-2" />
            <input placeholder="交易金额（ETH）" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full border rounded p-2 mb-2" />
            <button onClick={create} disabled={isPending}
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
              {isPending ? "提交中…" : "创建交易"}
            </button>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">交易流程（按状态操作）</h2>
            <input placeholder="Trade ID" value={tradeId} onChange={(e) => setTradeId(e.target.value)}
              className="w-full border rounded p-2 mb-2" />
            {tradeState !== undefined && (
              <p className="text-sm mb-2">
                <span className="font-semibold">当前状态：{STATE_LABEL[tradeState]}</span>
                {tradeData !== undefined && (
                  <span className="text-gray-500 ml-2">（Trade #{tradeData[0].toString()}）</span>
                )}
                <span className="text-gray-500 ml-2">· {STATE_ACTIONS[tradeState]}</span>
              </p>
            )}
            <div className="flex gap-2 flex-wrap items-center">
              <button onClick={fund} disabled={isPending || !canAct(0)}
                className="border px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                ① 付款（{amount} ETH）
              </button>
              <button onClick={guarantee} disabled={isPending || !canAct(1)}
                className="border px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                ② 担保（质押 {stakeDisplay.toFixed(4)} ETH）
              </button>
              <input placeholder="保费 ETH" value={premium} onChange={(e) => setPremium(e.target.value)}
                className="border rounded p-1.5 w-28" />
              <button onClick={deliver} disabled={isPending || !canAct(2)}
                className="border px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                ③ 交付（卖家）
              </button>
              <button onClick={confirm} disabled={isPending || !canAct(3)}
                className="border px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                ④ 确认（买家）
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">状态：{STATE_LABEL.join(" → ")}（超时默认动作见 DEMO.md）</p>
          </section>
        </div>
      )}
    </main>
  );
}
