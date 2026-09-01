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

    const accountId = await repository.transaction((db) => repository.accountForOidc(db, {
      provider,
      issuer: claims.iss,
      subject: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
    }));
    await issueSession(accountId, reply);
    return reply.redirect(flow.return_to, 303);
  });
}
