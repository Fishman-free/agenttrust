import { randomBytes } from "node:crypto";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { encodeAbiParameters, getAddress, isHex, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { ACTION, CHAIN_ID, type Config } from "./config.js";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const responseSchema = z.object({
  identifier: z.literal("proof_of_human"),
  signal_hash: hex32,
  proof: z.array(z.string().refine((value) => isHex(value))).length(5),
  nullifier: hex32,
  issuer_schema_id: z.literal(1),
  expires_at_min: z.number().int().positive(),
}).strict();

export const idKitResultSchema = z.object({
  protocol_version: z.literal("4.0"),
  nonce: hex32,
  action: z.literal(ACTION),
  responses: z.array(responseSchema).length(1),
  user_presence_completed: z.boolean(),
  environment: z.literal("production"),
  action_description: z.string().max(200).optional(),
  identity_attested: z.boolean().optional(),
  integrity_bundle: z.unknown().optional(),
}).strict();

export const verifyRequestSchema = z.object({
  subject: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  result: idKitResultSchema,
}).strict();

export function validateResult(subjectInput: string, input: unknown, now = Math.floor(Date.now() / 1000)) {
  const subject = getAddress(subjectInput);
  const result = idKitResultSchema.parse(input);
  const response = result.responses[0]!;
  if (!result.user_presence_completed) throw new Error("user_presence_required");
  if (response.signal_hash.toLowerCase() !== hashSignal(subject).toLowerCase()) throw new Error("signal_mismatch");
  if (response.expires_at_min <= now) throw new Error("credential_expired");
  return { subject, result, response };
}

export const ATTESTATION_TYPES = {
  EnrollmentAttestation: [
    { name: "subject", type: "address" }, { name: "nullifier", type: "bytes32" },
    { name: "actionHash", type: "bytes32" }, { name: "expiry", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export async function issueAttestation(config: Config, subject: Address, nullifier: Hex, now = Math.floor(Date.now() / 1000)) {
  const expiry = now + config.WORLD_ID_ATTESTATION_TTL_SECONDS;
  const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
  const actionHash = keccak256(stringToBytes(ACTION));
  const message = { subject, nullifier, actionHash, expiry: BigInt(expiry), nonce };
  const signature = await privateKeyToAccount(config.WORLD_ID_ATTESTER_PRIVATE_KEY).signTypedData({
    domain: { name: "AgentTrust WorldID v4", version: "1", chainId: CHAIN_ID, verifyingContract: config.WORLD_ID_ADAPTER_ADDRESS },
    types: ATTESTATION_TYPES, primaryType: "EnrollmentAttestation", message,
  });
  const proof = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes" }],
    [actionHash, BigInt(expiry), nonce, signature],
  );
  return { nullifier, proof, attestation: { subject, actionHash, expiry, nonce, signature } };
}
