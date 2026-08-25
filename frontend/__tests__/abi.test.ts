import { describe, expect, it } from "vitest";
import {
  agentRegistryAbi,
  guaranteeEscrowAbi,
  reputationHubAbi,
  schellingVotingAbi,
} from "@/lib/abi";

type AbiParameter = { readonly name?: string; readonly type: string; readonly components?: readonly AbiParameter[] };
type AbiItem = {
  readonly type: string;
  readonly name?: string;
  readonly inputs?: readonly AbiParameter[];
  readonly outputs?: readonly AbiParameter[];
  readonly stateMutability?: string;
};

function canonicalType(parameter: AbiParameter): string {
  if (!parameter.type.startsWith("tuple")) return parameter.type;
  return `(${parameter.components?.map(canonicalType).join(",") ?? ""})${parameter.type.slice(5)}`;
}

function signatures(abi: readonly AbiItem[], type: "function" | "event"): Set<string> {
  return new Set(
    abi
      .filter((item) => item.type === type)
      .map((item) => `${item.name}(${(item.inputs ?? []).map(canonicalType).join(",")})`),
  );
}

function expectSignatures(actual: Set<string>, expected: readonly string[]): void {
  for (const signature of expected) expect(actual, `missing ABI signature: ${signature}`).toContain(signature);
}

describe("generated contract ABIs", () => {
  it("contains the registry and reputation signatures used by the frontend", () => {
    expectSignatures(signatures(agentRegistryAbi, "function"), [
      "agentCount()",
      "agents(uint256)",
      "activeSubjects(address)",
      "approveRecovery(address)",
      "bindPoH(bytes32,bytes)",
      "deregister()",
      "deposits(address)",
      "deregistered(address)",
      "isPoHVerified(address)",
      "registerAgent(string,string,string,address[])",
      "registerAgentVerified(string,string,string,bytes32,bytes,address[])",
      "registrationDeposit()",
      "responsibleParty(uint256)",
      "setGuardians(address[])",
      "slashDeposit(address,address,uint256)",
      "subjectHasOpenObligations(address)",
      "vetoRecovery(address)",
      "requestRecovery(bytes32,bytes,address)",
    ]);
    expectSignatures(signatures(reputationHubAbi, "function"), [
      "isJurorEligible(address)",
      "jurorReputation(address)",
      "recordJurorCase(bytes32,address,bool,bool,bool,bool)",
      "recordOutcome(bytes32,uint256,uint8)",
      "reputation(uint256)",
      "reputationScore(uint256)",
    ]);
  });

  it("contains the current escrow workflow signatures", () => {
    expectSignatures(signatures(guaranteeEscrowAbi, "function"), [
      "acceptGuarantee(uint256)",
      "acceptTrade(uint256)",
      "confirm(uint256)",
      "createTrade(uint256,uint256,uint256,uint256)",
      "deliver(uint256)",
      "dispute(uint256)",
      "fund(uint256)",
      "getTrade(uint256)",
      "guarantee(uint256,uint256,uint256,uint256)",
      "quoteGuaranteeTerms(uint256,uint256,uint256)",
      "tradeState(uint256)",
    ]);
  });

  it("contains commit-reveal voting reads, writes, and receipt events", () => {
    const functions = signatures(schellingVotingAbi, "function");
    expectSignatures(functions, [
      "caseDetails(uint256)",
      "caseIdForTrade(uint256)",
      "claim(uint256)",
      "commitVote(uint256,bytes32)",
      "jurorStatus(uint256,address)",
      "openCase(uint256)",
      "revealVote(uint256,uint8,bytes32)",
      "settle(uint256)",
      "voteCommitment(uint256,address,uint8,bytes32)",
    ]);
    expectSignatures(signatures(schellingVotingAbi, "event"), [
      "CaseOpened(uint256,uint256,uint256,uint256,uint256,uint256)",
      "CaseSettled(uint256,uint8,uint256,bool)",
      "VoteCommitted(uint256,address,bytes32)",
      "VoteRevealed(uint256,address,uint8)",
    ]);
  });

  it("locks the getter layouts and payable writes consumed by the pages", () => {
    const functionItem = (abi: readonly AbiItem[], name: string) =>
      abi.find((item) => item.type === "function" && item.name === name);
    const outputs = (item: AbiItem | undefined) =>
      item?.outputs?.map((output) => `${output.name}:${canonicalType(output)}`);

    expect(outputs(functionItem(schellingVotingAbi, "caseDetails"))).toEqual([
      "tradeId:uint256", "stake:uint256", "commitDeadline:uint256", "revealDeadline:uint256",
      "eligibilityAgentCount:uint256", "committedCount:uint256", "votesForBuyer:uint256",
      "votesForSeller:uint256", "abstentions:uint256", "settled:bool", "effective:bool", "winner:uint8",
    ]);
    expect(outputs(functionItem(schellingVotingAbi, "jurorStatus"))).toEqual([
      "committed:bool", "revealed:bool", "side:uint8", "claimed:bool",
    ]);
    expect(functionItem(guaranteeEscrowAbi, "dispute")?.stateMutability).toBe("payable");
    expect(functionItem(schellingVotingAbi, "commitVote")?.stateMutability).toBe("payable");
  });

  it("does not expose selectors removed by the current contracts", () => {
    const reputation = signatures(reputationHubAbi, "function");
    expect(reputation).not.toContain("authorizedCallers(address)");
    expect(reputation).not.toContain("recordOutcome(uint256,uint8)");
    expect(reputation).not.toContain("setAuthorizedCaller(address,bool)");

    const escrow = signatures(guaranteeEscrowAbi, "function");
    expect(escrow).not.toContain("createTrade(uint256,uint256,uint256)");
    expect(escrow).not.toContain("guarantee(uint256,uint256,uint256)");
    expect(escrow).not.toContain("trades(uint256)");
    expect(escrow).toContain("subjectHasActiveTrades(address)");

    const voting = signatures(schellingVotingAbi, "function");
    expect(voting).not.toContain("cases(uint256)");
    expect(voting).not.toContain("claimRefund(uint256)");
    expect(voting).not.toContain("claimReward(uint256)");
    expect(voting).not.toContain("openCase(uint256,uint256,uint256,uint256,uint256)");
    expect(voting).not.toContain("vote(uint256,uint8)");
    expect(voting).toContain("subjectHasOpenCommitments(address)");
    expect(voting).toContain("clearCommitmentObligation(uint256,address)");

    const registry = signatures(agentRegistryAbi, "function");
    expect(registry).not.toContain("registrationFee()");
    expect(registry).not.toContain("setRegistrationFee(uint256)");
    expect(registry).not.toContain("withdrawFees()");
    expect(registry).not.toContain("accruedFees()");
  });
});
