import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  parseAgentRegistered,
  parseCaseOpened,
  parseCaseSettled,
  parseTradeCreated,
  parseVoteCommitted,
  parseVoteRevealed,
  receiptEventAbi,
  type ReceiptEventName,
  type ReceiptLike,
} from "@/lib/receipt-events";

const contract = "0x1111111111111111111111111111111111111111" as Address;
const other = "0x2222222222222222222222222222222222222222" as Address;
const subject = "0x3333333333333333333333333333333333333333" as Address;
const hash = `0x${"44".repeat(32)}` as Hex;

function receipt(eventName: ReceiptEventName, args: Record<string, unknown>, data: Hex, address = contract): ReceiptLike {
  const topics = encodeEventTopics({ abi: receiptEventAbi, eventName, args });
  return { logs: [{ address, topics, data, logIndex: 3, transactionHash: hash }] } as unknown as ReceiptLike;
}

describe("receipt event parsers", () => {
  it("parses AgentRegistered", () => {
    const result = parseAgentRegistered(receipt("AgentRegistered", { tokenId: 4n, owner: subject, name: "A" }, encodeAbiParameters([{ type: "string" }], ["A"])), contract);
    expect(result?.args).toEqual({ tokenId: 4n, owner: subject, name: "A" });
  });

  it("parses TradeCreated", () => {
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [2n, 3n, 99n]);
    expect(parseTradeCreated(receipt("TradeCreated", { tradeId: 1n }, data), contract)?.args).toEqual({ tradeId: 1n, buyerAgentId: 2n, sellerAgentId: 3n, amount: 99n });
  });

  it("parses CaseOpened", () => {
    const data = encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [10n, 20n, 30n, 40n],
    );
    expect(parseCaseOpened(receipt("CaseOpened", { caseId: 1n, tradeId: 2n }, data), contract)?.args).toEqual({ caseId: 1n, tradeId: 2n, stake: 10n, commitDeadline: 20n, revealDeadline: 30n, eligibilityAgentCount: 40n });
  });

  it("parses VoteCommitted and VoteRevealed", () => {
    const commitment = `0x${"55".repeat(32)}` as Hex;
    const committed = receipt("VoteCommitted", { caseId: 5n, subject }, encodeAbiParameters([{ type: "bytes32" }], [commitment]));
    expect(parseVoteCommitted(committed, contract)?.args).toEqual({ caseId: 5n, subject, commitment });

    const revealed = receipt("VoteRevealed", { caseId: 5n, subject }, encodeAbiParameters([{ type: "uint8" }], [1]));
    expect(parseVoteRevealed(revealed, contract)?.args).toEqual({ caseId: 5n, subject, side: 1 });
  });

  it("parses CaseSettled", () => {
    const data = encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }, { type: "bool" }], [0, 7n, true]);
    expect(parseCaseSettled(receipt("CaseSettled", { caseId: 8n }, data), contract)?.args).toEqual({ caseId: 8n, winner: 0, validVotes: 7n, effective: true });
  });

  it("filters by emitting address and returns undefined when no event matches", () => {
    const data = encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }, { type: "bool" }], [0, 7n, true]);
    const fromOther = receipt("CaseSettled", { caseId: 8n }, data, other);
    expect(parseCaseSettled(fromOther, contract)).toBeUndefined();
    expect(parseTradeCreated(fromOther, other)).toBeUndefined();
  });

  it("accepts a caller-provided ABI", () => {
    const abi = receiptEventAbi.filter((item) => item.name === "TradeCreated");
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [2n, 3n, 4n]);
    expect(parseTradeCreated(receipt("TradeCreated", { tradeId: 1n }, data), contract, abi)?.args.tradeId).toBe(1n);
  });
});
