import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";

export const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sanitizeReturnTo(input: string | undefined, config: Pick<Config, "returnToOrigins" | "authOrigin">) {
  const fallback = `${config.authOrigin}/`;
  if (!input || /[\u0000-\u001f\u007f]/.test(input)) return fallback;
  if (input.startsWith("/")) {
    if (input.startsWith("//") || input.includes("\\")) return fallback;
    const relative = new URL(input, config.authOrigin);
    return relative.origin === config.authOrigin ? relative.toString() : fallback;
  }
  try {
    const candidate = new URL(input);
    const allowedOrigins = new Set([config.authOrigin, ...config.returnToOrigins]);
    if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) return fallback;
    return allowedOrigins.has(candidate.origin) ? candidate.toString() : fallback;
  } catch {
    return fallback;
  }
}

export function enforceBrowserRequest(request: FastifyRequest, config: Pick<Config, "authOrigin">) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.origin;
  if (origin !== config.authOrigin) throw Object.assign(new Error("invalid_origin"), { statusCode: 403 });
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    throw Object.assign(new Error("cross_site_request_blocked"), { statusCode: 403 });
  }
}

export function setNoStore(reply: FastifyReply) {
  reply.header("cache-control", "no-store").header("pragma", "no-cache");
}
