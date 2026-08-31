import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { buildAgentRegistryId, buildBindingDigest, randomBindingNonce, verifyWellKnownRegistration } from "./agent-identity.js";
import { VERIFICATION_LEVEL, type IdentityWriter } from "./identity-attester.js";
import type { Config } from "./config.js";
import { setNoStore } from "./security.js";

export interface AgentIdentityDeps {
  fetchWellKnown?: (url: string) => Promise<Response>;
  attestWriter?: IdentityWriter;
}

export interface AgentIdentityHelpers {
  requireAuth: (request: FastifyRequest) => Promise<unknown>;
  requireCsrf: (request: FastifyRequest, auth: unknown) => void;
}

const agentIdSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .transform((value) => BigInt(value))
  .refine((value) => value < 2n ** 256n, "agent_id_out_of_range");
const challengeSchema = z.object({ agentId: agentIdSchema }).strict();
const attestSchema = z.object({ agentId: agentIdSchema, domain: z.string().min(3).max(253) }).strict();

export function registerAgentIdentityRoutes(app: FastifyInstance, config: Config, helpers: AgentIdentityHelpers, deps?: AgentIdentityDeps) {
  deps = deps ?? {};
  const attestWriter = deps.attestWriter;

  app.post(
    "/api/agent-identity/challenge",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      setNoStore(reply);
      const auth = await helpers.requireAuth(request);
      helpers.requireCsrf(request, auth);
      const { agentId } = challengeSchema.parse(request.body);
      const nonce = randomBindingNonce();
      const digest = buildBindingDigest(agentId, nonce);
      return {
        agentId: agentId.toString(),
        nonce,
        digest,
        expiresAt: new Date(Date.now() + config.CHALLENGE_TTL_SECONDS * 1000).toISOString(),
      };
    },
  );

  app.post(
    "/api/agent-identity/attest-domain",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      setNoStore(reply);
      const auth = await helpers.requireAuth(request);
      helpers.requireCsrf(request, auth);
      if (!attestWriter) throw Object.assign(new Error("identity_attestation_disabled"), { statusCode: 503 });
      const { agentId, domain } = attestSchema.parse(request.body);
      const expectedRegistry = buildAgentRegistryId(BigInt(config.SIWE_CHAIN_ID), config.AGENT_REGISTRY_ADDRESS as `0x${string}`);
      let result;
      try {
        result = await verifyWellKnownRegistration(deps.fetchWellKnown ?? fetch, domain, { expectedAgentId: agentId, expectedRegistry });
      } catch (error) {
        const message = error instanceof Error ? error.message : "wellknown_failed";
        if (message.startsWith("wellknown_")) throw Object.assign(new Error(message), { statusCode: 400 });
        throw error;
      }
      let txHash: string;
      try {
        txHash = await attestWriter.attest(agentId, VERIFICATION_LEVEL.DomainControl, result.proofHash, domain);
      } catch {
        throw Object.assign(new Error("attestation_write_failed"), { statusCode: 502 });
      }
      return { verified: true, agentId: agentId.toString(), domain, proofHash: result.proofHash, txHash };
    },
  );
}
