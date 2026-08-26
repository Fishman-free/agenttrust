"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeAbiParameters, formatEther, keccak256, type Address, type Hash, type Hex } from "viem";
import { useAccount, useBlock, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { TransactionStatus, useTransactionFeedback } from "@/app/components/transaction-status";
import { agentRegistryAbi, guaranteeEscrowAbi, reputationHubAbi, schellingVotingAbi } from "@/lib/abi";
import { CHAIN_ID, CONTRACT_ADDRESSES, WRITES_ENABLED } from "@/lib/config";
import { parseCaseOpened, parseVoteCommitted, parseVoteRevealed } from "@/lib/receipt-events";
import {
  readVoteSecret,
  updateVoteSecretStatus,
  type VoteSecretRecord,
  type VoteSecretScope,
  type VoteSide,
} from "@/lib/vote-secret";
import { getWriteReadiness, type WriteReadiness } from "@/lib/write-readiness";
import { cidsFromDigest, digestFromCidOrHex, gatewayUrl, pinFileToPinata, verifyRawContent } from "@/lib/ipfs";
import { assertCapturedWallet, canClaimVote, parseUnsignedId, prepareAndSubmitVote, type VotePreparationMutex } from "./workflow";

type CaseDetails = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean, number];
type JurorStatus = readonly [boolean, boolean, number, boolean];
type TradeView = {
  exists: boolean;
  id: bigint;
  buyerAgentId: bigint;
  sellerAgentId: bigint;
  buyerSubject: Address;
  sellerSubject: Address;
  guarantorSubject: Address;
  state: number;
  caseOpened: boolean;
};
type EvidenceView = { exists: boolean; contentHash: `0x${string}`; summary: string; submittedAt: bigint };
type ReputationView = { tradesCompleted: bigint; tradesDefaulted: bigint; disputesWon: bigint; disputesLost: bigint };
type WriteContext = {
  account: Address;
  chainId: number;
  votingAddress: Address;
  caseId?: bigint;
  secretScope?: VoteSecretScope;
};
type PendingOperation =
  | { kind: "dispute" | "open" | "evidence"; tradeId: bigint; context: WriteContext }
  | { kind: "commit"; commitment: Hex; context: WriteContext & { caseId: bigint; secretScope: VoteSecretScope } }
  | { kind: "reveal"; side: VoteSide; context: WriteContext & { caseId: bigint; secretScope: VoteSecretScope } }
  | { kind: "settle" | "claim" | "withdraw" | "metrics"; context: WriteContext & { caseId: bigint } };

const SIDE_LABELS = ["买家", "卖家", "弃权"] as const;

function formatDeadline(value?: bigint) {
  if (value === undefined) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(Number(value) * 1000);
}

