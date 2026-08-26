import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVoteSecretRecord, readVoteSecret, saveVoteSecret, type VoteSecretScope } from "@/lib/vote-secret";
import {
  assertCapturedWallet,
  canClaimVote,
  createVotePreparationMutex,
  parseUnsignedId,
  prepareAndSubmitVote,
} from "@/app/(app)/disputes/workflow";

const votingAddress = `0x${"11".repeat(20)}` as const;
const account = `0x${"22".repeat(20)}` as const;
const salt = `0x${"33".repeat(32)}` as const;
const commitment = `0x${"44".repeat(32)}` as const;
const hash = `0x${"55".repeat(32)}` as const;
const scope: VoteSecretScope = { chainId: 31337, votingAddress, account, caseId: BigInt(7) };

beforeEach(() => localStorage.clear());

function basePreparation(overrides: Partial<Parameters<typeof prepareAndSubmitVote>[0]> = {}): Parameters<typeof prepareAndSubmitVote>[0] {
  return {
    scope,
    side: 2,
    stake: BigInt(500),
    storage: localStorage,
    mutex: createVotePreparationMutex(),
    readCommitment: async () => commitment,
    validateScope: () => undefined,
    submit: async () => hash,
    generateSalt: () => salt,
    ...overrides,
  };
}

describe("disputes commit workflow", () => {
  it("reads commitment, validates scope, stores secret, then prompts wallet with exact args", async () => {
    const order: string[] = [];
    const storage: Storage = {
      ...localStorage,
      get length() { return localStorage.length; },
      clear: () => localStorage.clear(), getItem: (key) => localStorage.getItem(key), key: (index) => localStorage.key(index),
      removeItem: (key) => localStorage.removeItem(key),
      setItem: (key, value) => { order.push("stored"); localStorage.setItem(key, value); },
    };
    const readCommitment = vi.fn(async (receivedSalt: Hex) => { order.push("read"); expect(receivedSalt).toBe(salt); return commitment; });
    const submit = vi.fn(async () => { order.push("wallet"); expect(readVoteSecret(storage, scope).status).toBe("valid"); return hash; });

    const result = await prepareAndSubmitVote(basePreparation({
      storage,
      readCommitment,
      validateScope: () => { order.push("validated"); },
      submit,
    }));

    expect(order).toEqual(["read", "validated", "stored", "wallet"]);
    expect(submit).toHaveBeenCalledWith({ caseId: BigInt(7), commitment, value: BigInt(500) });
    expect(result).toMatchObject({ hash, record: { side: 2, salt, commitment, status: "prepared" } });
  });

  it.each(["prepared", "committed"] as const)("never overwrites an existing valid %s secret", async (status) => {
    const original = createVoteSecretRecord(scope, { side: 1, salt, commitment, status, now: 1 });
    saveVoteSecret(localStorage, scope, original);
    const submit = vi.fn(async () => hash);

    await expect(prepareAndSubmitVote(basePreparation({ submit }))).rejects.toThrow(/Overwriting is blocked/);
    expect(submit).not.toHaveBeenCalled();
    expect(readVoteSecret(localStorage, scope)).toEqual({ status: "valid", record: original });
  });

  it("uses a synchronous mutex to reject a racing second preparation", async () => {
    const mutex = createVotePreparationMutex();
    let resolveCommitment: ((value: Hex) => void) | undefined;
    const delayed = new Promise<Hex>((resolve) => { resolveCommitment = resolve; });
    const first = prepareAndSubmitVote(basePreparation({ mutex, readCommitment: () => delayed }));
    const second = prepareAndSubmitVote(basePreparation({ mutex }));

    await expect(second).rejects.toThrow(/Do not submit again/);
    resolveCommitment?.(commitment);
    await expect(first).resolves.toMatchObject({ hash });
  });

  it("aborts before storage and wallet submission when captured account scope changed", async () => {
    const otherAccount = `0x${"99".repeat(20)}` as const;
    const submit = vi.fn(async () => hash);
    await expect(prepareAndSubmitVote(basePreparation({
      validateScope: () => assertCapturedWallet(scope, {
        chainId: scope.chainId, account: otherAccount, votingAddress, caseId: scope.caseId,
      }),
      submit,
    }))).rejects.toThrow(/changed/);
    expect(readVoteSecret(localStorage, scope).status).toBe("missing");
    expect(submit).not.toHaveBeenCalled();
  });

  it("leaves a prepared recoverable secret when the wallet rejects", async () => {
    await expect(prepareAndSubmitVote(basePreparation({ submit: async () => { throw new Error("wallet rejected"); } }))).rejects.toThrow("wallet rejected");
    const stored = readVoteSecret(localStorage, scope);
    expect(stored.status).toBe("valid");
    if (stored.status === "valid") expect(stored.record.status).toBe("prepared");
  });
});

describe("claim rules", () => {
  const base = { settled: true, effective: true, winner: 0 as const, committed: true, revealed: true, side: 0 as const, claimed: false };
  it("allows ineffective cases, effective winners, and revealed abstentions", () => {
    expect(canClaimVote({ ...base, effective: false, revealed: false, side: 1 })).toBe(true);
    expect(canClaimVote(base)).toBe(true);
    expect(canClaimVote({ ...base, side: 2 })).toBe(true);
  });
  it("rejects effective losers, non-revealers, uncommitted, and already claimed jurors", () => {
    expect(canClaimVote({ ...base, side: 1 })).toBe(false);
    expect(canClaimVote({ ...base, revealed: false })).toBe(false);
    expect(canClaimVote({ ...base, committed: false })).toBe(false);
    expect(canClaimVote({ ...base, claimed: true })).toBe(false);
  });
});

describe("id parsing", () => {
  it("accepts only canonical unsigned decimal ids", () => {
    expect(parseUnsignedId(" 0 ")).toBe(BigInt(0)); expect(parseUnsignedId("42")).toBe(BigInt(42));
    expect(parseUnsignedId("01")).toBeUndefined(); expect(parseUnsignedId("-1")).toBeUndefined();
  });
});
