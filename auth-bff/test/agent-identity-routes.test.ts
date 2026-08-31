import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { buildBindingDigest, type WellKnownResult } from "../src/agent-identity.js";
import { loadConfig } from "../src/config.js";
import type { AuthRepository } from "../src/db.js";
import { sha256 } from "../src/security.js";

process.env.NODE_ENV = "test";
const csrfToken = "current-csrf-token";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://example.invalid/auth",
  AUTH_ORIGIN: "http://localhost:3000",
  SIWE_DOMAIN: "localhost:3000",
  SIWE_URI: "http://localhost:3000",
  SIWE_CHAIN_ID: "31337",
  RETURN_TO_ORIGINS: "http://localhost:3000",
  COOKIE_SECURE: "false",
  COOKIE_NAME: "auth_session",
};

const baseConfig = loadConfig(baseEnv);

const registryConfig = loadConfig({
  ...baseEnv,
  AGENT_REGISTRY_ADDRESS: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  AGENT_REGISTRY_RPC_URL: "http://127.0.0.1:8545",
  IDENTITY_VERIFIER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
});

function authenticatedApp(identity?: { fetcher?: (url: string) => Promise<Response>; writer?: { attest: (agentId: bigint, level: number, proofHash: string, domain: string) => Promise<string> } }, config = baseConfig) {
  const repository = {
    ping: async () => undefined,
    findSession: async () => ({ id: "session-id", account_id: "account-id", csrf_hash: sha256(csrfToken), expires_at: new Date(Date.now() + 60_000) }),
  } as unknown as AuthRepository;
  let deps: Parameters<typeof buildApp>[2] | undefined;
  if (identity) {
    deps = { identity: {} };
    if (identity.fetcher && deps.identity) deps.identity.fetchWellKnown = identity.fetcher;
    if (identity.writer && deps.identity) deps.identity.attestWriter = identity.writer;
  }
  return buildApp(config, repository, deps);
}

function wellKnownBody(agentId: number, agentRegistry: string) {
  return JSON.stringify({ registrations: [{ agentId, agentRegistry }] });
}

describe("agent identity gateway", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  const authHeaders = { origin: baseConfig.AUTH_ORIGIN, cookie: `${baseConfig.COOKIE_NAME}=opaque-session; ${baseConfig.csrfCookieName}=${csrfToken}`, "x-csrf-token": csrfToken };

  it("issues a signed-challenge nonce and digest for the session wallet", async () => {
    const app = await authenticatedApp();
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/agent-identity/challenge", headers: authHeaders, payload: { agentId: "5" } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.nonce).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(body.digest).toBe(buildBindingDigest(5n, body.nonce));
    expect(body.agentId).toBe("5");
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("requires authentication for challenges", async () => {
    const app = await authenticatedApp();
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/agent-identity/challenge", headers: { origin: baseConfig.AUTH_ORIGIN }, payload: { agentId: "5" } });
    expect(response.statusCode).toBe(401);
  });

  it("rejects invalid agent ids", async () => {
    const app = await authenticatedApp();
    apps.push(app);
    for (const agentId of ["-1", "0xzz", "115792089237316195423570985008687907853269984665640564039457584007913129639936"]) {
      const response = await app.inject({ method: "POST", url: "/api/agent-identity/challenge", headers: authHeaders, payload: { agentId } });
      expect(response.statusCode).toBe(400);
    }
  });

  it("reports identity attestation as disabled without verifier credentials", async () => {
    const app = await authenticatedApp();
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/agent-identity/attest-domain", headers: authHeaders, payload: { agentId: "5", domain: "api.agent.example" } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "identity_attestation_disabled" });
  });

  it("attests domain control end-to-end with a well-known artifact", async () => {
    const calls: Array<[bigint, number, string, string]> = [];
    const registryId = "eip155:31337:0x5fbdb2315678afecb367f032d93f642f64180aa3";
    const app = await authenticatedApp({
      fetcher: async () => new Response(wellKnownBody(5, registryId), { status: 200 }),
      writer: { attest: async (agentId, level, proofHash, domain) => { calls.push([agentId, level, proofHash, domain]); return "0xtx" as const; } },
    }, registryConfig);
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/agent-identity/attest-domain", headers: authHeaders, payload: { agentId: "5", domain: "api.agent.example" } });
    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([[5n, 2, expect.stringMatching(/^0x[0-9a-f]{64}$/), "api.agent.example"]]);
  });

  it("surfaces well-known verification failures as 400", async () => {
    const registryId = "eip155:31337:0x5fbdb2315678afecb367f032d93f642f64180aa3";
    const app = await authenticatedApp({
      fetcher: async () => new Response(wellKnownBody(6, registryId), { status: 200 }),
      writer: { attest: async () => "0xtx" },
    });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/agent-identity/attest-domain", headers: authHeaders, payload: { agentId: "5", domain: "api.agent.example" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "wellknown_registration_not_found" });
  });

  it("surfaces attestation write failures as 502", async () => {
    const registryId = "eip155:31337:0x5fbdb2315678afecb367f032d93f642f64180aa3";
    const app = await authenticatedApp({
      fetcher: async () => new Response(wellKnownBody(5, registryId), { status: 200 }),
      writer: { attest: async () => { throw new Error("rpc_down"); } },
    }, registryConfig);
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/agent-identity/attest-domain", headers: authHeaders, payload: { agentId: "5", domain: "api.agent.example" } });
    expect(response.statusCode).toBe(502);
  });

  it("exposes agent identity capabilities", async () => {
    const app = await authenticatedApp();
    apps.push(app);
    const disabled = await app.inject({ method: "GET", url: "/api/auth/capabilities" });
    expect(disabled.json().agentIdentity).toEqual({ challenge: true, domainAttestation: false, chainId: 31337 });

    const enabledApp = await authenticatedApp({ fetcher: async () => new Response("", { status: 404 }), writer: { attest: async () => "0xtx" } });
    apps.push(enabledApp);
    const enabled = await enabledApp.inject({ method: "GET", url: "/api/auth/capabilities" });
    expect(enabled.json().agentIdentity).toEqual({ challenge: true, domainAttestation: true, chainId: 31337 });
  });

  it("keeps well-known results typed", () => {
    const sample: WellKnownResult = { matched: true, proofHash: `0x${"ab".repeat(32)}`, domain: "api.agent.example", body: "{}" };
    expect(sample.matched).toBe(true);
  });
});
