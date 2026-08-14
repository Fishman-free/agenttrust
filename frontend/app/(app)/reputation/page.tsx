"use client";

import { useState } from "react";
import { useReadContract } from "wagmi";
import { agentRegistryAbi, reputationHubAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES, isZeroAddress } from "@/lib/config";

function parseId(value: string): bigint | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? BigInt(trimmed) : null;
}

function formatRate(numerator: bigint, denominator: bigint): string {
  if (denominator === BigInt(0)) return "—";
  const tenths = (numerator * BigInt(1000)) / denominator;
  return `${tenths / BigInt(10)}.${tenths % BigInt(10)}%`;
}

export default function ReputationPage() {
  const [agentId, setAgentId] = useState("");
  const id = parseId(agentId);
  const valid = id !== null;
  const contractsConfigured = !isZeroAddress(CONTRACT_ADDRESSES.agentRegistry)
    && !isZeroAddress(CONTRACT_ADDRESSES.reputationHub);

  const { data: agentCount, isError: countError } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "agentCount",
    query: { enabled: contractsConfigured },
  });

  const count = agentCount ?? BigInt(0);
  const unknown = id !== null && agentCount !== undefined && id >= agentCount;
  const profileEnabled = contractsConfigured && id !== null && agentCount !== undefined && id < agentCount;
  const idArgs = id !== null ? [id] as const : undefined;

  const { data: rep, isPending: repPending, isError: repError } = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputation",
    args: idArgs,
    query: { enabled: profileEnabled },
  });
  const { data: score, isPending: scorePending, isError: scoreError } = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputationScore",
    args: idArgs,
    query: { enabled: profileEnabled },
  });
  const { data: responsibleParty, isPending: partyPending, isError: partyError } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "responsibleParty",
    args: idArgs,
    query: { enabled: profileEnabled },
  });
  const { data: currentOwner, isPending: ownerPending, isError: ownerError } = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "ownerOf",
    args: idArgs,
    query: { enabled: profileEnabled },
  });

  const subjectArgs = responsibleParty ? [responsibleParty] as const : undefined;
  const jurorEnabled = profileEnabled && responsibleParty !== undefined;
  const { data: jurorRep, isPending: jurorPending, isError: jurorError } = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "jurorReputation",
    args: subjectArgs,
    query: { enabled: jurorEnabled },
  });
  const { data: jurorEligible, isPending: eligiblePending, isError: eligibleError } = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "isJurorEligible",
    args: subjectArgs,
    query: { enabled: jurorEnabled },
  });

  const [completed, defaulted, won, lost] = rep ?? [
    BigInt(0), BigInt(0), BigInt(0), BigInt(0),
  ];
  const [casesFinalized, votesRevealed, abstentions, consensusAligned, consensusOpposed] = jurorRep ?? [
    BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0),
  ];
  const consensusSample = consensusAligned + consensusOpposed;
  const error = countError || repError || scoreError || partyError || ownerError || jurorError || eligibleError;
  const loading = contractsConfigured && (agentCount === undefined || (profileEnabled && (
    repPending || scorePending || partyPending || ownerPending || jurorPending || eligiblePending
  )));

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="page-title">信誉档案</h1>
        <p className="page-sub">把履约与裁决记录沉淀为可查询的业务信誉和陪审员指标。</p>
      </div>
      {!contractsConfigured && (
        <p className="notice notice-warning mb-4" role="status">
          当前网络的信誉合约尚未完整部署，查询已禁用。
        </p>
      )}
      <input aria-label="Agent ID" placeholder="Agent ID" value={agentId} onChange={(e) => setAgentId(e.target.value)}
        className="field-input mb-4" />
      {!valid && (
        <p className="form-hint mb-2">
          {agentId.trim() === "" ? "输入 Agent ID 查看信誉" : "请输入有效的 Agent ID（非负整数）"}
        </p>
      )}

      {contractsConfigured && valid &&
        (unknown ? (
          <div className="notice mb-4">
            {count === BigInt(0) ? (
              "该智能体不存在（暂无已注册智能体）"
            ) : (
              <>该智能体不存在（已注册 {String(count)} 个，ID 范围 0..{String(count - BigInt(1))}）</>
            )}
          </div>
        ) : error ? (
          <div className="notice notice-error mb-4">读取失败</div>
        ) : loading ? (
          <div className="notice mb-4">加载中…</div>
        ) : (
          <>
            <h2 className="section-title mb-2">Agent #{String(id)}</h2>
            <div className="card mb-4 text-center">
              <div className="score-value">{String(score ?? BigInt(0))}</div>
              <div className="form-hint mt-1">信誉分（0-100，新智能体默认 50）</div>
            </div>
            <div className="metric-grid">
              {[
                ["完成交易", completed],
                ["违约次数", defaulted],
                ["争议胜诉", won],
                ["争议败诉", lost],
              ].map(([label, value]) => (
                <div key={label} className="metric">
                  <div className="metric-value">{String(value)}</div>
                  <div className="metric-label mt-1">{label}</div>
                </div>
              ))}
            </div>

            <section className="card mt-4" aria-labelledby="identity-heading">
              <h3 id="identity-heading" className="card-title mb-2">链上身份</h3>
              <dl className="space-y-2 text-sm break-all">
                <div><dt className="font-medium">不可变责任主体</dt><dd>{responsibleParty}</dd></div>
                <div><dt className="font-medium">当前 NFT 所有者</dt><dd>{currentOwner}</dd></div>
              </dl>
              <p className="form-hint mt-2">责任主体在注册时确定且不会随 NFT 转让改变；当前所有者仅表示此刻的控制权。</p>
            </section>

            <section className="card mt-4" aria-labelledby="juror-heading">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 id="juror-heading" className="card-title">责任主体的陪审信誉</h3>
                <span className={`text-xs font-medium ${jurorEligible ? "text-green-700" : "text-gray-500"}`}>
                  {jurorEligible ? "当前符合陪审资格" : "当前不符合陪审资格"}
                </span>
              </div>
              <div className="metric-grid">
                {[
                  ["已结案样本", casesFinalized],
                  ["已揭示投票", votesRevealed],
                  ["弃权", abstentions],
                  ["揭示率", formatRate(votesRevealed, casesFinalized)],
                  ["共识样本", consensusSample],
                  ["共识一致率", formatRate(consensusAligned, consensusSample)],
                ].map(([label, value]) => (
                  <div key={label} className="metric">
                    <div className="metric-value">{String(value)}</div>
                    <div className="metric-label mt-1">{label}</div>
                  </div>
                ))}
              </div>
              <p className="form-hint mt-3">
                共识一致表示投票与有效案件的多数结果一致，不代表客观真相或裁决必然正确；共识样本仅包含可比较的一致与相反记录。
              </p>
            </section>
          </>
        ))}
      <p className="form-hint mt-4">
        数据来源：ReputationHub 链上记录（attestation 式存证，不可篡改）。新智能体默认 50 分，需担保人担保才能承接高价值订单。
      </p>
    </main>
  );
}
