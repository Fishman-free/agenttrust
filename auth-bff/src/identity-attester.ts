import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import type { Config } from "./config.js";

export interface IdentityWriter {
  attest: (agentId: bigint, level: number, proofHash: Hex, domain: string) => Promise<string>;
}

export const agentRegistryAttestAbi = [
  {
    type: "function",
    name: "attestIdentity",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "level", type: "uint8" },
      { name: "proofHash", type: "bytes32" },
      { name: "domain", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/** Levels mirror AgentRegistry.VerificationLevel. */
export const VERIFICATION_LEVEL = { Declared: 0, KeyControl: 1, DomainControl: 2, Erc8004: 3 } as const;

/** Builds the production on-chain writer from config; undefined when verifier credentials are absent. */
export function buildIdentityWriter(config: Config): IdentityWriter | undefined {
  if (!config.AGENT_REGISTRY_ADDRESS || !config.AGENT_REGISTRY_RPC_URL || !config.IDENTITY_VERIFIER_PRIVATE_KEY) return undefined;
  const account = privateKeyToAccount(config.IDENTITY_VERIFIER_PRIVATE_KEY as `0x${string}`);
  const chain = config.SIWE_CHAIN_ID === 31337 ? foundry : config.SIWE_CHAIN_ID === 84532 ? baseSepolia : undefined;
  if (!chain) return undefined;
  const walletClient = createWalletClient({ account, chain, transport: http(config.AGENT_REGISTRY_RPC_URL) });
  const publicClient = createPublicClient({ chain, transport: http(config.AGENT_REGISTRY_RPC_URL) });
  return {
    async attest(agentId: bigint, level: number, proofHash: Hex, domain: string): Promise<string> {
      const hash = await walletClient.writeContract({
        address: config.AGENT_REGISTRY_ADDRESS as Address,
        abi: agentRegistryAttestAbi,
        functionName: "attestIdentity",
        args: [agentId, level, proofHash as `0x${string}`, domain],
      });
      await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      return hash;
    },
  };
}
