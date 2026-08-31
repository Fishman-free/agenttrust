import { keccak256, numberToHex, padHex, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  BINDING_PREFIX,
  buildAgentRegistryId,
  buildBindingDigest,
  randomBindingNonce,
  verifyBindingSignature,
  verifyKeyControl,
  verifyWellKnownRegistration,
} from "../src/agent-identity.js";

const controlAccount = privateKeyToAccount("0x00000000000000000000000000000000000000000000000000000000000a11ce");
const nonce42 = padHex(numberToHex(42n), { size: 32 });

describe("agent identity binding challenges", () => {
  it("builds the same digest as the AgentRegistry proveKeyControl circuit", () => {
    expect(buildBindingDigest(0n, nonce42)).toBe("0xd21fb7fb6bb217e20579e55ab3e9dddf3be105fe8db378eb4dc366ab3dcc6eb6");
    expect(BINDING_PREFIX).toBe("AgentTrust external-agent binding: ");
  });

  it("packs agent ids as 32-byte big-endian and keeps bytes32 nonces raw", () => {
    const digest = buildBindingDigest(5n, nonce42);
    const manual = keccak256(concatHex([toHex(BINDING_PREFIX), numberToHex(5n, { size: 32 }), nonce42]));
    expect(digest).toBe(manual);
  });

  it("recovers the control key that signed the EIP-191 wrapped digest", async () => {
    const digest = buildBindingDigest(7n, nonce42);
    const signature = await controlAccount.signMessage({ message: { raw: digest } });
    await expect(verifyKeyControl(7n, nonce42, signature)).resolves.toBe(controlAccount.address);
  });

  it("does not attribute a signature to a different agent id or nonce", async () => {
    const digest = buildBindingDigest(7n, nonce42);
    const signature = await controlAccount.signMessage({ message: { raw: digest } });
    await expect(verifyBindingSignature(7n, nonce42, signature, controlAccount.address)).resolves.toBe(true);
    await expect(verifyBindingSignature(8n, nonce42, signature, controlAccount.address)).resolves.toBe(false);
    const otherNonce = padHex(numberToHex(43n), { size: 32 });
    await expect(verifyBindingSignature(7n, otherNonce, signature, controlAccount.address)).resolves.toBe(false);
  });

  it("issues 32-byte hex nonces", () => {
    const nonce = randomBindingNonce();
    expect(nonce).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});

describe("ERC-8004 registry ids", () => {
  it("builds eip155:{chainId}:{registry} identifiers", () => {
    expect(buildAgentRegistryId(31337n, "0x5fbdb2315678afecb367f032d93f642f64180aa3")).toBe(
      "eip155:31337:0x5fbdb2315678afecb367f032d93f642f64180aa3",
    );
  });
});

describe("well-known domain verification", () => {
  const registry = buildAgentRegistryId(31337n, "0x5fbdb2315678afecb367f032d93f642f64180aa3");

  function wellKnownBody(agentId: number, agentRegistry: string) {
    return JSON.stringify({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "example-agent",
      registrations: [{ agentId, agentRegistry }],
    });
  }

  it("accepts a reachable file with a matching registrations entry", async () => {
    const body = wellKnownBody(5, registry);
    const fetcher = async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    const result = await verifyWellKnownRegistration(fetcher, "api.agent.example", { expectedAgentId: 5n, expectedRegistry: registry });
    expect(result.matched).toBe(true);
    expect(result.proofHash).toBe(keccak256(toHex(body)));
    expect(result.domain).toBe("api.agent.example");
  });

  it("rejects non-matching agent ids", async () => {
    const body = wellKnownBody(6, registry);
    const fetcher = async () => new Response(body, { status: 200 });
    await expect(verifyWellKnownRegistration(fetcher, "api.agent.example", { expectedAgentId: 5n, expectedRegistry: registry })).rejects.toThrow("wellknown_registration_not_found");
  });

  it("rejects a different registry namespace", async () => {
    const body = wellKnownBody(5, buildAgentRegistryId(1n, "0x5fbdb2315678afecb367f032d93f642f64180aa3"));
    const fetcher = async () => new Response(body, { status: 200 });
    await expect(verifyWellKnownRegistration(fetcher, "api.agent.example", { expectedAgentId: 5n, expectedRegistry: registry })).rejects.toThrow("wellknown_registration_not_found");
  });

  it("rejects non-200 responses and malformed JSON", async () => {
    const down = async () => new Response("nope", { status: 503 });
    await expect(verifyWellKnownRegistration(down, "api.agent.example", { expectedAgentId: 5n, expectedRegistry: registry })).rejects.toThrow("wellknown_unreachable");
    const broken = async () => new Response("<html>not json</html>", { status: 200 });
    await expect(verifyWellKnownRegistration(broken, "api.agent.example", { expectedAgentId: 5n, expectedRegistry: registry })).rejects.toThrow("wellknown_invalid_json");
  });

  it("rejects suspicious domains before fetching", async () => {
    const fetcher = async () => {
      throw new Error("must not fetch");
    };
    await expect(verifyWellKnownRegistration(fetcher, "api.agent.example/../../etc", { expectedAgentId: 5n, expectedRegistry: registry })).rejects.toThrow("wellknown_invalid_domain");
    await expect(verifyWellKnownRegistration(fetcher, "https://api.agent.example", { expectedAgentId: 5n, expectedRegistry: registry })).rejects.toThrow("wellknown_invalid_domain");
  });
});

function concatHex(parts: readonly `0x${string}`[]): `0x${string}` {
  return ("0x" + parts.map((part) => part.slice(2)).join("")) as `0x${string}`;
}
