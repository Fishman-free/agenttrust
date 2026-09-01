import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { randomAlphanumeric, safeEqual, sanitizeReturnTo, sha256 } from "../src/security.js";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://example.invalid/auth",
  AUTH_ORIGIN: "http://localhost:3000",
  SIWE_DOMAIN: "localhost:3000",
  SIWE_URI: "http://localhost:3000",
  RETURN_TO_ORIGINS: "http://localhost:3000,https://agenttrust.site",
  COOKIE_SECURE: "false",
  COOKIE_NAME: "auth_session",
};

describe("configuration and browser security helpers", () => {
  it("defaults SIWE to Base Sepolia and accepts a positive local test chain", () => {
    expect(loadConfig(baseEnv).SIWE_CHAIN_ID).toBe(84532);
    expect(loadConfig({ ...baseEnv, SIWE_CHAIN_ID: "31337" }).SIWE_CHAIN_ID).toBe(31337);
    expect(() => loadConfig({ ...baseEnv, SIWE_CHAIN_ID: "0" })).toThrow();
  });

  it("fails closed when an OIDC provider is only partially configured", () => {
    const config = loadConfig({ ...baseEnv, GOOGLE_OIDC_ISSUER: "https://accounts.google.com", GOOGLE_OIDC_CLIENT_ID: "id" });
    expect(config.oidc.google.configured).toBe(false);
    expect(config.oidc.casdoor.configured).toBe(false);
  });

  it("treats GitHub as OAuth-only and does not require an issuer", () => {
    const complete = { GITHUB_OIDC_CLIENT_ID: "id", GITHUB_OIDC_CLIENT_SECRET: "secret", GITHUB_OIDC_REDIRECT_URI: "http://localhost:3000/api/auth/oidc/github/callback" };
    // GitHub 没有 OIDC discovery 端点，因此没有 issuer 也应视为已配置。
    expect(loadConfig({ ...baseEnv, ...complete }).oidc.github.configured).toBe(true);
    // 但 client secret 或 redirect URI 缺失时同样 fail closed。
    expect(loadConfig({ ...baseEnv, ...complete, GITHUB_OIDC_CLIENT_SECRET: "" }).oidc.github.configured).toBe(false);
    expect(loadConfig({ ...baseEnv, ...complete, GITHUB_OIDC_REDIRECT_URI: "" }).oidc.github.configured).toBe(false);
  });

  it("accepts extra browser origins so the loopback IP is not rejected", () => {
    // Origin 校验是精确字符串比较，localhost 与 127.0.0.1 是两个不同的 Origin。
    expect(loadConfig(baseEnv).browserOrigins.has("http://127.0.0.1:3000")).toBe(false);
    const config = loadConfig({ ...baseEnv, AUTH_ORIGINS: "http://127.0.0.1:3000, https://agenttrust.site" });
    expect([...config.browserOrigins].sort()).toEqual(["http://127.0.0.1:3000", "http://localhost:3000", "https://agenttrust.site"]);
  });

  it("requires Secure __Host cookies in production", () => {
    expect(() => loadConfig({ ...baseEnv, NODE_ENV: "production" })).toThrow("production cookies must be Secure");
    expect(() => loadConfig({ ...baseEnv, COOKIE_SECURE: "true", COOKIE_NAME: "auth_session" })).toThrow("__Host-");
  });

  it("allowlists returnTo and rejects protocol-relative or foreign redirects", () => {
    const config = loadConfig(baseEnv);
    expect(sanitizeReturnTo("/agents?new=1", config)).toBe("http://localhost:3000/agents?new=1");
    expect(sanitizeReturnTo("https://agenttrust.site/trade", config)).toBe("https://agenttrust.site/trade");
    expect(sanitizeReturnTo("//evil.example/path", config)).toBe("http://localhost:3000/");
    expect(sanitizeReturnTo("https://evil.example/path", config)).toBe("http://localhost:3000/");
    expect(sanitizeReturnTo("https://evil.example@agenttrust.site/path", config)).toBe("http://localhost:3000/");
    expect(sanitizeReturnTo("/\\evil.example", config)).toBe("http://localhost:3000/");
    expect(sanitizeReturnTo("javascript:alert(1)", config)).toBe("http://localhost:3000/");
  });

  it("generates SIWE nonces that viem accepts", () => {
    // 回归：base64url 的 nonce 含 '-' / '_'，viem 的 createSiweMessage 会直接抛错，
    // 导致约一半的钱包登录请求 500。nonce 必须是纯字母数字。
    for (let index = 0; index < 500; index += 1) {
      expect(randomAlphanumeric(18)).toMatch(/^[A-Za-z0-9]{18}$/);
    }
    expect(randomAlphanumeric(18)).not.toBe(randomAlphanumeric(18));
  });

  it("compares hashed CSRF values without variable-length timing leaks", () => {
    expect(safeEqual(sha256("one"), sha256("one"))).toBe(true);
    expect(safeEqual(sha256("one"), sha256("two"))).toBe(false);
    expect(safeEqual(Buffer.alloc(1), Buffer.alloc(2))).toBe(false);
  });
});
