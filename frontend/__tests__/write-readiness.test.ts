import { describe, expect, it } from "vitest";
import { getWriteReadiness, isWriteReady, type WriteReadinessInput } from "@/lib/write-readiness";

const ready: WriteReadinessInput = {
  configured: true,
  connected: true,
  rightChain: true,
  busy: false,
  authorized: true,
  stateValid: true,
  inputValid: true,
};

describe("write readiness", () => {
  it("is ready only when every guard passes", () => {
    expect(getWriteReadiness(ready)).toEqual({ ready: true, code: null, reason: null });
    expect(isWriteReady(ready)).toBe(true);
  });

  it.each([
    ["configured", false, "not-configured"],
    ["connected", false, "not-connected"],
    ["rightChain", false, "wrong-chain"],
    ["busy", true, "busy"],
    ["authorized", false, "unauthorized"],
    ["stateValid", false, "invalid-state"],
    ["inputValid", false, "invalid-input"],
  ] as const)("blocks on %s", (field, value, code) => {
    expect(getWriteReadiness({ ...ready, [field]: value })).toMatchObject({ ready: false, code });
  });

  it("uses deterministic priority and permits a custom reason", () => {
    expect(getWriteReadiness({ ...ready, connected: false, inputValid: false }).code).toBe("not-connected");
    expect(getWriteReadiness({ ...ready, authorized: false, reasons: { unauthorized: "仅买方可操作" } })).toEqual({
      ready: false,
      code: "unauthorized",
      reason: "仅买方可操作",
    });
  });
});
