import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { signRequest } from "@worldcoin/idkit-server";
import Fastify from "fastify";
import { ZodError } from "zod";
import { ACTION, APP_ID, ORIGIN, RP_ID, type Config } from "./config.js";
import { issueAttestation, validateResult, verifyRequestSchema } from "./world.js";

type NonceState = { expiresAt: number; consumed: boolean };

export async function buildApp(config: Config, fetchImpl: typeof fetch = fetch) {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.body.result", "WORLD_ID_SIGNER_PRIVATE_KEY", "WORLD_ID_ATTESTER_PRIVATE_KEY"] }, bodyLimit: 32 * 1024, trustProxy: true });
  const nonces = new Map<string, NonceState>();
  await app.register(cors, { origin: (origin, callback) => callback(null, origin === undefined || origin === ORIGIN), methods: ["GET", "POST"], allowedHeaders: ["content-type"], credentials: false, maxAge: 600 });
  await app.register(rateLimit, { max: 30, timeWindow: "1 minute", hook: "onRequest", keyGenerator: (request) => request.ip });

  app.get("/api/world-id/health", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async () => ({ ok: true, service: "world-id", protocol: "4.0" }));

  app.get("/api/world-id/context", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async () => {
    const signed = signRequest({ signingKeyHex: config.WORLD_ID_SIGNER_PRIVATE_KEY, action: ACTION, ttl: config.WORLD_ID_CONTEXT_TTL_SECONDS });
    nonces.set(signed.nonce.toLowerCase(), { expiresAt: signed.expiresAt, consumed: false });
    return { app_id: APP_ID, action: ACTION, environment: "production", rp_context: { rp_id: RP_ID, nonce: signed.nonce, created_at: signed.createdAt, expires_at: signed.expiresAt, signature: signed.sig } };
  });

  app.post("/api/world-id/verify", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = verifyRequestSchema.parse(request.body);
    const now = Math.floor(Date.now() / 1000);
    const nonce = nonces.get(parsed.result.nonce.toLowerCase());
    if (!nonce || nonce.consumed || nonce.expiresAt <= now) return reply.code(400).send({ error: "invalid_or_consumed_nonce" });
    const validated = validateResult(parsed.subject, parsed.result, now);
    nonce.consumed = true;
    const upstream = await fetchImpl(config.WORLD_ID_VERIFY_URL, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(parsed.result), signal: AbortSignal.timeout(10_000),
    });
    const upstreamBody = await upstream.json().catch(() => null) as { success?: boolean; code?: string } | null;
    if (!upstream.ok || upstreamBody?.success !== true) {
      request.log.warn({ status: upstream.status, code: upstreamBody?.code }, "World ID verification rejected");
      return reply.code(400).send({ error: "world_id_verification_failed" });
    }
    const issued = await issueAttestation(config, validated.subject, validated.response.nullifier as `0x${string}`, now);
    return reply.header("cache-control", "no-store").send(issued);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "invalid_request", issues: error.issues.map(({ path, code }) => ({ path, code })) });
    const message = error instanceof Error ? error.message : "unknown_error";
    if (["user_presence_required", "signal_mismatch", "credential_expired"].includes(message)) return reply.code(400).send({ error: message });
    app.log.error(error);
    return reply.code(500).send({ error: "internal_error" });
  });
  return app;
}
