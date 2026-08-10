import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVoteSecretRecord,
  generateVoteSalt,
  readVoteSecret,
  saveVoteSecret,
  updateVoteSecretStatus,
  voteSecretStorageKey,
  type VoteSecretScope,
} from "@/lib/vote-secret";

const scope: VoteSecretScope = {
  chainId: 31337,
  votingAddress: "0x1111111111111111111111111111111111111111",
  account: "0x2222222222222222222222222222222222222222",
  caseId: 7n,
};
const salt = `0x${"ab".repeat(32)}` as const;
const commitment = `0x${"cd".repeat(32)}` as const;

beforeEach(() => localStorage.clear());

describe("vote salt", () => {
  it("uses getRandomValues for exactly 32 bytes", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      expect(bytes).toHaveLength(32);
      bytes.forEach((_, index) => { bytes[index] = index; });
      return bytes;
    });
    const randomSpy = vi.spyOn(Math, "random");

    expect(generateVoteSalt({ getRandomValues })).toBe(`0x${Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("")}`);
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});

describe("vote secret storage", () => {
  it("round-trips a versioned record and lifecycle statuses", () => {
    const record = createVoteSecretRecord(scope, { side: 1, salt, commitment, now: 100 });
    saveVoteSecret(localStorage, scope, record);
    expect(readVoteSecret(localStorage, scope)).toEqual({ status: "valid", record });

    const updated = updateVoteSecretStatus(localStorage, scope, "committed", 101);
    expect(updated.status).toBe("valid");
    if (updated.status === "valid") {
      expect(updated.record.status).toBe("committed");
      expect(updated.record.updatedAt).toBe(101);
    }
  });

  it("isolates chain, contract, account, and case scopes", () => {
    saveVoteSecret(localStorage, scope, createVoteSecretRecord(scope, { side: 0, salt, commitment, now: 1 }));
    const variants = [
      { ...scope, chainId: 1 },
      { ...scope, votingAddress: "0x3333333333333333333333333333333333333333" as const },
      { ...scope, account: "0x4444444444444444444444444444444444444444" as const },
      { ...scope, caseId: 8n },
    ];
    for (const variant of variants) expect(readVoteSecret(localStorage, variant)).toEqual({ status: "missing" });
  });

  it.each([
    "not json",
    JSON.stringify({}),
    JSON.stringify({ ...createVoteSecretRecord(scope, { side: 2, salt, commitment, now: 1 }), version: 2 }),
    JSON.stringify({ ...createVoteSecretRecord(scope, { side: 2, salt, commitment, now: 1 }), salt: "0x12" }),
    JSON.stringify({ ...createVoteSecretRecord(scope, { side: 2, salt, commitment, now: 1 }), extra: true }),
  ])("reports malformed storage without throwing", (raw) => {
    localStorage.setItem(voteSecretStorageKey(scope), raw);
    expect(readVoteSecret(localStorage, scope).status).toBe("malformed");
  });

  it("reports unavailable storage", () => {
    const storage = { getItem: () => { throw new Error("denied"); } } as unknown as Storage;
    expect(readVoteSecret(storage, scope)).toEqual({ status: "unavailable", error: "denied" });
  });
});
