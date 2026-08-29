"use client";

import { useCallback, useMemo } from "react";
import { useAccount, useReadContract } from "wagmi";
import { agentRegistryAbi, guaranteeEscrowAbi, schellingVotingAbi } from "@/lib/abi";
import { CONTRACT_ADDRESSES, isZeroAddress } from "@/lib/config";

export type RecoveryView = readonly [
  newWallet: `0x${string}`,
  nullifier: `0x${string}`,
  executeAfter: bigint,
  expiresAt: bigint,
  nonce: bigint,
  approvals: number,
  proofLevel: number,
  exists: boolean,
];

/**
 * 当前账户在 AgentRegistry 上的身份快照。
 * agents 页面与账户中心共用同一份读取，避免两处状态漂移。
 */
export function useAgentIdentity() {
  const { address } = useAccount();
  const registryConfigured = !isZeroAddress(CONTRACT_ADDRESSES.agentRegistry);
  const escrowConfigured = !isZeroAddress(CONTRACT_ADDRESSES.guaranteeEscrow);
  const votingConfigured = !isZeroAddress(CONTRACT_ADDRESSES.schellingVoting);
  const args = address ? ([address] as const) : undefined;
  const enabled = Boolean(address);

  const depositAmount = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "registrationDeposit",
    query: { enabled: registryConfigured },
  });
  const lockedDeposit = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "deposits",
    args,
    query: { enabled: registryConfigured && enabled },
  });
  const deregistered = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "deregistered",
    args,
    query: { enabled: registryConfigured && enabled },
  });
  const activeSubject = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "activeSubjects",
    args,
    query: { enabled: registryConfigured && enabled },
  });
  const pohVerified = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "isPoHVerified",
    args,
    query: { enabled: registryConfigured && enabled },
  });
  const pendingWithdrawal = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "pendingWithdrawals",
    args,
    query: { enabled: registryConfigured && enabled },
  });
  const recovery = useReadContract({
    address: CONTRACT_ADDRESSES.agentRegistry,
    abi: agentRegistryAbi,
    functionName: "recoveryRequests",
    args,
    query: { enabled: registryConfigured && enabled },
  });
  const hasActiveTrades = useReadContract({
    address: CONTRACT_ADDRESSES.guaranteeEscrow,
    abi: guaranteeEscrowAbi,
    functionName: "subjectHasActiveTrades",
    args,
    query: { enabled: escrowConfigured && enabled },
  });
  const hasOpenCommitments = useReadContract({
    address: CONTRACT_ADDRESSES.schellingVoting,
    abi: schellingVotingAbi,
    functionName: "subjectHasOpenCommitments",
    args,
    query: { enabled: votingConfigured && enabled },
  });

  const refetchAll = useCallback(() => {
    void Promise.all([
      lockedDeposit.refetch(),
      deregistered.refetch(),
      activeSubject.refetch(),
      pohVerified.refetch(),
      pendingWithdrawal.refetch(),
      recovery.refetch(),
    ]);
  }, [lockedDeposit, deregistered, activeSubject, pohVerified, pendingWithdrawal, recovery]);

  const refetchIdentity = useCallback(() => {
    void Promise.all([activeSubject.refetch(), deregistered.refetch(), pohVerified.refetch()]);
  }, [activeSubject, deregistered, pohVerified]);

  return useMemo(
    () => ({
      registryConfigured,
      escrowConfigured,
      votingConfigured,
      depositAmount: depositAmount.data as bigint | undefined,
      lockedDeposit: lockedDeposit.data as bigint | undefined,
      deregistered: deregistered.data as boolean | undefined,
      activeSubject: activeSubject.data as boolean | undefined,
      pohVerified: pohVerified.data as boolean | undefined,
      pendingWithdrawal: pendingWithdrawal.data as bigint | undefined,
      recovery: recovery.data as RecoveryView | undefined,
      hasActiveTrades: hasActiveTrades.data as boolean | undefined,
      hasOpenCommitments: hasOpenCommitments.data as boolean | undefined,
      refetchAll,
      refetchIdentity,
      refetchDeposit: lockedDeposit.refetch,
      refetchPending: pendingWithdrawal.refetch,
    }),
    [
      registryConfigured,
      escrowConfigured,
      votingConfigured,
      depositAmount.data,
      lockedDeposit.data,
      lockedDeposit.refetch,
      deregistered.data,
      activeSubject.data,
      pohVerified.data,
      pendingWithdrawal.data,
      pendingWithdrawal.refetch,
      recovery.data,
      hasActiveTrades.data,
      hasOpenCommitments.data,
      refetchAll,
      refetchIdentity,
    ],
  );
}
