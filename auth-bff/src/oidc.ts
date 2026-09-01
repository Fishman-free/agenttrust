import * as oidc from "openid-client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { PROVIDERS, type Config, type Provider } from "./config.js";
import type { AuthRepository } from "./db.js";
import { randomToken, sanitizeReturnTo, sha256 } from "./security.js";

const providerSchema = z.enum(PROVIDERS);
const startSchema = z.object({ returnTo: z.string().max(2048).optional() }).strict();
const callbackSchema = z.object({ code: z.string().min(1), state: z.string().min(16), iss: z.string().optional() }).passthrough();

type IssueSession = (accountId: string, reply: FastifyReply) => Promise<void>;
type ProviderSettings = Config["oidc"][Provider];

// ---------------------------------------------------------------------------
// GitHub：纯 OAuth 2.0（授权码 + PKCE）。GitHub 既没有 OIDC discovery 端点，
// 也不签发 id_token，因此走不通 openid-client 的 discovery / claims() 路径。
// 这里单独实现三段：构造授权 URL、换 access token、用 API 读取身份。
// ---------------------------------------------------------------------------
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_URL = "https://api.github.com";
/** GitHub 没有 issuer 概念，用一个稳定的人造值填 oidc_identities.issuer。 */
const GITHUB_SYNTHETIC_ISSUER = "https://github.com";
const GITHUB_USER_AGENT = "agenttrust-auth-bff";

function githubAuthorizationUrl(settings: ProviderSettings, state: string, codeChallenge: string) {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", settings.clientId);
  url.searchParams.set("redirect_uri", settings.redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

async function githubExchange(settings: ProviderSettings, code: string, codeVerifier: string) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": GITHUB_USER_AGENT },
    body: JSON.stringify({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code,
      redirect_uri: settings.redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) throw Object.assign(new Error("oidc_token_exchange_failed"), { statusCode: 400 });
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw Object.assign(new Error("oidc_token_exchange_failed"), { statusCode: 400 });
  return payload.access_token;
}

async function githubIdentity(accessToken: string) {
  const headers = { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": GITHUB_USER_AGENT };
  const profileResponse = await fetch(`${GITHUB_API_URL}/user`, { headers });
  if (!profileResponse.ok) throw Object.assign(new Error("oidc_subject_missing"), { statusCode: 400 });
  const profile = await profileResponse.json() as { id?: number; email?: string | null };
  if (typeof profile.id !== "number") throw Object.assign(new Error("oidc_subject_missing"), { statusCode: 400 });
  let email = typeof profile.email === "string" && profile.email ? profile.email : null;
  // /user 的 email 在用户未公开邮箱时为 null，此时退到 /user/emails 取已验证的主邮箱。
  if (!email) {
    const emailsResponse = await fetch(`${GITHUB_API_URL}/user/emails`, { headers });
    if (emailsResponse.ok) {
      const emails = await emailsResponse.json() as { email?: string; primary?: boolean; verified?: boolean }[];
      email = emails.find((entry) => entry.primary && entry.verified)?.email
        ?? emails.find((entry) => entry.verified)?.email
        ?? null;
    }
  }
  // 用数字 ID 而非登录名做 subject：登录名可改，改了会把同一个人识别成两个账号。
  return { subject: String(profile.id), email, issuer: GITHUB_SYNTHETIC_ISSUER };
}

export function registerOidcRoutes(app: FastifyInstance, config: Config, repository: AuthRepository, issueSession: IssueSession) {
  const discovered = new Map<Provider, Promise<oidc.Configuration>>();
  const settingsFor = (provider: Provider) => {
    const settings = config.oidc[provider];
    if (!settings.configured) throw Object.assign(new Error("provider_not_configured"), { statusCode: 503 });
    return settings;
  };
  const clientFor = (provider: Provider) => {
    const settings = settingsFor(provider);
    let client = discovered.get(provider);
    if (!client) {
      client = oidc.discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret);
      discovered.set(provider, client);
    }
    return { settings, client };
  };

  app.post("/api/auth/oidc/:provider/start", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const provider = providerSchema.parse((request.params as { provider?: unknown }).provider);
    // 先校验提供方是否已配置：未配置就不该往库里写 flow 行。
    settingsFor(provider);
    const body = startSchema.parse(request.body ?? {});
    const state = randomToken(24);
    const nonce = randomToken(24);
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const returnTo = sanitizeReturnTo(body.returnTo, config);
    await repository.createOidcFlow({
      provider, stateHash: sha256(state), nonce, codeVerifier, returnTo,
      expiresAt: new Date(Date.now() + config.OIDC_FLOW_TTL_SECONDS * 1000),
    });
    if (provider === "github") {
      return { authorizationUrl: githubAuthorizationUrl(config.oidc[provider], state, codeChallenge).toString() };
    }
    const { settings, client } = clientFor(provider);
    const authorizationUrl = oidc.buildAuthorizationUrl(await client, {
      redirect_uri: settings.redirectUri,
      scope: "openid email profile",
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });
    return { authorizationUrl: authorizationUrl.toString() };
  });

  app.get("/api/auth/oidc/:provider/callback", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request: FastifyRequest, reply) => {
    const provider = providerSchema.parse((request.params as { provider?: unknown }).provider);
    const query = callbackSchema.parse(request.query);
    const settings = settingsFor(provider);
    const flow = await repository.transaction((db) => repository.consumeOidcFlow(db, sha256(query.state), provider));
    if (!flow) throw Object.assign(new Error("invalid_or_consumed_oidc_state"), { statusCode: 400 });

    let subject: string;
    let email: string | null;
    let issuer: string;

    if (provider === "github") {
      const accessToken = await githubExchange(settings, query.code, flow.code_verifier);
      const identity = await githubIdentity(accessToken);
      subject = identity.subject;
      email = identity.email;
      issuer = identity.issuer;
    } else {
      const { client } = clientFor(provider);
      const callbackUrl = new URL(request.url, new URL(settings.redirectUri).origin);
      const tokens = await oidc.authorizationCodeGrant(await client, callbackUrl, {
        pkceCodeVerifier: flow.code_verifier,
        expectedState: query.state,
        expectedNonce: flow.nonce,
      });
      const claims = tokens.claims();
      if (!claims?.sub) throw Object.assign(new Error("oidc_subject_missing"), { statusCode: 400 });
      if (typeof claims.iss !== "string" || !claims.iss) throw Object.assign(new Error("oidc_issuer_missing"), { statusCode: 400 });
      subject = claims.sub;
      email = typeof claims.email === "string" ? claims.email : null;
      issuer = claims.iss;
    }

    const accountId = await repository.transaction((db) => repository.accountForOidc(db, {
      provider, issuer, subject, email,
    }));
    await issueSession(accountId, reply);
    return reply.redirect(flow.return_to, 303);
  });
}
