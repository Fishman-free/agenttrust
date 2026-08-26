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
export type VoteWorkflowMessages = {
  preparationLocked: string;
  existingSecret: string;
  secretCheckFailed: (error: string) => string;
  scopeChanged: string;
};

export const defaultVoteWorkflowMessages: VoteWorkflowMessages = {
  preparationLocked: "A voting secret is already being prepared. Do not submit again.",
  existingSecret: "This case already has a voting secret. Overwriting is blocked to preserve revealability.",
  secretCheckFailed: (error) => `Could not safely check the existing voting secret: ${error}`,
  scopeChanged: "The wallet account, network, or case changed. Submission was cancelled to protect the voting secret.",
};

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
  messages = defaultVoteWorkflowMessages,
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
  messages?: VoteWorkflowMessages;
}): Promise<{ hash: Hash; record: VoteSecretRecord }> {
  if (mutex.locked) throw new Error(messages.preparationLocked);
  mutex.locked = true;
  try {
    const existing = readVoteSecret(storage, scope);
    if (existing.status === "valid") throw new Error(messages.existingSecret);
    if (existing.status !== "missing") throw new Error(messages.secretCheckFailed(existing.error));

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
  message = defaultVoteWorkflowMessages.scopeChanged,
): void {
  if (current.chainId !== captured.chainId
    || current.account?.toLowerCase() !== captured.account.toLowerCase()
    || current.votingAddress.toLowerCase() !== captured.votingAddress.toLowerCase()
    || current.caseId !== captured.caseId) {
    throw new Error(message);
  }
}

export function parseUnsignedId(value: string): bigint | undefined {
  const normalized = value.trim();
  return /^(0|[1-9][0-9]*)$/.test(normalized) ? BigInt(normalized) : undefined;
}
