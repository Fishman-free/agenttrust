import { decodeEventLog, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";

/** Minimal current event ABI. Replace with or pass a regenerated contract ABI without changing parsers. */
export const receiptEventAbi = [
  { type: "event", name: "AgentRegistered", inputs: [
    { name: "tokenId", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "name", type: "string", indexed: false },
  ] },
  { type: "event", name: "TradeCreated", inputs: [
    { name: "tradeId", type: "uint256", indexed: true },
    { name: "buyerAgentId", type: "uint256", indexed: false },
    { name: "sellerAgentId", type: "uint256", indexed: false },
    { name: "amount", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "CaseOpened", inputs: [
    { name: "caseId", type: "uint256", indexed: true },
    { name: "tradeId", type: "uint256", indexed: true },
    { name: "stake", type: "uint256", indexed: false },
    { name: "commitDeadline", type: "uint256", indexed: false },
    { name: "revealDeadline", type: "uint256", indexed: false },
    { name: "eligibilityAgentCount", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "VoteCommitted", inputs: [
    { name: "caseId", type: "uint256", indexed: true },
    { name: "subject", type: "address", indexed: true },
    { name: "commitment", type: "bytes32", indexed: false },
  ] },
  { type: "event", name: "VoteRevealed", inputs: [
    { name: "caseId", type: "uint256", indexed: true },
    { name: "subject", type: "address", indexed: true },
    { name: "side", type: "uint8", indexed: false },
  ] },
  { type: "event", name: "CaseSettled", inputs: [
    { name: "caseId", type: "uint256", indexed: true },
    { name: "winner", type: "uint8", indexed: false },
    { name: "validVotes", type: "uint256", indexed: false },
    { name: "effective", type: "bool", indexed: false },
  ] },
] as const satisfies Abi;

export type ReceiptEventName = "AgentRegistered" | "TradeCreated" | "CaseOpened" | "VoteCommitted" | "VoteRevealed" | "CaseSettled";
export type ReceiptLike = Pick<TransactionReceipt, "logs">;
export type ParsedReceiptEvent<TArgs> = {
  eventName: ReceiptEventName;
  args: TArgs;
  address: Address;
  logIndex: number | null;
  transactionHash: Hex | null;
};

export type AgentRegisteredArgs = { tokenId: bigint; owner: Address; name: string };
export type TradeCreatedArgs = { tradeId: bigint; buyerAgentId: bigint; sellerAgentId: bigint; amount: bigint };
export type CaseOpenedArgs = { caseId: bigint; tradeId: bigint; stake: bigint; commitDeadline: bigint; revealDeadline: bigint; eligibilityAgentCount: bigint };
export type VoteCommittedArgs = { caseId: bigint; subject: Address; commitment: Hex };
export type VoteRevealedArgs = { caseId: bigint; subject: Address; side: number };
export type CaseSettledArgs = { caseId: bigint; winner: number; validVotes: bigint; effective: boolean };

export function findReceiptEvent<TArgs>(
  receipt: ReceiptLike,
  eventName: ReceiptEventName,
  contractAddress: Address,
  abi: Abi = receiptEventAbi,
): ParsedReceiptEvent<TArgs> | undefined {
  const expectedAddress = contractAddress.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== expectedAddress) continue;
    try {
      const decoded = decodeEventLog({ abi, eventName, data: log.data, topics: log.topics, strict: true });
      if (decoded.eventName !== eventName) continue;
      return {
        eventName,
        args: decoded.args as TArgs,
        address: log.address,
        logIndex: log.logIndex,
        transactionHash: log.transactionHash,
      };
    } catch {
      // A receipt can contain unrelated or malformed logs from the same contract.
    }
  }
  return undefined;
}

export const parseAgentRegistered = (receipt: ReceiptLike, address: Address, abi?: Abi) =>
  findReceiptEvent<AgentRegisteredArgs>(receipt, "AgentRegistered", address, abi);
export const parseTradeCreated = (receipt: ReceiptLike, address: Address, abi?: Abi) =>
  findReceiptEvent<TradeCreatedArgs>(receipt, "TradeCreated", address, abi);
export const parseCaseOpened = (receipt: ReceiptLike, address: Address, abi?: Abi) =>
  findReceiptEvent<CaseOpenedArgs>(receipt, "CaseOpened", address, abi);
export const parseVoteCommitted = (receipt: ReceiptLike, address: Address, abi?: Abi) =>
  findReceiptEvent<VoteCommittedArgs>(receipt, "VoteCommitted", address, abi);
export const parseVoteRevealed = (receipt: ReceiptLike, address: Address, abi?: Abi) =>
  findReceiptEvent<VoteRevealedArgs>(receipt, "VoteRevealed", address, abi);
export const parseCaseSettled = (receipt: ReceiptLike, address: Address, abi?: Abi) =>
  findReceiptEvent<CaseSettledArgs>(receipt, "CaseSettled", address, abi);
