import { beforeEach, describe, expect, it } from "vitest";
import {
  TX_HISTORY_KEY,
  TX_HISTORY_LIMIT,
  mergeTxRecord,
  readTxHistory,
  writeTxHistory,
  type TxRecord,
} from "@/lib/tx-history";

const base: TxRecord = {
  id: "0xabc",
  hash: "0xabc",
  kind: "trade",
  label: "Create trade",
  status: "pending",
  subject: "0x1111111111111111111111111111111111111111",
  chainId: 31337,
  timestamp: 1_000,
};

describe("mergeTxRecord", () => {
  it("upserts by id + subject + chainId instead of duplicating", () => {
    const merged = mergeTxRecord([base], { ...base, status: "success", timestamp: 2_000 });

    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("success");
    expect(merged[0].label).toBe("Create trade");
    expect(merged[0].timestamp).toBe(2_000);
  });

  it("keeps records separate across accounts", () => {
    const merged = mergeTxRecord([base], { ...base, subject: "0x2222222222222222222222222222222222222222" });
    expect(merged).toHaveLength(2);
  });

  it("sorts newest first and caps the list", () => {
    let records = [base];
    for (let i = 1; i < TX_HISTORY_LIMIT + 10; i += 1) {
      records = mergeTxRecord(records, { ...base, id: `0x${i}`, hash: `0x${i}`, timestamp: 1_000 + i });
    }

    expect(records).toHaveLength(TX_HISTORY_LIMIT);
    expect(records[0].timestamp).toBeGreaterThan(records[records.length - 1].timestamp);
  });
});

describe("storage round-trip", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists and restores records", () => {
    writeTxHistory([base]);
    expect(readTxHistory()).toEqual([base]);
  });

  it("drops malformed payloads rather than throwing", () => {
    window.localStorage.setItem(TX_HISTORY_KEY, "{not json");
    expect(readTxHistory()).toEqual([]);

    window.localStorage.setItem(TX_HISTORY_KEY, JSON.stringify({ version: 99, records: [] }));
    expect(readTxHistory()).toEqual([]);

    window.localStorage.setItem(TX_HISTORY_KEY, JSON.stringify({ version: 1, records: [{ id: "no-kind" }] }));
    expect(readTxHistory()).toEqual([]);
  });
});
