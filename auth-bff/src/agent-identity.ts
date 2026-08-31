import { keccak256, numberToHex, padHex, toHex, verifyMessage, type Address, type Hex } from "viem";
import { recoverAddress } from "viem";

export const BINDING_PREFIX = "AgentTrust external-agent binding: ";

const DOMAIN_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** keccak256(abi.encodePacked(BINDING_PREFIX, agentId, nonce)) — matches AgentRegistry.proveKeyControl. */
export function buildBindingDigest(agentId: bigint, nonce: Hex): Hex {
  return keccak256(concatHex([toHex(BINDING_PREFIX), numberToHex(agentId, { size: 32 }), nonce]));
}

/** Recovers the external agent's control key from an EIP-191 signature over the binding digest. */
export async function verifyKeyControl(agentId: bigint, nonce: Hex, signature: Hex): Promise<Address> {
  try {
    return await recoverAddress({
      hash: keccak256(concatHex([toHex("\x19Ethereum Signed Message:\n32"), buildBindingDigest(agentId, nonce)])),
      signature,
    });
  } catch {
    throw new Error("binding_signature_mismatch");
  }
}

/** Convenience check mirroring verifyKeyControl via viem's verifyMessage for raw 32-byte messages. */
export async function verifyBindingSignature(agentId: bigint, nonce: Hex, signature: Hex, expectedControlKey: Address): Promise<boolean> {
  return verifyMessage({ address: expectedControlKey, message: { raw: buildBindingDigest(agentId, nonce) }, signature });
}

export function randomBindingNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** ERC-8004 global agent registry identifier: {namespace}:{chainId}:{identityRegistry}. */
export function buildAgentRegistryId(chainId: bigint, registry: Address): string {
  return `eip155:${chainId}:${registry}`;
}

export type WellKnownResult = { matched: true; proofHash: Hex; domain: string; body: string };

/**
 * ERC-8004 endpoint-domain verification: fetch https://{domain}/.well-known/agent-registration.json
 * and require a registrations entry matching (agentId, agentRegistry) of the on-chain agent.
 */
export async function verifyWellKnownRegistration(
  fetcher: (url: string) => Promise<Response>,
  domain: string,
  input: { expectedAgentId: bigint; expectedRegistry: string },
): Promise<WellKnownResult> {
  if (typeof domain !== "string" || !DOMAIN_PATTERN.test(domain)) throw new Error("wellknown_invalid_domain");

  const url = `https://${domain}/.well-known/agent-registration.json`;
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new Error("wellknown_unreachable");
  }
  if (!response.ok) throw new Error("wellknown_unreachable");

  const body = await response.text();
  let parsed: { registrations?: Array<{ agentId?: number | string; agentRegistry?: string }> };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("wellknown_invalid_json");
  }
  if (!Array.isArray(parsed.registrations)) throw new Error("wellknown_invalid_json");

  const expectedAgentId = input.expectedAgentId.toString();
  const matched = parsed.registrations.some(
    (entry) => entry && entry.agentId !== undefined && String(entry.agentId) === expectedAgentId && entry.agentRegistry === input.expectedRegistry,
  );
  if (!matched) throw new Error("wellknown_registration_not_found");

  return { matched: true, proofHash: keccak256(toHex(body)), domain, body };
}

function concatHex(parts: readonly `0x${string}`[]): `0x${string}` {
  return ("0x" + parts.map((part) => part.slice(2)).join("")) as `0x${string}`;
}

export { padHex };
