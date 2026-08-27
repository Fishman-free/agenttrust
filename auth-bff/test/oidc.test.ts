import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oidcMocks = vi.hoisted(() => ({
  discovery: vi.fn(async () => ({ discovered: true })),
  randomPKCECodeVerifier: vi.fn(() => "pkce-verifier"),
  calculatePKCECodeChallenge: vi.fn(async () => "pkce-challenge"),
  buildAuthorizationUrl: vi.fn((_configuration: unknown, parameters: Record<string, string>) => {
    const url = new URL("https://issuer.example/authorize");
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url;
  }),
  authorizationCodeGrant: vi.fn(async () => ({ claims: () => ({ iss: "https://issuer.example", sub: "subject-1", email: "person@example.com" }) })),
}));

vi.mock("openid-client", () => oidcMocks);

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AuthRepository, OidcFlow, Queryable } from "../src/db.js";

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://example.invalid/auth",
  AUTH_ORIGIN: "http://localhost:3000",
  SIWE_DOMAIN: "localhost:3000",
  SIWE_URI: "http://localhost:3000",
  SIWE_CHAIN_ID: "31337",
  RETURN_TO_ORIGINS: "http://localhost:3000",
  COOKIE_SECURE: "false",
  COOKIE_NAME: "auth_session",
  GOOGLE_OIDC_ISSUER: "https://issuer.example",
  GOOGLE_OIDC_CLIENT_ID: "client-id",
  GOOGLE_OIDC_CLIENT_SECRET: "client-secret",
  GOOGLE_OIDC_REDIRECT_URI: "http://localhost:8323/api/auth/oidc/google/callback",
});

describe("OIDC nonce and issuer binding", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("persists a generated nonce and sends the same nonce to authorization", async () => {
    let persisted: { nonce: string; stateHash: Buffer } | undefined;
    const repository = {
      createOidcFlow: async (input: { nonce: string; stateHash: Buffer }) => { persisted = input; },
    } as unknown as AuthRepository;
    const app = await buildApp(config, repository);
    apps.push(app);
    const response = await app.inject({
      method: "POST", url: "/api/auth/oidc/google/start",
      headers: { origin: config.authOrigin }, payload: { returnTo: "/agents" },
    });
    expect(response.statusCode).toBe(200);
    const authorizationUrl = new URL(response.json().authorizationUrl);
    expect(persisted?.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(authorizationUrl.searchParams.get("nonce")).toBe(persisted?.nonce);
    expect(authorizationUrl.searchParams.get("state")).not.toBe(persisted?.nonce);
    expect(persisted?.stateHash).toBeInstanceOf(Buffer);
  });

  it("passes persisted expectedNonce and keys identity by validated issuer plus subject", async () => {
    const flow: OidcFlow = {
      id: "flow-id", provider: "google", nonce: "persisted-oidc-nonce", code_verifier: "pkce-verifier",
      return_to: "http://localhost:3000/agents", expires_at: new Date(Date.now() + 60_000),
    };
    let identity: { issuer: string; subject: string; provider: string } | undefined;
    const repository = {
      transaction: async <T>(fn: (db: Queryable) => Promise<T>) => fn({} as Queryable),
      consumeOidcFlow: async () => flow,
      accountForOidc: async (_db: Queryable, input: { issuer: string; subject: string; provider: string }) => { identity = input; return "account-id"; },
      createSession: async () => undefined,
    } as unknown as AuthRepository;
    const app = await buildApp(config, repository);
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/oidc/google/callback?code=authorization-code&state=abcdefghijklmnop",
    });
    expect(response.statusCode).toBe(303);
    expect(oidcMocks.authorizationCodeGrant).toHaveBeenCalledWith(
      expect.anything(), expect.any(URL),
      expect.objectContaining({ expectedState: "abcdefghijklmnop", expectedNonce: flow.nonce, pkceCodeVerifier: flow.code_verifier }),
    );
    expect(identity).toMatchObject({ provider: "google", issuer: "https://issuer.example", subject: "subject-1" });
  });
});
