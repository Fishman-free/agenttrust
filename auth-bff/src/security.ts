import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";

export const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * SIWE 的 nonce 必须是纯字母数字（viem 会直接抛错），而 base64url 会产出 `-` 和 `_`。
 * 24 字符的 base64url 串里出现这两个符号的概率约 53%——也就是说钱包登录有一半概率
 * 随机 500。会话令牌和 CSRF 用 base64url 无妨，只有 nonce 需要这个变体。
 */
export function randomAlphanumeric(length: number) {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // 丢弃 >= 248 的字节以消除取模偏差（248 = 4 × 62）。
      if (byte >= 248) continue;
      out += ALPHANUMERIC[byte % ALPHANUMERIC.length];
      if (out.length === length) break;
    }
  }
  return out;
}

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

export function enforceBrowserRequest(request: FastifyRequest, config: Pick<Config, "browserOrigins">) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.origin;
  // 用允许集合而非单值：浏览器对 localhost 和 127.0.0.1 发送不同的 Origin 头，
  // 只认其中一个会让从另一个入口访问的写请求全部 403。
  if (typeof origin !== "string" || !config.browserOrigins.has(origin)) throw Object.assign(new Error("invalid_origin"), { statusCode: 403 });
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    throw Object.assign(new Error("cross_site_request_blocked"), { statusCode: 403 });
  }
}

export function setNoStore(reply: FastifyReply) {
  reply.header("cache-control", "no-store").header("pragma", "no-cache");
}
