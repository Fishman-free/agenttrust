import { describe, expect, it } from "vitest";
import { TradeSubmissionGate } from "@/app/(app)/trade/workflow";

const oldHash = `0x${"11".repeat(32)}` as const;
const newHash = `0x${"22".repeat(32)}` as const;

describe("Trade submission gate", () => {
  it("locks synchronously before a wallet request returns", () => {
    const gate = new TradeSubmissionGate();
    const operation = gate.begin("create");

    expect(operation).toMatchObject({ id: 1, kind: "create" });
    expect(gate.begin("fund")).toBeUndefined();
    expect(gate.bindHash(operation!.id, oldHash)).toMatchObject({ hash: oldHash });
  });

  it("binds receipts only to the hash of the active operation", () => {
    const gate = new TradeSubmissionGate();
    const create = gate.begin("create")!;
    gate.bindHash(create.id, oldHash);

    expect(gate.matches(oldHash)).toBe(true);
    expect(gate.matches(newHash)).toBe(false);
    expect(gate.finish(create.id)).toBe(true);

    const fund = gate.begin("fund")!;
    expect(gate.matches(oldHash)).toBe(false);
    expect(gate.bindHash(fund.id, newHash)).toMatchObject({ kind: "fund", hash: newHash });
  });

  it("rejects a delayed hash from an older operation", () => {
    const gate = new TradeSubmissionGate();
    const create = gate.begin("create")!;
    expect(gate.finish(create.id)).toBe(true);

    const fund = gate.begin("fund")!;
    expect(gate.bindHash(create.id, oldHash)).toBeUndefined();
    expect(gate.current()).toEqual(fund);
    expect(gate.bindHash(fund.id, newHash)).toMatchObject({ hash: newHash });
  });
});