function sameAddress(left?: Address, right?: Address) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export default function DisputesPage() {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const writer = useWriteContract();
  const [tradeIdInput, setTradeIdInput] = useState("");
  const [caseIdInput, setCaseIdInput] = useState("");
  const [selectedSide, setSelectedSide] = useState<VoteSide>(0);
  const [hash, setHash] = useState<Hash>();
  const [pendingOperation, setPendingOperation] = useState<PendingOperation>();
  const [localError, setLocalError] = useState<Error | null>(null);
  const [secret, setSecret] = useState<VoteSecretRecord>();
  const [secretMessage, setSecretMessage] = useState<string>();
  const [evidenceCid, setEvidenceCid] = useState("");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [pinataJwt, setPinataJwt] = useState("");
  const [pinStatus, setPinStatus] = useState<string>();
  const [verifyResults, setVerifyResults] = useState<{ buyer?: string; seller?: string }>({});
  const processedHash = useRef<Hash | undefined>(undefined);
  const voteMutex = useRef<VotePreparationMutex>({ locked: false });
  const walletSnapshot = useRef<{ account?: Address; chainId?: number; caseId?: bigint }>({});

  useEffect(() => {
    walletSnapshot.current = { account: address, chainId, caseId: parseUnsignedId(caseIdInput) };
  }, [address, caseIdInput, chainId]);

  useEffect(() => {
    const linkedTradeId = new URLSearchParams(window.location.search).get("tradeId");
    if (linkedTradeId !== null && parseUnsignedId(linkedTradeId) !== undefined) {
      // The query string is an external browser source synchronized only after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTradeIdInput(linkedTradeId);
    }
  }, []);

  const tradeId = parseUnsignedId(tradeIdInput);
  const caseId = parseUnsignedId(caseIdInput);
  const rightChain = chainId === CHAIN_ID;
  const readEnabled = WRITES_ENABLED;
  const blockRead = useBlock({
    query: { enabled: readEnabled && rightChain, refetchInterval: 4000 },
  });

  const tradeRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "getTrade",
    args: tradeId === undefined ? undefined : [tradeId],
    query: { enabled: readEnabled && tradeId !== undefined },
  });
  const trade = tradeRead.data as unknown as TradeView | undefined;
  const bondRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "requiredDisputeBond",
    args: tradeId === undefined ? undefined : [tradeId],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists) },
  });
  const hasCaseRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "tradeHasCase",
    args: tradeId === undefined ? undefined : [tradeId],
    query: { enabled: readEnabled && tradeId !== undefined },
  });
  const mappedCaseRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "caseIdForTrade",
    args: tradeId === undefined ? undefined : [tradeId],
    query: { enabled: readEnabled && tradeId !== undefined && hasCaseRead.data === true },
  });
  const caseStakeRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "caseStake",
    query: { enabled: readEnabled },
  });
  const caseRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "caseDetails",
    args: caseId === undefined ? undefined : [caseId],
    query: { enabled: readEnabled && caseId !== undefined, refetchInterval: 5000 },
  });
  const details = caseRead.data as unknown as CaseDetails | undefined;
  const actorsRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "tradeActors",
    args: details === undefined ? undefined : [details[0]],
    query: { enabled: readEnabled && details !== undefined },
  });
  const actors = actorsRead.data;
  const jurorRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "jurorStatus",
    args: caseId === undefined || !address ? undefined : [caseId, address],
    query: { enabled: readEnabled && caseId !== undefined && Boolean(address) },
  });
  const juror = jurorRead.data as unknown as JurorStatus | undefined;
  const snapshotEligibleRead = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "isRegisteredSubjectAtCount",
    args: details === undefined || !address ? undefined : [address, details[4]],
    query: { enabled: readEnabled && details !== undefined && Boolean(address) },
  });
  const reputationEligibleRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "isJurorEligible",
    args: address ? [address] : undefined,
    query: { enabled: readEnabled && Boolean(address) },
  });
  const withdrawalRead = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "pendingWithdrawals",
    args: address ? [address] : undefined,
    query: { enabled: readEnabled && Boolean(address), refetchInterval: 5000 },
  });
  const jurorCaseRecordId = useMemo(() => caseId === undefined || !address ? undefined : keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }],
    ["AGENTTRUST_JUROR_CASE_V1", CONTRACT_ADDRESSES.schellingVoting, BigInt(CHAIN_ID), caseId, address],
  )), [address, caseId]);
  const metricRecordedRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "recordedJurorCases",
    args: jurorCaseRecordId ? [jurorCaseRecordId] : undefined,
    query: { enabled: readEnabled && Boolean(jurorCaseRecordId), refetchInterval: 5000 },
  });

  const evidenceWindowEndRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "evidenceWindowEnd",
    args: tradeId === undefined ? undefined : [tradeId],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists) },
  });
  const buyerEvidenceRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "evidence",
    args: tradeId === undefined || !trade?.exists ? undefined : [tradeId, trade.buyerSubject],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists), refetchInterval: 5000 },
  });
  const sellerEvidenceRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "evidence",
    args: tradeId === undefined || !trade?.exists ? undefined : [tradeId, trade.sellerSubject],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists), refetchInterval: 5000 },
  });
  const buyerEvidenceCountRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "evidenceSubmissionCount",
    args: tradeId === undefined || !trade?.exists ? undefined : [tradeId, trade.buyerSubject],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists), refetchInterval: 5000 },
  });
  const sellerEvidenceCountRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "evidenceSubmissionCount",
    args: tradeId === undefined || !trade?.exists ? undefined : [tradeId, trade.sellerSubject],
    query: { enabled: readEnabled && tradeId !== undefined && Boolean(trade?.exists), refetchInterval: 5000 },
  });
  const buyerReputationRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputation",
    args: tradeId === undefined || !trade?.exists ? undefined : [trade.buyerAgentId],
    query: { enabled: readEnabled && Boolean(trade?.exists), refetchInterval: 8000 },
  });
  const buyerScoreRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputationScore",
    args: tradeId === undefined || !trade?.exists ? undefined : [trade.buyerAgentId],
    query: { enabled: readEnabled && Boolean(trade?.exists), refetchInterval: 8000 },
  });
  const sellerReputationRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputation",
    args: tradeId === undefined || !trade?.exists ? undefined : [trade.sellerAgentId],
    query: { enabled: readEnabled && Boolean(trade?.exists), refetchInterval: 8000 },
  });
  const sellerScoreRead = useReadContract({
    address: CONTRACT_ADDRESSES.reputationHub,
    abi: reputationHubAbi,
    functionName: "reputationScore",
    args: tradeId === undefined || !trade?.exists ? undefined : [trade.sellerAgentId],
    query: { enabled: readEnabled && Boolean(trade?.exists), refetchInterval: 8000 },
  });
  const nextTradeIdRead = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "nextTradeId",
    query: { enabled: readEnabled, refetchInterval: 8000 },
  });
  const historyWindow = nextTradeIdRead.data !== undefined ? Math.min(Number(nextTradeIdRead.data), 60) : 0;
  const historyRead = useReadContracts({
    contracts: Array.from({ length: historyWindow }, (_, i) => ({
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "getTrade" as const,
      args: [BigInt(historyWindow - 1 - i)] as const,
    })),
    query: { enabled: readEnabled && historyWindow > 0 },
  });

  const buyerEvidence = buyerEvidenceRead.data as unknown as EvidenceView | undefined;
  const sellerEvidence = sellerEvidenceRead.data as unknown as EvidenceView | undefined;
  const buyerReputation = buyerReputationRead.data as unknown as ReputationView | undefined;
  const sellerReputation = sellerReputationRead.data as unknown as ReputationView | undefined;

  function recentTradesFor(party?: Address) {
    if (!party || !historyRead.data) return [];
    const matches: { id: bigint; state: number; amount: bigint }[] = [];
    for (const entry of historyRead.data) {
      if (matches.length >= 5) break;
      if (entry?.status !== "success") continue;
      const record = entry.result as unknown as TradeView;
      if (sameAddress(record.buyerSubject, party) || sameAddress(record.sellerSubject, party)) {
        matches.push({ id: record.id, state: record.state, amount: BigInt(0) });
      }
    }
    return matches;
  }

  useEffect(() => {
    // Synchronize the editable field with the authoritative trade → case mapping.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mappedCaseRead.data !== undefined) setCaseIdInput(mappedCaseRead.data.toString());
  }, [mappedCaseRead.data]);

  const secretScope = useMemo<VoteSecretScope | undefined>(() => {
    if (!address || caseId === undefined) return undefined;
    return { chainId: CHAIN_ID, votingAddress: CONTRACT_ADDRESSES.schellingVoting, account: address, caseId };
  }, [address, caseId]);

  const loadSecret = useCallback(() => {
    if (!secretScope || typeof window === "undefined") {
      setSecret(undefined);
      return;
    }
    const result = readVoteSecret(window.localStorage, secretScope);
    setSecret(result.status === "valid" ? result.record : undefined);
    setSecretMessage(result.status === "malformed" || result.status === "unavailable" ? result.error : undefined);
  }, [secretScope]);

  useEffect(() => {
    // localStorage is external state scoped by chain, contract, account, and case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSecret();
  }, [loadSecret]);

  const chainTimestamp = blockRead.data?.timestamp;
  const phase = !details || chainTimestamp === undefined ? "未加载" : details[9] ? "已结算" : chainTimestamp < details[2] ? "提交" : chainTimestamp < details[3] ? "揭示" : "待结算";
  const isActor = Boolean(address && actors?.some((actor) => sameAddress(actor, address)));
  const jurorEligible = snapshotEligibleRead.data === true && reputationEligibleRead.data === true && !isActor;
  const tradeParty = Boolean(address && trade && (sameAddress(address, trade.buyerSubject) || sameAddress(address, trade.sellerSubject)));

  const feedback = useTransactionFeedback({
    hash,
    isSubmitting: writer.isPending,
    writeError: localError ?? writer.error,
  });
  const transactionBusy = feedback.phase === "submitting" || feedback.phase === "confirming";

  const readiness = useCallback((authorized: boolean, stateValid: boolean, inputValid: boolean, reasons?: Parameters<typeof getWriteReadiness>[0]["reasons"]): WriteReadiness =>
    getWriteReadiness({
      configured: WRITES_ENABLED,
      connected: isConnected,
      rightChain,
      busy: transactionBusy,
      authorized,
      stateValid,
      inputValid,
      reasons,
    }), [isConnected, rightChain, transactionBusy]);

  const disputeReady = readiness(tradeParty, trade?.exists === true && trade.state === 5 && bondRead.data !== undefined, tradeId !== undefined, {
    unauthorized: "只有该交易的买家或卖家责任主体可以发起争议。",
    "invalid-state": "交易必须处于已交付状态，且争议保证金已加载。",
  });
  const openReady = readiness(true, trade?.exists === true && trade.state === 6 && hasCaseRead.data === false, tradeId !== undefined, {
    "invalid-state": "交易必须处于争议状态且尚未开案；openCase 是无许可操作。",
  });
  const evidenceWindowOpen = trade?.state === 6 && trade?.caseOpened === false && chainTimestamp !== undefined
    && evidenceWindowEndRead.data !== undefined && chainTimestamp <= Number(evidenceWindowEndRead.data);
  const evidenceReady = readiness(tradeParty, Boolean(evidenceWindowOpen), evidenceCid.trim() !== "" || evidenceSummary.trim() !== "", {
    unauthorized: "只有该交易的买家或卖家责任主体可以举证。",
    "invalid-state": "交易必须处于争议状态、未开案且仍在举证窗口内。",
    "invalid-input": "CID/摘要与文字摘要至少填写一项。",
  });
  const commitReady = readiness(jurorEligible, phase === "提交" && juror?.[0] === false && details !== undefined && secret === undefined, caseId !== undefined && Boolean(address), {
    unauthorized: isActor ? "交易买家、卖家和担保人不能担任本案陪审员。" : "账户不在资格快照中或陪审员信誉不合格。",
    "invalid-state": secret ? "当前案件已有本地投票秘密，禁止覆盖；请使用原秘密揭示。" : "仅可在提交阶段提交一次承诺。",
  });
  const revealReady = readiness(true, phase === "揭示" && juror?.[0] === true && juror[1] === false, Boolean(secretScope && secret && secret.status !== "revealed"), {
    "invalid-state": "仅已提交且尚未揭示的陪审员可在揭示阶段操作。",
    "invalid-input": "未找到与当前链、账户和案件匹配的本地投票秘密。",
  });
  const settleReady = readiness(true, phase === "待结算", caseId !== undefined);
  const claimable = Boolean(details && juror && canClaimVote({
    settled: details[9], effective: details[10], winner: details[11] as VoteSide,
    committed: juror[0], revealed: juror[1], side: juror[2] as VoteSide, claimed: juror[3],
  }));
  const claimReady = readiness(juror?.[0] === true, claimable, caseId !== undefined, {
    unauthorized: "只有已提交投票的陪审员可以领取。",
    "invalid-state": details?.[10] === true ? "有效案件仅胜方或已揭示的弃权票可领取；败方和未揭示者会被罚没。" : "案件需已结算且当前账户尚未领取。",
  });
  const withdrawReady = readiness(true, (withdrawalRead.data ?? BigInt(0)) > BigInt(0), Boolean(address), {
    "invalid-state": "当前账户没有待提取余额。",
  });
  const metricsReady = readiness(juror?.[0] === true, details?.[9] === true && metricRecordedRead.data === false, caseId !== undefined && Boolean(address), {
    unauthorized: "当前账户未提交本案投票。",
    "invalid-state": metricRecordedRead.data === true ? "我的本案陪审员指标已经固化，不能重复提交。" : "结算后且去重状态加载完成后才能固化陪审员指标。",
  });

  const assertContextCurrent = useCallback((context: WriteContext) => {
    const current = walletSnapshot.current;
    if (current.account?.toLowerCase() !== context.account.toLowerCase() || current.chainId !== context.chainId) {
      throw new Error("钱包账户或网络已变化，已取消提交。");
    }
    if (context.caseId !== undefined && current.caseId !== context.caseId) {
      throw new Error("当前案件已变化，已取消提交。");
    }
  }, []);

  const begin = useCallback((operation: PendingOperation) => {
    writer.reset();
    setHash(undefined);
    setLocalError(null);
    setPendingOperation(operation);
    processedHash.current = undefined;
  }, [writer]);

  const submit = useCallback(async (operation: PendingOperation, write: () => Promise<Hash>) => {
    begin(operation);
    try {
      assertContextCurrent(operation.context);
      const nextHash = await write();
      setHash(nextHash);
      return nextHash;
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error(String(error)));
      return undefined;
    }
  }, [assertContextCurrent, begin]);

  async function dispute() {
    if (!disputeReady.ready || tradeId === undefined || bondRead.data === undefined || !address || chainId !== CHAIN_ID) return;
    const bond = bondRead.data;
    const context: WriteContext = { account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting };
    await submit({ kind: "dispute", tradeId, context }, () => writer.writeContractAsync({
      account: context.account,
      address: CONTRACT_ADDRESSES.guaranteeEscrow, abi: guaranteeEscrowAbi, functionName: "dispute", args: [tradeId], value: bond,
    }));
  }

  async function openCase() {
    if (!openReady.ready || tradeId === undefined || !address || chainId !== CHAIN_ID) return;
    const context: WriteContext = { account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting };
    await submit({ kind: "open", tradeId, context }, () => writer.writeContractAsync({
      account: context.account,
      address: CONTRACT_ADDRESSES.schellingVoting, abi: schellingVotingAbi, functionName: "openCase", args: [tradeId],
    }));
  }

  async function submitEvidence() {
    if (!evidenceReady.ready || tradeId === undefined || !address || chainId !== CHAIN_ID) return;
    const digest = await digestFromCidOrHex(evidenceCid);
    if (!digest && evidenceSummary.trim() === "") {
      setLocalError(new Error("CID 与摘要至少填写一项。"));
      return;
    }
    const context: WriteContext = { account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting };
    await submit({ kind: "evidence", tradeId, context }, () => writer.writeContractAsync({
      account: context.account,
      address: CONTRACT_ADDRESSES.guaranteeEscrow,
      abi: guaranteeEscrowAbi,
      functionName: "submitEvidence",
      args: [tradeId, digest ?? `0x${"00".repeat(32)}`, evidenceSummary.trim()],
    }));
  }

  async function uploadEvidenceFile(file: File) {
    if (!pinataJwt.trim()) {
      setPinStatus("请先粘贴你的 Pinata JWT（只保存在浏览器，不进仓库）。");
      return;
    }
    setPinStatus("正在上传到 IPFS（Pinata）…");
    try {
      const cid = await pinFileToPinata(file, pinataJwt.trim());
      setEvidenceCid(cid);
      setPinStatus(`已固定到 IPFS：${cid}`);
    } catch (error) {
      setPinStatus(error instanceof Error ? error.message : "上传失败");
    }
  }

  async function verifyEvidence(party: "buyer" | "seller") {
    const evidenceView = party === "buyer" ? buyerEvidence : sellerEvidence;
    if (!evidenceView?.exists || evidenceView.contentHash === `0x${"00".repeat(32)}`) return;
    const { cidv1 } = cidsFromDigest(evidenceView.contentHash);
    if (!cidv1) {
      setVerifyResults((previous) => ({ ...previous, [party]: "CID 无效" }));
      return;
    }
    const result = await verifyRawContent(cidv1, evidenceView.contentHash);
    setVerifyResults((previous) => ({
      ...previous,
      [party]: result === "match" ? "哈希一致：内容与链上锚定完全匹配" : result === "unsupported" ? "非 raw 编码（dag-pb），仅提供网关链接" : "哈希不一致或无法获取内容",
    }));
  }

  async function commitVote() {
    if (!commitReady.ready || !secretScope || !address || !publicClient || !details || chainId !== CHAIN_ID) return;
    const capturedScope = secretScope;
    const side = selectedSide;
    const context: WriteContext & { caseId: bigint; secretScope: VoteSecretScope } = {
      account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting,
      caseId: capturedScope.caseId, secretScope: capturedScope,
    };
    begin({ kind: "commit", commitment: `0x${"00".repeat(32)}`, context });
    try {
      const result = await prepareAndSubmitVote({
        scope: capturedScope,
        side,
        stake: details[1],
        storage: window.localStorage,
        mutex: voteMutex.current,
        readCommitment: (salt) => publicClient.readContract({
          address: context.votingAddress,
          abi: schellingVotingAbi,
          functionName: "voteCommitment",
          args: [context.caseId, context.account, side, salt],
        }),
        validateScope: () => assertCapturedWallet(capturedScope, {
          account: walletSnapshot.current.account,
          chainId: walletSnapshot.current.chainId,
          votingAddress: CONTRACT_ADDRESSES.schellingVoting,
          caseId: walletSnapshot.current.caseId,
        }),
        submit: ({ caseId: targetCaseId, commitment, value }) => {
          setPendingOperation({ kind: "commit", commitment, context });
          return writer.writeContractAsync({
            account: context.account,
            address: context.votingAddress,
            abi: schellingVotingAbi,
            functionName: "commitVote",
            args: [targetCaseId, commitment],
            value,
          });
        },
      });
      setSecret(result.record);
      setHash(result.hash);
    } catch (error) {
      loadSecret();
      setLocalError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async function revealVote() {
    if (!revealReady.ready || !secretScope || !secret || !address || chainId !== CHAIN_ID) return;
    const capturedSecret = secret;
    const context: WriteContext & { caseId: bigint; secretScope: VoteSecretScope } = {
      account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting,
      caseId: secretScope.caseId, secretScope,
    };
    await submit({ kind: "reveal", side: capturedSecret.side, context }, () => writer.writeContractAsync({
      account: context.account,
      address: context.votingAddress,
      abi: schellingVotingAbi,
      functionName: "revealVote",
      args: [context.caseId, capturedSecret.side, capturedSecret.salt],
    }));
  }

  async function simpleCaseWrite(kind: "settle" | "claim" | "metrics") {
    if (caseId === undefined || !address || chainId !== CHAIN_ID) return;
    const context: WriteContext & { caseId: bigint } = {
      account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting, caseId,
    };
    if (kind === "metrics") {
      if (!metricsReady.ready) return;
      await submit({ kind, context }, () => writer.writeContractAsync({
        account: context.account,
        address: context.votingAddress, abi: schellingVotingAbi, functionName: "finalizeJurorMetrics", args: [context.caseId, context.account],
      }));
    } else if (kind === "settle") {
      if (!settleReady.ready) return;
      await submit({ kind, context }, () => writer.writeContractAsync({
        account: context.account,
        address: context.votingAddress, abi: schellingVotingAbi, functionName: "settle", args: [context.caseId],
      }));
    } else {
      if (!claimReady.ready) return;
      await submit({ kind, context }, () => writer.writeContractAsync({
        account: context.account,
        address: context.votingAddress, abi: schellingVotingAbi, functionName: "claim", args: [context.caseId],
      }));
    }
  }

  async function withdraw() {
    if (!withdrawReady.ready || !address || caseId === undefined || chainId !== CHAIN_ID) return;
    const context: WriteContext & { caseId: bigint } = {
      account: address, chainId, votingAddress: CONTRACT_ADDRESSES.schellingVoting, caseId,
    };
    await submit({ kind: "withdraw", context }, () => writer.writeContractAsync({
      account: context.account,
      address: context.votingAddress, abi: schellingVotingAbi, functionName: "withdraw", args: [context.account],
    }));
  }

  const refresh = useCallback(() => {
    tradeRead.refetch(); bondRead.refetch(); hasCaseRead.refetch(); mappedCaseRead.refetch();
    caseRead.refetch(); actorsRead.refetch(); jurorRead.refetch(); snapshotEligibleRead.refetch();
    reputationEligibleRead.refetch(); withdrawalRead.refetch(); caseStakeRead.refetch(); metricRecordedRead.refetch();
    evidenceWindowEndRead.refetch(); buyerEvidenceRead.refetch(); sellerEvidenceRead.refetch();
    buyerEvidenceCountRead.refetch(); sellerEvidenceCountRead.refetch();
    buyerReputationRead.refetch(); buyerScoreRead.refetch(); sellerReputationRead.refetch(); sellerScoreRead.refetch();
    nextTradeIdRead.refetch(); historyRead.refetch(); blockRead.refetch(); loadSecret();
  }, [actorsRead, blockRead, bondRead, buyerEvidenceCountRead, buyerEvidenceRead, buyerReputationRead, buyerScoreRead,
    caseRead, caseStakeRead, evidenceWindowEndRead, hasCaseRead, historyRead, jurorRead, loadSecret, mappedCaseRead,
    metricRecordedRead, nextTradeIdRead, reputationEligibleRead, sellerEvidenceCountRead, sellerEvidenceRead,
    sellerReputationRead, sellerScoreRead, snapshotEligibleRead, tradeRead, withdrawalRead]);

  useEffect(() => {
    if (feedback.phase !== "success" || !feedback.receipt || !hash || processedHash.current === hash || !pendingOperation) return;
    let confirmed = true;
    if (pendingOperation.kind === "open") {
      const event = parseCaseOpened(feedback.receipt, CONTRACT_ADDRESSES.schellingVoting, schellingVotingAbi);
      confirmed = Boolean(event && event.args.tradeId === pendingOperation.tradeId);
      // Receipt confirmation is the authoritative source for the new case id.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (event && confirmed) setCaseIdInput(event.args.caseId.toString());
    } else if (pendingOperation.kind === "commit") {
      const event = parseVoteCommitted(feedback.receipt, pendingOperation.context.votingAddress, schellingVotingAbi);
      confirmed = Boolean(event && event.args.caseId === pendingOperation.context.caseId && sameAddress(event.args.subject, pendingOperation.context.account) && event.args.commitment.toLowerCase() === pendingOperation.commitment.toLowerCase());
      if (confirmed) updateVoteSecretStatus(window.localStorage, pendingOperation.context.secretScope, "committed");
    } else if (pendingOperation.kind === "reveal") {
      const event = parseVoteRevealed(feedback.receipt, pendingOperation.context.votingAddress, schellingVotingAbi);
      confirmed = Boolean(event && event.args.caseId === pendingOperation.context.caseId && sameAddress(event.args.subject, pendingOperation.context.account) && event.args.side === pendingOperation.side);
      if (confirmed) updateVoteSecretStatus(window.localStorage, pendingOperation.context.secretScope, "revealed");
    }
    processedHash.current = hash;
    if (!confirmed) setLocalError(new Error("交易已确认，但回执中未找到匹配的预期事件；本地状态未更新。"));
    loadSecret();
    refresh();
  }, [feedback, hash, loadSecret, pendingOperation, refresh]);

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(secret));
      setSecretMessage("投票秘密已复制，请保存到安全位置。");
    } catch (error) {
      setSecretMessage(error instanceof Error ? error.message : "复制失败");
    }
  }

  const statusLabel = pendingOperation ? {
    dispute: "争议已确认。", open: "案件已开设并自动载入。", evidence: "证据已提交。", commit: "承诺已确认，本地秘密已标记为 committed。",
    reveal: "揭示已确认，本地秘密已标记为 revealed。", settle: "案件已结算。", claim: "领取已记入待提取余额。",
    withdraw: "余额已提取。", metrics: "陪审员指标已固化。",
  }[pendingOperation.kind] : undefined;

  return (
    <main className="page page-narrow space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="page-head"><h1 className="page-title">争议与裁决</h1><p className="page-sub">承诺—揭示投票；钱包连接与切链请使用页首钱包栏。</p></div>
        <button className="button button-secondary" onClick={refresh}>重新加载链上状态</button>
      </div>

      <section className="card space-y-3">
        <h2 className="card-title">1. 交易争议与无许可开案</h2>
        <input aria-label="Trade ID" placeholder="Trade ID" value={tradeIdInput} onChange={(event) => setTradeIdInput(event.target.value)} className="field-input" />
        <dl className="detail-grid">
          <div><dt className="text-gray-500">精确争议保证金</dt><dd>{bondRead.data === undefined ? "—" : `${formatEther(bondRead.data)} ETH`}</dd></div>
          <div><dt className="text-gray-500">交易状态</dt><dd>{trade?.exists ? String(trade.state) : "—"}</dd></div>
          <div><dt className="text-gray-500">当前不可变 caseStake</dt><dd>{caseStakeRead.data === undefined ? "—" : `${formatEther(caseStakeRead.data)} ETH`}</dd></div>
          <div><dt className="text-gray-500">交易案件</dt><dd>{hasCaseRead.data === true ? `Case #${mappedCaseRead.data?.toString() ?? "加载中"}` : "尚未开案"}</dd></div>
        </dl>
        <div className="action-row">
          <GuardedButton label="支付精确保证金并发起争议" ready={disputeReady} onClick={dispute} primary />
          <GuardedButton label="openCase（任何人可调用）" ready={openReady} onClick={openCase} />
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="card-title">1.5 举证与证据（陪审员裁决依据）</h2>
        <dl className="detail-grid">
          <div><dt className="text-gray-500">举证截止</dt><dd>{formatDeadline(evidenceWindowEndRead.data)}</dd></div>
          <div><dt className="text-gray-500">链上当前时间</dt><dd>{formatDeadline(chainTimestamp ? BigInt(chainTimestamp) : undefined)}</dd></div>
        </dl>
        {evidenceWindowOpen && (
          <div className="callout space-y-2">
            <p className="text-sm">争议双方在窗口内各可提交一份证据（可覆盖更新，链上记录提交次数）；开案后证据冻结，供陪审员审阅。未举证不自动处罚，由陪审员自行判断。</p>
            <input aria-label="证据 CID 或摘要（0x…）" placeholder="IPFS CID 或 32 字节摘要（0x…）" value={evidenceCid} onChange={(event) => setEvidenceCid(event.target.value)} className="field-input" />
            <textarea aria-label="证据摘要" placeholder="链上摘要：对证据的简要说明（永久保存在链上）" value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} className="field-input" rows={2} />
            <div className="flex gap-2 flex-wrap items-center">
              <input aria-label="Pinata JWT（可选）" placeholder="Pinata JWT（可选，仅存于浏览器）" value={pinataJwt} onChange={(event) => setPinataJwt(event.target.value)} className="field-input flex-1 min-w-48" />
              <label className="button button-secondary cursor-pointer">
                上传证据到 IPFS
                <input type="file" className="hidden" aria-label="选择证据文件" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadEvidenceFile(file); }} />
              </label>
            </div>
            {pinStatus && <p className="form-hint">{pinStatus}</p>}
            <p className="form-hint">文件无人托管会从 IPFS 网络消失：请通过上传入口 pin，或自行托管后粘贴 CID。链上摘要与内容哈希永久保留，即使文件消失仍可验证历史锚定。</p>
            <GuardedButton label="提交证据" ready={evidenceReady} onClick={submitEvidence} primary />
          </div>
        )}
        {trade?.exists && (
          <div className="grid md:grid-cols-2 gap-3">
            <EvidencePartyBlock label="买方证据" subject={trade.buyerSubject} evidence={buyerEvidence} count={buyerEvidenceCountRead.data} verifyResult={verifyResults.buyer} onVerify={() => void verifyEvidence("buyer")} />
            <EvidencePartyBlock label="卖方证据" subject={trade.sellerSubject} evidence={sellerEvidence} count={sellerEvidenceCountRead.data} verifyResult={verifyResults.seller} onVerify={() => void verifyEvidence("seller")} />
          </div>
        )}
        {trade?.exists && (
          <div className="grid md:grid-cols-2 gap-3">
            <PartyReputationBlock label="买方" agentId={trade.buyerAgentId} subject={trade.buyerSubject} reputation={buyerReputation} score={buyerScoreRead.data} trades={recentTradesFor(trade.buyerSubject)} />
            <PartyReputationBlock label="卖方" agentId={trade.sellerAgentId} subject={trade.sellerSubject} reputation={sellerReputation} score={sellerScoreRead.data} trades={recentTradesFor(trade.sellerSubject)} />
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="card-title">2. 案件状态</h2>
        <input aria-label="Case ID" placeholder="Case ID（开案后自动填入）" value={caseIdInput} onChange={(event) => setCaseIdInput(event.target.value)} className="field-input" />
        {details ? (
          <dl className="detail-grid">
            <Metric label="阶段" value={phase} /><Metric label="Trade ID" value={details[0].toString()} /><Metric label="案件质押" value={`${formatEther(details[1])} ETH`} />
            <Metric label="提交截止" value={formatDeadline(details[2])} /><Metric label="揭示截止" value={formatDeadline(details[3])} /><Metric label="资格快照 Agent 数" value={details[4].toString()} />
            <Metric label="已提交" value={details[5].toString()} /><Metric label="买家票" value={details[6].toString()} /><Metric label="卖家票" value={details[7].toString()} />
            <Metric label="弃权" value={details[8].toString()} /><Metric label="有效裁决" value={details[9] ? (details[10] ? "是" : "否") : "未结算"} /><Metric label="胜方" value={details[9] ? SIDE_LABELS[details[11] as VoteSide] : "—"} />
          </dl>
        ) : <p className="form-hint">输入有效 Case ID 以加载 caseDetails。</p>}
        <div className="callout text-sm">
          <strong>当前账户 jurorStatus：</strong>{juror ? ` committed=${juror[0]} · revealed=${juror[1]} · side=${SIDE_LABELS[juror[2] as VoteSide]} · claimed=${juror[3]}` : " —"}
          <div className="text-gray-500">资格快照：{String(snapshotEligibleRead.data ?? "—")} · 信誉资格：{String(reputationEligibleRead.data ?? "—")} · 交易主体：{String(isActor)}</div>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="card-title">3. 承诺—揭示投票</h2>
        <fieldset className="flex gap-4 flex-wrap" disabled={!commitReady.ready}>
          <legend className="form-hint mb-1">选择一项；选择只会写入加密承诺</legend>
          {SIDE_LABELS.map((label, side) => <label key={label} className="flex gap-2 items-center"><input type="radio" name="vote-side" checked={selectedSide === side} onChange={() => setSelectedSide(side as VoteSide)} />{label}</label>)}
        </fieldset>
        <div className="action-row">
          <GuardedButton label="生成秘密并提交承诺" ready={commitReady} onClick={commitVote} primary />
          <GuardedButton label="用已保存秘密揭示" ready={revealReady} onClick={revealVote} />
        </div>
        <div className="callout text-sm space-y-2">
          <p className="warning-text font-semibold">重要：浏览器数据丢失将导致无法揭示并可能损失质押。提交前会先安全生成并保存 salt；请立即备份。</p>
          {secret ? <><p>本地秘密：{SIDE_LABELS[secret.side]} · 状态 {secret.status}</p><code className="block break-all">salt: {secret.salt}</code><code className="block break-all">commitment: {secret.commitment}</code><button className="button button-secondary" onClick={copySecret}>复制秘密备份（JSON）</button></> : <p className="form-hint">当前链、账户与案件没有可用秘密。</p>}
          {secretMessage && <p role="status">{secretMessage}</p>}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="card-title">4. 结算、领取与指标</h2>
        <p className="text-sm">待提取余额：<strong>{formatEther(withdrawalRead.data ?? BigInt(0))} ETH</strong></p>
        <div className="action-row">
          <GuardedButton label="结算案件" ready={settleReady} onClick={() => simpleCaseWrite("settle")} />
          <GuardedButton label="统一领取 claim" ready={claimReady} onClick={() => simpleCaseWrite("claim")} />
          <GuardedButton label="提取到当前账户" ready={withdrawReady} onClick={withdraw} />
          <GuardedButton label="固化我的陪审员指标" ready={metricsReady} onClick={() => simpleCaseWrite("metrics")} />
        </div>
      </section>

      <TransactionStatus feedback={feedback} successLabel={statusLabel} />
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-gray-500">{label}</dt><dd className="font-medium break-words">{value}</dd></div>;
}

function short(value?: Address) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

function EvidencePartyBlock({ label, subject, evidence, count, verifyResult, onVerify }: {
  label: string;
  subject: Address;
  evidence: EvidenceView | undefined;
  count: bigint | undefined;
  verifyResult?: string;
  onVerify: () => void;
}) {
  const exists = Boolean(evidence?.exists);
  const digest = exists && evidence!.contentHash !== `0x${"00".repeat(32)}` ? evidence!.contentHash : undefined;
  const cids = digest ? cidsFromDigest(digest) : undefined;
  return (
    <div className="callout text-sm space-y-1">
      <strong>{label} · {short(subject)}</strong>{" "}
      {exists ? <span>提交次数：{count?.toString() ?? "—"}</span> : <span className="warning-text">未举证</span>}
      {exists && evidence!.summary && <p>摘要：{evidence!.summary}</p>}
      {exists && <p>提交时间：{formatDeadline(evidence!.submittedAt)}</p>}
      {digest && cids && (
        <>
          <p className="break-all">内容哈希：{digest}</p>
          <p>
            {cids.cidv0 && <a className="link" href={gatewayUrl(cids.cidv0)} target="_blank" rel="noreferrer">网关查看（CIDv0）</a>}
            {cids.cidv1 && <> · <a className="link" href={gatewayUrl(cids.cidv1)} target="_blank" rel="noreferrer">网关查看（CIDv1 raw）</a></>}
            {cids.cidv1 && <button className="button button-secondary" onClick={onVerify}>校验原始文件哈希</button>}
          </p>
          {verifyResult && <p className="form-hint">{verifyResult}</p>}
        </>
      )}
    </div>
  );
}

function PartyReputationBlock({ label, agentId, subject, reputation, score, trades }: {
  label: string;
  agentId: bigint;
  subject: Address;
  reputation: ReputationView | undefined;
  score: bigint | undefined;
  trades: { id: bigint; state: number }[];
}) {
  return (
    <div className="callout text-sm space-y-1">
      <strong>{label}信誉与历史 · Agent #{agentId.toString()} · {short(subject)}</strong>
      <p>
        信誉分：<strong>{score?.toString() ?? "—"}</strong> ·
        完成 {reputation?.tradesCompleted?.toString() ?? "—"} · 违约 {reputation?.tradesDefaulted?.toString() ?? "—"} ·
        胜诉 {reputation?.disputesWon?.toString() ?? "—"} · 败诉 {reputation?.disputesLost?.toString() ?? "—"}
      </p>
      <p>最近交易：{trades.length === 0 ? "无" : trades.map((item) => `#${item.id}（状态 ${item.state}）`).join(" · ")}</p>
    </div>
  );
}

function GuardedButton({ label, ready, onClick, primary = false }: { label: string; ready: WriteReadiness; onClick: () => void; primary?: boolean }) {
  return <div><button className={primary ? "button button-primary" : "button button-secondary"} disabled={!ready.ready} onClick={onClick}>{label}</button>{!ready.ready && <p className="form-hint mt-1 max-w-xs">{ready.reason}</p>}</div>;
}
