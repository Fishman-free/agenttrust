import { parseSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { buildSiweMessage, verifyExactSiwe } from "../src/siwe.js";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const config = { SIWE_DOMAIN: "agenttrust.site", SIWE_URI: "https://agenttrust.site", SIWE_CHAIN_ID: 84532 };
const nonce = "abcdefghijklmnop";
const now = new Date("2026-08-28T00:00:00.000Z");

async function signedMessage(purpose: "wallet_login" | "wallet_link" = "wallet_login") {
  const message = buildSiweMessage(config, account.address, purpose, nonce, now, new Date(now.getTime() + 300_000));
  return { message, signature: await account.signMessage({ message }) };
}

describe("SIWE validation", () => {
  it("creates and verifies an exact Base Sepolia purpose-bound message", async () => {
    const { message, signature } = await signedMessage();
    const parsed = await verifyExactSiwe({
      config, message, storedMessage: message, expectedAddress: account.address,
      expectedNonce: nonce, expectedPurpose: "wallet_login", signature, now,
    });
    expect(parsed).toMatchObject({ domain: config.SIWE_DOMAIN, uri: config.SIWE_URI, chainId: 84532, nonce });
  });

  it.each([
    ["domain", (value: string) => value.replace("agenttrust.site wants", "evil.example wants"), "siwe_domain_mismatch"],
    ["URI", (value: string) => value.replace("URI: https://agenttrust.site", "URI: https://evil.example"), "siwe_uri_mismatch"],
    ["chain", (value: string) => value.replace("Chain ID: 84532", "Chain ID: 1"), "siwe_chain_mismatch"],
    ["purpose", (value: string) => value.replace("purpose: wallet_login", "purpose: wallet_link"), "siwe_purpose_mismatch"],
  ])("rejects a wrong %s even with a valid signature", async (_name, mutate, expected) => {
    const { message } = await signedMessage();
    const changed = mutate(message);
    const signature = await account.signMessage({ message: changed });
    await expect(verifyExactSiwe({
      config, message: changed, storedMessage: changed, expectedAddress: account.address,
      expectedNonce: nonce, expectedPurpose: "wallet_login", signature, now,
    })).rejects.toThrow(expected);
  });

  it("encodes expiry and issued-at in the signed message", async () => {
    const { message } = await signedMessage("wallet_link");
    const parsed = parseSiweMessage(message);
    expect(parsed.expirationTime?.toISOString()).toBe("2026-08-28T00:05:00.000Z");
    expect(parsed.issuedAt?.toISOString()).toBe(now.toISOString());
  });
});
