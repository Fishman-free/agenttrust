import type { Hash, Hex } from "viem";
import {
  createVoteSecretRecord,
  generateVoteSalt,
  readVoteSecret,
  saveVoteSecret,
  type VoteSecretRecord,
  type VoteSecretScope,
  type VoteSide,
} from "@/lib/vote-secret";

export type CommitVoteRequest = { caseId: bigint; commitment: Hex; value: bigint };
export type VotePreparationMutex = { locked: boolean };

export function createVotePreparationMutex(): VotePreparationMutex {
  return { locked: false };
}

/** Persists reveal material before invoking the wallet, without ever replacing an existing secret. */
export async function prepareAndSubmitVote({
  scope,
  side,
  stake,
  storage,
  mutex,
  readCommitment,
  validateScope,
  submit,
  generateSalt = generateVoteSalt,
}: {
  scope: VoteSecretScope;
  side: VoteSide;
  stake: bigint;
  storage: Storage;
  mutex: VotePreparationMutex;
  readCommitment: (salt: Hex) => Promise<Hex>;
  validateScope: () => void;
  submit: (request: CommitVoteRequest) => Promise<Hash>;
  generateSalt?: () => Hex;
}): Promise<{ hash: Hash; record: VoteSecretRecord }> {
  if (mutex.locked) throw new Error("投票秘密正在准备中，请勿重复提交。");
  mutex.locked = true;
  try {
    const existing = readVoteSecret(storage, scope);
    if (existing.status === "valid") throw new Error("当前案件已有投票秘密；为防止无法揭示，禁止覆盖。");
    if (existing.status !== "missing") throw new Error(`无法安全检查已有投票秘密：${existing.error}`);

    const salt = generateSalt();
    const commitment = await readCommitment(salt);
    validateScope();
    const record = createVoteSecretRecord(scope, { side, salt, commitment });
    saveVoteSecret(storage, scope, record);
    const hash = await submit({ caseId: scope.caseId, commitment, value: stake });
    return { hash, record };
  } finally {
    mutex.locked = false;
  }
}

export type ClaimStatus = {
  settled: boolean;
  effective: boolean;
  winner: VoteSide;
  committed: boolean;
  revealed: boolean;
  side: VoteSide;
  claimed: boolean;
};

export function canClaimVote(status: ClaimStatus): boolean {
  if (!status.settled || !status.committed || status.claimed) return false;
  if (!status.effective) return true;
  return status.revealed && (status.side === 2 || status.side === status.winner);
}

export function assertCapturedWallet(
  captured: Pick<VoteSecretScope, "chainId" | "account" | "votingAddress" | "caseId">,
  current: { chainId?: number; account?: `0x${string}`; votingAddress: `0x${string}`; caseId?: bigint },
): void {
  if (current.chainId !== captured.chainId
    || current.account?.toLowerCase() !== captured.account.toLowerCase()
    || current.votingAddress.toLowerCase() !== captured.votingAddress.toLowerCase()
    || current.caseId !== captured.caseId) {
    throw new Error("钱包账户、网络或案件已变化，已取消提交以保护投票秘密。");
  }
}

export function parseUnsignedId(value: string): bigint | undefined {
  const normalized = value.trim();
  return /^(0|[1-9][0-9]*)$/.test(normalized) ? BigInt(normalized) : undefined;
}
