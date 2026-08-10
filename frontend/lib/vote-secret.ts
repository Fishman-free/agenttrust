import type { Address, Hex } from "viem";

export const VOTE_SECRET_VERSION = 1 as const;
export const VOTE_SECRET_STORAGE_PREFIX = "agenttrust:vote-secret:v1";

export type VoteSide = 0 | 1 | 2;
export type VoteSecretLifecycle = "prepared" | "committed" | "revealed";

export type VoteSecretScope = {
  chainId: number;
  votingAddress: Address;
  account: Address;
  caseId: bigint;
};

export type VoteSecretRecord = {
  version: typeof VOTE_SECRET_VERSION;
  chainId: number;
  votingAddress: Address;
  account: Address;
  caseId: string;
  side: VoteSide;
  salt: Hex;
  commitment: Hex;
  status: VoteSecretLifecycle;
  createdAt: number;
  updatedAt: number;
};

export type VoteSecretReadResult =
  | { status: "missing" }
  | { status: "valid"; record: VoteSecretRecord }
  | { status: "malformed"; error: string }
  | { status: "unavailable"; error: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const LIFECYCLES = new Set<VoteSecretLifecycle>(["prepared", "committed", "revealed"]);

function normalizeAddress(address: Address): Address {
  return address.toLowerCase() as Address;
}

export function voteSecretStorageKey(scope: VoteSecretScope): string {
  assertScope(scope);
  return [
    VOTE_SECRET_STORAGE_PREFIX,
    scope.chainId,
    normalizeAddress(scope.votingAddress),
    normalizeAddress(scope.account),
    scope.caseId.toString(),
  ].join(":");
}

export function generateVoteSalt(cryptoSource: Pick<Crypto, "getRandomValues"> = globalThis.crypto): Hex {
  if (!cryptoSource?.getRandomValues) throw new Error("Secure crypto.getRandomValues is unavailable");
  const bytes = new Uint8Array(32);
  cryptoSource.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createVoteSecretRecord(
  scope: VoteSecretScope,
  values: { side: VoteSide; salt: Hex; commitment: Hex; status?: VoteSecretLifecycle; now?: number },
): VoteSecretRecord {
  assertScope(scope);
  const now = values.now ?? Date.now();
  const record: VoteSecretRecord = {
    version: VOTE_SECRET_VERSION,
    chainId: scope.chainId,
    votingAddress: normalizeAddress(scope.votingAddress),
    account: normalizeAddress(scope.account),
    caseId: scope.caseId.toString(),
    side: values.side,
    salt: values.salt.toLowerCase() as Hex,
    commitment: values.commitment.toLowerCase() as Hex,
    status: values.status ?? "prepared",
    createdAt: now,
    updatedAt: now,
  };
  if (!isVoteSecretRecord(record, scope)) throw new Error("Invalid vote secret record");
  return record;
}

export function isVoteSecretRecord(value: unknown, scope?: VoteSecretScope): value is VoteSecretRecord {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = ["account", "caseId", "chainId", "commitment", "createdAt", "salt", "side", "status", "updatedAt", "version", "votingAddress"].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return false;
  if (value.version !== VOTE_SECRET_VERSION || !Number.isSafeInteger(value.chainId) || (value.chainId as number) <= 0) return false;
  if (typeof value.votingAddress !== "string" || !ADDRESS.test(value.votingAddress)) return false;
  if (typeof value.account !== "string" || !ADDRESS.test(value.account)) return false;
  if (typeof value.caseId !== "string" || !DECIMAL.test(value.caseId)) return false;
  if (value.side !== 0 && value.side !== 1 && value.side !== 2) return false;
  if (typeof value.salt !== "string" || !BYTES32.test(value.salt)) return false;
  if (typeof value.commitment !== "string" || !BYTES32.test(value.commitment)) return false;
  if (typeof value.status !== "string" || !LIFECYCLES.has(value.status as VoteSecretLifecycle)) return false;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || (value.updatedAt as number) < (value.createdAt as number)) return false;
  if (!scope) return true;
  return value.chainId === scope.chainId
    && value.votingAddress.toLowerCase() === scope.votingAddress.toLowerCase()
    && value.account.toLowerCase() === scope.account.toLowerCase()
    && value.caseId === scope.caseId.toString();
}

export function saveVoteSecret(storage: Storage, scope: VoteSecretScope, record: VoteSecretRecord): void {
  if (!isVoteSecretRecord(record, scope)) throw new Error("Vote secret does not match its storage scope");
  storage.setItem(voteSecretStorageKey(scope), JSON.stringify(record));
}

export function readVoteSecret(storage: Storage, scope: VoteSecretScope): VoteSecretReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(voteSecretStorageKey(scope));
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }
  if (raw === null) return { status: "missing" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isVoteSecretRecord(parsed, scope)) return { status: "malformed", error: "Stored vote secret failed validation" };
    return { status: "valid", record: parsed };
  } catch (error) {
    return { status: "malformed", error: errorMessage(error) };
  }
}

export function updateVoteSecretStatus(
  storage: Storage,
  scope: VoteSecretScope,
  status: VoteSecretLifecycle,
  now = Date.now(),
): VoteSecretReadResult {
  const result = readVoteSecret(storage, scope);
  if (result.status !== "valid") return result;
  const next = { ...result.record, status, updatedAt: now };
  if (!isVoteSecretRecord(next, scope)) return { status: "malformed", error: "Invalid vote secret status transition" };
  try {
    storage.setItem(voteSecretStorageKey(scope), JSON.stringify(next));
    return { status: "valid", record: next };
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }
}

export function removeVoteSecret(storage: Storage, scope: VoteSecretScope): void {
  storage.removeItem(voteSecretStorageKey(scope));
}

function assertScope(scope: VoteSecretScope): void {
  if (!Number.isSafeInteger(scope.chainId) || scope.chainId <= 0) throw new Error("Invalid chain id");
  if (!ADDRESS.test(scope.votingAddress) || !ADDRESS.test(scope.account)) throw new Error("Invalid vote secret address scope");
  if (scope.caseId < BigInt(0)) throw new Error("Invalid case id");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
