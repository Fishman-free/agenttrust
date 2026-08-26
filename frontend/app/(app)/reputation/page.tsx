"use client";

import { useState } from "react";
import { useReadContract } from "wagmi";
import { agentRegistryAbi, reputationHubAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES, isZeroAddress } from "@/lib/config";
import { formatMessage, useLocale } from "@/lib/locale";

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
  const { dictionary: t } = useLocale();
  const r = t.reputation;
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
        <h1 className="page-title">{t.pages.reputationTitle}</h1>
        <p className="page-sub">{t.pages.reputationSubtitle}</p>
      </div>
      {!contractsConfigured && (
        <p className="notice notice-warning mb-4" role="status">
          {r.contractsMissing}
        </p>
      )}
      <input aria-label={r.agentId} placeholder={r.agentId} value={agentId} onChange={(e) => setAgentId(e.target.value)}
        className="field-input mb-4" />
      {!valid && (
        <p className="form-hint mb-2">
          {agentId.trim() === "" ? r.enterId : r.invalidId}
        </p>
      )}

      {contractsConfigured && valid &&
        (unknown ? (
          <div className="notice mb-4">
            {count === BigInt(0)
              ? r.noAgents
              : formatMessage(r.outOfRange, { count: String(count), lastId: String(count - BigInt(1)) })}
          </div>
        ) : error ? (
          <div className="notice notice-error mb-4">{r.readFailed}</div>
        ) : loading ? (
          <div className="notice mb-4">{t.common.loading}</div>
        ) : (
          <>
            <h2 className="section-title mb-2">{formatMessage(r.agentHeading, { id: String(id) })}</h2>
            <div className="card mb-4 text-center">
              <div className="score-value">{String(score ?? BigInt(0))}</div>
              <div className="form-hint mt-1">{r.score}</div>
            </div>
            <div className="metric-grid">
              {[
                [r.completedTrades, completed],
                [r.defaults, defaulted],
                [r.disputesWon, won],
                [r.disputesLost, lost],
              ].map(([label, value]) => (
                <div key={label} className="metric">
                  <div className="metric-value">{String(value)}</div>
                  <div className="metric-label mt-1">{label}</div>
                </div>
              ))}
            </div>

            <section className="card mt-4" aria-labelledby="identity-heading">
              <h3 id="identity-heading" className="card-title mb-2">{t.pages.reputationIdentity}</h3>
              <dl className="space-y-2 text-sm break-all">
                <div><dt className="font-medium">{t.pages.responsibleSubject}</dt><dd>{responsibleParty}</dd></div>
                <div><dt className="font-medium">{t.pages.nftOwner}</dt><dd>{currentOwner}</dd></div>
              </dl>
              <p className="form-hint mt-2">{t.pages.identityNote}</p>
            </section>

            <section className="card mt-4" aria-labelledby="juror-heading">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 id="juror-heading" className="card-title">{r.jurorHeading}</h3>
                <span className={`text-xs font-medium ${jurorEligible ? "text-green-700" : "text-gray-500"}`}>
                  {jurorEligible ? r.eligible : r.ineligible}
                </span>
              </div>
              <div className="metric-grid">
                {[
                  [r.finalizedCases, casesFinalized],
                  [r.revealedVotes, votesRevealed],
                  [r.abstentions, abstentions],
                  [r.revealRate, formatRate(votesRevealed, casesFinalized)],
                  [r.consensusSamples, consensusSample],
                  [r.consensusAlignment, formatRate(consensusAligned, consensusSample)],
                ].map(([label, value]) => (
                  <div key={label} className="metric">
                    <div className="metric-value">{String(value)}</div>
                    <div className="metric-label mt-1">{label}</div>
                  </div>
                ))}
              </div>
              <p className="form-hint mt-3">
                {r.consensusNote}
              </p>
            </section>
          </>
        ))}
      <p className="form-hint mt-4">
        {r.source}
      </p>
    </main>
  );
}
