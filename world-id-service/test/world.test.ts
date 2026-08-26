import { hashSignal } from "@worldcoin/idkit/hashing";
import { decodeAbiParameters, keccak256, stringToBytes, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ACTION, loadConfig } from "../src/config.js";
import { ATTESTATION_TYPES, issueAttestation, validateResult } from "../src/world.js";

const signerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const attesterKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const adapter = "0x1325C3eD12d535Bc33A56305466159d370BDf6cE";
const subject = "0x1fB11c41b42615590467029CB3cE2949b3F4eE53";
const nullifier = `0x${"11".repeat(32)}` as const;

function config() {
  return loadConfig({
    WORLD_ID_SIGNER_PRIVATE_KEY: signerKey,
    WORLD_ID_ATTESTER_PRIVATE_KEY: attesterKey,
    WORLD_ID_ADAPTER_ADDRESS: adapter,
  });
}

function result(nonce: string, now: number) {
  return {
    protocol_version: "4.0" as const,
    nonce,
    action: ACTION,
    environment: "production" as const,
    user_presence_completed: true,
    responses: [{
      identifier: "proof_of_human" as const,
      signal_hash: hashSignal(subject),
      issuer_schema_id: 1 as const,
      nullifier,
      expires_at_min: now + 3600,
      proof: Array.from({ length: 5 }, (_, index) => `0x${(index + 1).toString(16)}`),
    }],
  };
}

describe("World ID result validation", () => {
  it("accepts a subject-bound v4 Proof of Human result", () => {
    const now = 1_800_000_000;
    expect(validateResult(subject, result(`0x${"22".repeat(32)}`, now), now).subject).toBe(subject);
  });

  it("rejects a proof bound to another wallet", () => {
    const now = 1_800_000_000;
    const value = result(`0x${"22".repeat(32)}`, now);
    value.responses[0]!.signal_hash = hashSignal("0x0000000000000000000000000000000000000001");
    expect(() => validateResult(subject, value, now)).toThrow("signal_mismatch");
  });
});

describe("Base Sepolia enrollment attestation", () => {
  it("matches the deployed adapter EIP-712 type and flat proof ABI", async () => {
    const now = 1_800_000_000;
    const issued = await issueAttestation(config(), subject, nullifier, now);
    const [actionHash, expiry, nonce, signature] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes" }],
      issued.proof,
    );
    expect(actionHash).toBe(keccak256(stringToBytes(ACTION)));
    expect(expiry).toBe(BigInt(now + 300));
    expect(await verifyTypedData({
      address: privateKeyToAccount(attesterKey).address,
      domain: { name: "AgentTrust WorldID v4", version: "1", chainId: 84532, verifyingContract: adapter },
      types: ATTESTATION_TYPES,
      primaryType: "EnrollmentAttestation",
      message: { subject, nullifier, actionHash, expiry, nonce },
      signature,
    })).toBe(true);
  });
});

describe("World ID HTTP service", () => {
  it("issues one-time contexts and attestations without exposing keys", async () => {
    const upstream = async () => new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const app = await buildApp(config(), upstream as typeof fetch);
    const context = await app.inject({ method: "GET", url: "/api/world-id/context", headers: { origin: "https://agenttrust.site" } });
    expect(context.statusCode).toBe(200);
    const body = context.json();
    expect(JSON.stringify(body)).not.toContain(signerKey.slice(2));

    const verification = await app.inject({
      method: "POST",
      url: "/api/world-id/verify",
      headers: { origin: "https://agenttrust.site", "content-type": "application/json" },
      payload: { subject, result: result(body.rp_context.nonce, Math.floor(Date.now() / 1000)) },
    });
    expect(verification.statusCode).toBe(200);
    expect(verification.json()).toMatchObject({ nullifier });

    const replay = await app.inject({
      method: "POST",
      url: "/api/world-id/verify",
      headers: { origin: "https://agenttrust.site", "content-type": "application/json" },
      payload: { subject, result: result(body.rp_context.nonce, Math.floor(Date.now() / 1000)) },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toEqual({ error: "invalid_or_consumed_nonce" });
    await app.close();
  });
});
