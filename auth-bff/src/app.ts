import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { DatabaseError } from "pg";
import { getAddress } from "viem";
import { ZodError, z } from "zod";
import { PROVIDERS, type Config, type Purpose } from "./config.js";
import { AuthRepository, type Session } from "./db.js";
import { registerOidcRoutes } from "./oidc.js";
import { enforceBrowserRequest, randomToken, safeEqual, setNoStore, sha256 } from "./security.js";
import { addressSchema, buildSiweMessage, nonceSchema, signatureSchema, verifyExactSiwe } from "./siwe.js";

const challengeSchema = z.object({ address: addressSchema }).strict();
const verifySchema = z.object({ nonce: nonceSchema, message: z.string().min(1).max(4096), signature: signatureSchema }).strict();

type Authenticated = { session: Session; tokenHash: Buffer };

export async function buildApp(config: Config, repository: AuthRepository) {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : {
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-csrf-token", "req.body.signature", "req.body.message", "res.headers.set-cookie", "*.token", "*.clientSecret"],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 32 * 1024,
    trustProxy: config.trustProxy,
    requestTimeout: 15_000,
  });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false, hsts: false });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute", hook: "onRequest", keyGenerator: (request) => request.ip });

  app.addHook("onRequest", async (request) => enforceBrowserRequest(request, config));
  app.addHook("onSend", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff").header("referrer-policy", "no-referrer");
  });

  const cookieOptions = { path: "/", httpOnly: true, secure: config.cookieSecure, sameSite: "lax" as const };
  const csrfCookieOptions = { ...cookieOptions, httpOnly: false };

  const authenticate = async (request: FastifyRequest): Promise<Authenticated | null> => {
    const token = request.cookies[config.COOKIE_NAME];
    if (!token || token.length > 512) return null;
    const tokenHash = sha256(token);
    const session = await repository.findSession(tokenHash);
    return session ? { session, tokenHash } : null;
  };

  const requireAuth = async (request: FastifyRequest) => {
    const auth = await authenticate(request);
    if (!auth) throw Object.assign(new Error("authentication_required"), { statusCode: 401 });
    return auth;
  };

  const requireCsrf = (request: FastifyRequest, auth: Authenticated) => {
    const header = request.headers["x-csrf-token"];
    const cookieValue = request.cookies[config.csrfCookieName];
    if (typeof header !== "string" || !cookieValue || header !== cookieValue || !safeEqual(sha256(header), auth.session.csrf_hash)) {
      throw Object.assign(new Error("csrf_validation_failed"), { statusCode: 403 });
    }
  };

  const issueSession = async (accountId: string, reply: FastifyReply) => {
    const token = randomToken(32);
    const csrf = randomToken(32);
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_SECONDS * 1000);
    await repository.transaction((db) => repository.createSession(db, {
      accountId, tokenHash: sha256(token), csrfHash: sha256(csrf), expiresAt,
    }));
    reply.setCookie(config.COOKIE_NAME, token, { ...cookieOptions, expires: expiresAt });
    reply.setCookie(config.csrfCookieName, csrf, { ...csrfCookieOptions, expires: expiresAt });
    setNoStore(reply);
  };

  const clearCookies = (reply: FastifyReply) => {
    reply.clearCookie(config.COOKIE_NAME, cookieOptions);
    reply.clearCookie(config.csrfCookieName, csrfCookieOptions);
    setNoStore(reply);
  };

  const currentCsrfToken = async (request: FastifyRequest, reply: FastifyReply, auth: Authenticated) => {
    const existing = request.cookies[config.csrfCookieName];
    if (existing && safeEqual(sha256(existing), auth.session.csrf_hash)) return existing;
    const csrf = randomToken(32);
    await repository.updateSessionCsrf(auth.session.id, sha256(csrf));
    reply.setCookie(config.csrfCookieName, csrf, { ...csrfCookieOptions, expires: auth.session.expires_at });
    return csrf;
  };

  const issueChallenge = async (request: FastifyRequest, purpose: Purpose, accountId: string | null) => {
    const { address } = challengeSchema.parse(request.body);
    const nonce = randomToken(18);
    const issuedAt = new Date();
    const expirationTime = new Date(issuedAt.getTime() + config.CHALLENGE_TTL_SECONDS * 1000);
    const message = buildSiweMessage(config, address, purpose, nonce, issuedAt, expirationTime);
    await repository.createChallenge({ nonce, purpose, address, accountId, message, expiresAt: expirationTime });
    return { message, nonce, expiresAt: expirationTime.toISOString(), chainId: config.SIWE_CHAIN_ID, purpose };
  };

  const verifyChallenge = async (request: FastifyRequest, purpose: Purpose, accountId: string | null) => {
    const body = verifySchema.parse(request.body);
    const challenge = await repository.findChallenge(body.nonce);
    if (!challenge || challenge.consumed_at || challenge.expires_at.getTime() <= Date.now() || challenge.purpose !== purpose || challenge.account_id !== accountId) {
      throw Object.assign(new Error("invalid_or_consumed_challenge"), { statusCode: 400 });
    }
    const address = getAddress(challenge.address);
    await verifyExactSiwe({
      config, message: body.message, storedMessage: challenge.message, expectedAddress: address,
      expectedNonce: challenge.nonce, expectedPurpose: purpose, signature: body.signature,
    });
    return { challenge, address };
  };

  app.get("/api/auth/health", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async () => {
    await repository.ping();
    return { ok: true, service: "auth-bff", database: "ok" };
  });

  app.get("/api/auth/capabilities", async (_request, reply) => {
    setNoStore(reply);
    return {
      wallet: { enabled: true, chainId: config.SIWE_CHAIN_ID, siwe: true },
      oidc: Object.fromEntries(PROVIDERS.map((provider) => [provider, { configured: config.oidc[provider].configured }])),
    };
  });

  app.get("/api/auth/session", async (request, reply) => {
    setNoStore(reply);
    const auth = await authenticate(request);
    if (!auth) {
      clearCookies(reply);
      return { authenticated: false };
    }
    const account = await repository.accountView(auth.session.account_id);
    if (!account) throw new Error("session_account_missing");
    const csrfToken = await currentCsrfToken(request, reply, auth);
    return { authenticated: true, csrfToken, account };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const auth = await requireAuth(request);
    requireCsrf(request, auth);
    await repository.revokeSession(auth.tokenHash);
    clearCookies(reply);
    return reply.code(204).send();
  });

  app.post("/api/auth/wallet/challenge", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    setNoStore(reply);
    return issueChallenge(request, "wallet_login", null);
  });

  app.post("/api/auth/wallet/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { challenge, address } = await verifyChallenge(request, "wallet_login", null);
    const accountId = await repository.transaction(async (db) => {
      if (!await repository.consumeChallenge(db, challenge.id)) throw Object.assign(new Error("invalid_or_consumed_challenge"), { statusCode: 400 });
      return repository.accountForWallet(db, address);
    });
    await issueSession(accountId, reply);
    return { authenticated: true, account: await repository.accountView(accountId) };
  });

  app.post("/api/auth/wallet/link/challenge", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = await requireAuth(request);
    requireCsrf(request, auth);
    const account = await repository.accountView(auth.session.account_id);
    if (account?.wallet) throw Object.assign(new Error("wallet_already_bound"), { statusCode: 409 });
    setNoStore(reply);
    return issueChallenge(request, "wallet_link", auth.session.account_id);
  });

  app.post("/api/auth/wallet/link/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = await requireAuth(request);
    requireCsrf(request, auth);
    const { challenge, address } = await verifyChallenge(request, "wallet_link", auth.session.account_id);
    await repository.transaction(async (db) => {
      if (!await repository.consumeChallenge(db, challenge.id)) throw Object.assign(new Error("invalid_or_consumed_challenge"), { statusCode: 400 });
      await repository.linkWallet(db, auth.session.account_id, address);
    });
    setNoStore(reply);
    return { linked: true, account: await repository.accountView(auth.session.account_id) };
  });

  registerOidcRoutes(app, config, repository, issueSession);

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: "not_found" }));
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "invalid_request", issues: error.issues.map(({ path, code }) => ({ path, code })) });
    const dbError = error as DatabaseError;
    if (dbError.code === "23505") return reply.code(409).send({ error: dbError.constraint === "wallets_address_key" ? "wallet_already_linked" : "conflict" });
    const normalized = error instanceof Error ? error : new Error("unknown_error");
    const candidate = normalized as Error & { statusCode?: number };
    const safeErrors = new Set(["invalid_origin", "cross_site_request_blocked", "authentication_required", "csrf_validation_failed", "invalid_or_consumed_challenge", "wallet_already_bound", "provider_not_configured", "invalid_or_consumed_oidc_state", "oidc_subject_missing", "oidc_issuer_missing", "siwe_message_mismatch", "siwe_message_invalid", "siwe_domain_mismatch", "siwe_uri_mismatch", "siwe_chain_mismatch", "siwe_nonce_mismatch", "siwe_purpose_mismatch", "siwe_expired", "siwe_issued_at_invalid", "siwe_address_mismatch", "siwe_signature_invalid"]);
    const statusCode = candidate.statusCode && candidate.statusCode >= 400 && candidate.statusCode < 600
      ? candidate.statusCode : candidate.message.startsWith("siwe_") ? 400 : 500;
    if (safeErrors.has(candidate.message)) return reply.code(statusCode).send({ error: candidate.message });
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ error: "internal_error" });
  });
  return app;
}
