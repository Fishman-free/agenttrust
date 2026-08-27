import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { safeEqual, sanitizeReturnTo, sha256 } from "../src/security.js";

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

  it("compares hashed CSRF values without variable-length timing leaks", () => {
    expect(safeEqual(sha256("one"), sha256("one"))).toBe(true);
    expect(safeEqual(sha256("one"), sha256("two"))).toBe(false);
    expect(safeEqual(Buffer.alloc(1), Buffer.alloc(2))).toBe(false);
  });
});
