import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { z } from "zod";
import type { Config, Purpose } from "./config.js";

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => getAddress(value));
export const signatureSchema = z.string().regex(/^0x[0-9a-fA-F]+$/).transform((value) => value as Hex);
export const nonceSchema = z.string().regex(/^[A-Za-z0-9]{16,64}$/);

export function purposeStatement(purpose: Purpose) {
  return `AgentTrust authentication purpose: ${purpose}`;
}

export function buildSiweMessage(config: Pick<Config, "SIWE_DOMAIN" | "SIWE_URI" | "SIWE_CHAIN_ID">, address: Address, purpose: Purpose, nonce: string, issuedAt: Date, expirationTime: Date) {
  return createSiweMessage({
    address,
    chainId: config.SIWE_CHAIN_ID,
    domain: config.SIWE_DOMAIN,
    uri: config.SIWE_URI,
    version: "1",
    nonce,
    statement: purposeStatement(purpose),
    issuedAt,
    expirationTime,
  });
}

export async function verifyExactSiwe(input: {
  config: Pick<Config, "SIWE_DOMAIN" | "SIWE_URI" | "SIWE_CHAIN_ID">;
  message: string;
  storedMessage: string;
  expectedAddress: Address;
  expectedNonce: string;
  expectedPurpose: Purpose;
  signature: Hex;
  now?: Date;
}) {
  if (input.message !== input.storedMessage) throw new Error("siwe_message_mismatch");
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(input.message);
  } catch {
    throw new Error("siwe_message_invalid");
  }
  const now = input.now ?? new Date();
  if (parsed.domain !== input.config.SIWE_DOMAIN) throw new Error("siwe_domain_mismatch");
  if (parsed.uri !== input.config.SIWE_URI) throw new Error("siwe_uri_mismatch");
  if (parsed.chainId !== input.config.SIWE_CHAIN_ID) throw new Error("siwe_chain_mismatch");
  if (parsed.nonce !== input.expectedNonce) throw new Error("siwe_nonce_mismatch");
  if (parsed.statement !== purposeStatement(input.expectedPurpose)) throw new Error("siwe_purpose_mismatch");
  if (!parsed.expirationTime || parsed.expirationTime.getTime() <= now.getTime()) throw new Error("siwe_expired");
  if (!parsed.issuedAt || parsed.issuedAt.getTime() > now.getTime() + 60_000) throw new Error("siwe_issued_at_invalid");
  if (!parsed.address || getAddress(parsed.address) !== input.expectedAddress) throw new Error("siwe_address_mismatch");
  const valid = await verifyMessage({ address: input.expectedAddress, message: input.message, signature: input.signature });
  if (!valid) throw new Error("siwe_signature_invalid");
  return parsed;
}
