import { describe, expect, it } from "vitest";
import { getTradeStateMeta, isTradeState, requireTradeStateMeta, TRADE_STATE_META } from "@/lib/trade-state";

describe("trade state metadata", () => {
  it("maps all ten contract enum values in order", () => {
    expect(TRADE_STATE_META).toHaveLength(10);
    expect(TRADE_STATE_META.map(({ value, key }) => [value, key])).toEqual([
      [0, "CREATED"], [1, "ACCEPTED"], [2, "FUNDED"], [3, "GUARANTEE_OFFERED"], [4, "GUARANTEED"],
      [5, "DELIVERED"], [6, "DISPUTED"], [7, "RELEASED"], [8, "RESOLVED"], [9, "VOIDED"],
    ]);
  });

  it("marks only final states terminal and exposes state actions", () => {
    expect(TRADE_STATE_META.filter((state) => state.terminal).map((state) => state.key)).toEqual(["RELEASED", "RESOLVED", "VOIDED"]);
    expect(getTradeStateMeta(0)?.actions.map((item) => item.action)).toContain("acceptTrade");
    expect(getTradeStateMeta(5n)?.actions.map((item) => item.action)).toContain("dispute");
  });

  it("rejects values outside the contract enum", () => {
    expect(isTradeState(9)).toBe(true);
    expect(isTradeState(10)).toBe(false);
    expect(isTradeState(-1)).toBe(false);
    expect(getTradeStateMeta(10n)).toBeUndefined();
    expect(() => requireTradeStateMeta(99)).toThrow(/Unknown trade state/);
  });
});
