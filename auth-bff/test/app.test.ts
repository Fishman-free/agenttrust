import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AuthRepository } from "../src/db.js";
import { sha256 } from "../src/security.js";

process.env.NODE_ENV = "test";
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
});

function repositoryStub() {
  return {
    ping: async () => undefined,
    createChallenge: async () => undefined,
    findSession: async () => null,
    accountView: async () => null,
  } as unknown as AuthRepository;
}

describe("Auth BFF HTTP boundary", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("reports capabilities without claiming unconfigured OIDC providers", async () => {
    const app = await buildApp(config, repositoryStub());
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/auth/capabilities" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      wallet: { enabled: true, chainId: 31337, siwe: true },
      oidc: { google: { configured: false }, github: { configured: false }, apple: { configured: false }, casdoor: { configured: false } },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects unsafe requests without the exact configured Origin", async () => {
    const app = await buildApp(config, repositoryStub());
    apps.push(app);
    const missing = await app.inject({ method: "POST", url: "/api/auth/wallet/challenge", payload: { address: "0x0000000000000000000000000000000000000001" } });
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toEqual({ error: "invalid_origin" });
    const crossSite = await app.inject({
      method: "POST", url: "/api/auth/wallet/challenge",
      headers: { origin: config.authOrigin, "sec-fetch-site": "cross-site" },
      payload: { address: "0x0000000000000000000000000000000000000001" },
    });
    expect(crossSite.statusCode).toBe(403);
    expect(crossSite.json()).toEqual({ error: "cross_site_request_blocked" });
  });

  it("fails closed for an unconfigured OIDC provider", async () => {
    const app = await buildApp(config, repositoryStub());
    apps.push(app);
    const response = await app.inject({
      method: "POST", url: "/api/auth/oidc/google/start",
      headers: { origin: config.authOrigin }, payload: { returnTo: "/agents" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "provider_not_configured" });
  });

  it("returns the current CSRF token for an authenticated static frontend", async () => {
    const csrfToken = "current-csrf-token";
    const repository = {
      findSession: async () => ({ id: "session-id", account_id: "account-id", csrf_hash: sha256(csrfToken), expires_at: new Date(Date.now() + 60_000) }),
      accountView: async () => ({ id: "account-id", created_at: new Date(), wallets: [], identities: [] }),
    } as unknown as AuthRepository;
    const app = await buildApp(config, repository);
    apps.push(app);
    const response = await app.inject({
      method: "GET", url: "/api/auth/session",
      headers: { cookie: `${config.COOKIE_NAME}=opaque-session; ${config.csrfCookieName}=${csrfToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ authenticated: true, csrfToken, account: { id: "account-id" } });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rotates and returns CSRF when an authenticated session lacks a valid CSRF cookie", async () => {
    let updatedHash: Buffer | undefined;
    const repository = {
      findSession: async () => ({ id: "session-id", account_id: "account-id", csrf_hash: sha256("old-token"), expires_at: new Date(Date.now() + 60_000) }),
      accountView: async () => ({ id: "account-id", created_at: new Date(), wallets: [], identities: [] }),
      updateSessionCsrf: async (_sessionId: string, csrfHash: Buffer) => { updatedHash = csrfHash; },
    } as unknown as AuthRepository;
    const app = await buildApp(config, repository);
    apps.push(app);
    const response = await app.inject({
      method: "GET", url: "/api/auth/session",
      headers: { cookie: `${config.COOKIE_NAME}=opaque-session` },
    });
    const body = response.json();
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(updatedHash).toEqual(sha256(body.csrfToken));
    expect(response.headers["set-cookie"]).toContain(config.csrfCookieName);
  });

  const linkChallengeHeaders = (csrfToken: string) => ({
    origin: config.authOrigin,
    cookie: `${config.COOKIE_NAME}=opaque-session; ${config.csrfCookieName}=${csrfToken}`,
    "x-csrf-token": csrfToken,
  });
  const session = (csrfToken: string) => ({
    findSession: async () => ({ id: "session-id", account_id: "account-id", csrf_hash: sha256(csrfToken), expires_at: new Date(Date.now() + 60_000) }),
  });

  it("issues an additional-wallet link challenge for an account that already has wallets", async () => {
    const csrfToken = "current-csrf-token";
    const repository = {
      ...session(csrfToken),
      findWalletOwner: async () => null,
      createChallenge: async () => undefined,
    } as unknown as AuthRepository;
    const app = await buildApp(config, repository);
    apps.push(app);
    const response = await app.inject({
      method: "POST", url: "/api/auth/wallet/link/challenge",
      headers: linkChallengeHeaders(csrfToken),
      payload: { address: "0x0000000000000000000000000000000000000002" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ purpose: "wallet_link" });
  });

  it("rejects a link challenge when the address is already on the same account", async () => {
    const csrfToken = "current-csrf-token";
    const repository = {
      ...session(csrfToken),
      findWalletOwner: async () => "account-id",
    } as unknown as AuthRepository;
    const app = await buildApp(config, repository);
    apps.push(app);
    const response = await app.inject({
      method: "POST", url: "/api/auth/wallet/link/challenge",
      headers: linkChallengeHeaders(csrfToken),
      payload: { address: "0x0000000000000000000000000000000000000001" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "wallet_already_bound" });
  });

  it("rejects a link challenge when the address already belongs to another account", async () => {
    const csrfToken = "current-csrf-token";
    const repository = {
      ...session(csrfToken),
      findWalletOwner: async () => "another-account",
    } as unknown as AuthRepository;
    const app = await buildApp(config, repository);
    apps.push(app);
    const response = await app.inject({
      method: "POST", url: "/api/auth/wallet/link/challenge",
      headers: linkChallengeHeaders(csrfToken),
      payload: { address: "0x0000000000000000000000000000000000000002" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "wallet_already_linked" });
  });

  it("returns a generic unauthenticated session and expires both cookies", async () => {
    const app = await buildApp(config, repositoryStub());
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
    expect(response.headers["set-cookie"]).toHaveLength(2);
  });
});
