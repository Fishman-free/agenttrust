// 覆盖 GitHub 直连 OAuth（绕过 Casdoor）的整条链路。
// 与 oidc.test.ts 的差别：GitHub 不是 OIDC，没有 discovery / id_token，
// 所以这里 mock 的是全局 fetch，而不是 openid-client。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

// GitHub API 对匿名请求 403，token 交换缺 Accept: application/json 时会返回 200 + urlencoded 错误体。
// 这两个 header 必须与实现严格对应，所以下面用真实 Response 对象逐条断言。
const github = {
  token: vi.fn(async () => Response.json({ access_token: "gho_test_token" })),
  user: vi.fn(async () => Response.json({ id: 4242, login: "octocat", email: "octocat@github.com" })),
  emails: vi.fn(async () => Response.json([])),
};
const fetchCalls: Array<{ url: string; init?: RequestInit | undefined }> = [];
const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  fetchCalls.push({ url, init });
  if (url === GITHUB_TOKEN_URL) return github.token();
  if (url === GITHUB_USER_URL) return github.user();
  if (url === GITHUB_EMAILS_URL) return github.emails();
  throw new Error(`unexpected fetch: ${url}`);
});
vi.stubGlobal("fetch", fetchMock);

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AuthRepository, OidcFlow, Queryable } from "../src/db.js";
import { sha256 } from "../src/security.js";

// 直连模式：只给 GITHUB_OAUTH_* 三项，不给 GITHUB_OIDC_*。
// 此时 oidc.github.configured 必须被互斥置 false，githubDirect.configured 为 true。
const directConfig = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://example.invalid/auth",
  AUTH_ORIGIN: "http://localhost:3000",
  SIWE_DOMAIN: "localhost:3000",
  SIWE_URI: "http://localhost:3000",
  SIWE_CHAIN_ID: "31337",
  RETURN_TO_ORIGINS: "http://localhost:3000",
  COOKIE_SECURE: "false",
  COOKIE_NAME: "auth_session",
  GITHUB_OAUTH_CLIENT_ID: "Iv1.github-client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "github-client-secret",
  GITHUB_OAUTH_REDIRECT_URI: "http://localhost:8323/api/auth/oidc/github/callback",
});

// 对照模式：直连三项都不给，GitHub 应回落到 OIDC 路径（本例未配 OIDC，故 503）。
const oidcOnlyConfig = loadConfig({
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

type Captured = {
  createdFlow?: { provider: string; stateHash: Buffer; nonce: string; codeVerifier: string; returnTo: string } | undefined;
  identity?: { provider: string; issuer: string; subject: string; email: string | null } | undefined;
};

function fakeRepository(flow: OidcFlow | null, captured: Captured): AuthRepository {
  const state: Captured = captured;
  return {
    transaction: async <T>(fn: (db: Queryable) => Promise<T>) => fn({} as Queryable),
    createOidcFlow: async (input: NonNullable<Captured["createdFlow"]>) => { state.createdFlow = input; },
    consumeOidcFlow: async () => flow,
    accountForOidc: async (_db: Queryable, input: NonNullable<Captured["identity"]>) => { state.identity = input; return "account-id"; },
    createSession: async () => undefined,
  } as unknown as AuthRepository;
}

function pendingFlow(): OidcFlow {
  return {
    id: "flow-id", provider: "github", nonce: "unused-nonce", code_verifier: "",
    return_to: "http://localhost:3000/agents", expires_at: new Date(Date.now() + 60_000),
  };
}

const CALLBACK_URL = "/api/auth/oidc/github/callback?code=authorization-code&state=abcdefghijklmnop";

describe("GitHub 直连 OAuth（绕过 Casdoor）", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls.length = 0;
    github.token.mockImplementation(async () => Response.json({ access_token: "gho_test_token" }));
    github.user.mockImplementation(async () => Response.json({ id: 4242, login: "octocat", email: "octocat@github.com" }));
    github.emails.mockImplementation(async () => Response.json([]));
  });
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("start 生成 GitHub 授权 URL：state 落库、scope 正确、关闭 allow_signup", async () => {
    const captured: Captured = {};
    const app = await buildApp(directConfig, fakeRepository(pendingFlow(), captured));
    apps.push(app);
    const response = await app.inject({
      method: "POST", url: "/api/auth/oidc/github/start",
      headers: { origin: directConfig.authOrigin }, payload: { returnTo: "/agents" },
    });
    expect(response.statusCode).toBe(200);
    const url = new URL(response.json().authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.github-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8323/api/auth/oidc/github/callback");
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    // 关掉 GitHub 的「注册新账号」入口，避免拉来匿名账号。
    expect(url.searchParams.get("allow_signup")).toBe("false");
    // 库里只存 state 的哈希，明文只出现在 URL 上。
    const state = url.searchParams.get("state") ?? "";
    expect(captured.createdFlow?.stateHash.equals(sha256(state))).toBe(true);
    expect(captured.createdFlow?.provider).toBe("github");
    // 直连不走 PKCE，不能出现 OIDC 专属参数。
    expect(url.searchParams.get("code_challenge")).toBeNull();
    expect(url.searchParams.get("nonce")).toBeNull();
  });

  it("callback 用 GitHub 数字 ID 作 subject，issuer 固定为 github:direct", async () => {
    const captured: Captured = {};
    const app = await buildApp(directConfig, fakeRepository(pendingFlow(), captured));
    apps.push(app);
    const response = await app.inject({ method: "GET", url: CALLBACK_URL });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("http://localhost:3000/agents");
    // issuer 与 Casdoor 中转的 https://login.agenttrust.site 不重叠，避免两条路径串号。
    expect(captured.identity).toMatchObject({
      provider: "github", issuer: "github:direct", subject: "4242", email: "octocat@github.com",
    });
    // 主邮箱已公开时不该再多打一次 /user/emails。
    expect(github.emails).not.toHaveBeenCalled();
  });

  it("token 交换带 Accept: application/json 与 User-Agent（否则 GitHub 静默返回 urlencoded 错误）", async () => {
    const captured: Captured = {};
    const app = await buildApp(directConfig, fakeRepository(pendingFlow(), captured));
    apps.push(app);
    await app.inject({ method: "GET", url: CALLBACK_URL });
    const tokenCall = fetchCalls.find((call) => call.url === GITHUB_TOKEN_URL);
    expect(tokenCall).toBeDefined();
    const headers = tokenCall?.init?.headers as Record<string, string>;
    expect(headers.accept).toBe("application/json");
    expect(headers["user-agent"]).toBe("agenttrust-auth-bff");
    expect(String(tokenCall?.init?.body)).toContain("code=authorization-code");
    const userCall = fetchCalls.find((call) => call.url === GITHUB_USER_URL);
    expect((userCall?.init?.headers as Record<string, string>).authorization).toBe("Bearer gho_test_token");
  });

  it("主邮箱未公开时回落到 /user/emails 取 primary + verified", async () => {
    github.user.mockImplementation(async () => Response.json({ id: 4242, login: "octocat", email: null }));
    github.emails.mockImplementation(async () => Response.json([
      { email: "stale@example.com", primary: false, verified: true },
      { email: "unverified@example.com", primary: true, verified: false },
      { email: "real@example.com", primary: true, verified: true },
    ]));
    const captured: Captured = {};
    const app = await buildApp(directConfig, fakeRepository(pendingFlow(), captured));
    apps.push(app);
    const response = await app.inject({ method: "GET", url: CALLBACK_URL });
    expect(response.statusCode).toBe(303);
    expect(github.emails).toHaveBeenCalledTimes(1);
    expect(captured.identity?.email).toBe("real@example.com");
  });

  it("state 无效或已消费 → 400 invalid_or_consumed_oauth_state", async () => {
    const captured: Captured = {};
    const app = await buildApp(directConfig, fakeRepository(null, captured));
    apps.push(app);
    const response = await app.inject({ method: "GET", url: CALLBACK_URL });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_or_consumed_oauth_state");
    // 这一步就该中断，不能继续拿 code 去换 token。
    expect(fetchCalls).toHaveLength(0);
  });

  it("token 交换失败 / 缺 token / 拉取用户失败 → 502，错误码可区分", async () => {
    const cases = [
      { name: "github_token_exchange_failed", token: () => new Response("denied", { status: 502 }), user: () => Response.json({ id: 1 }) },
      { name: "github_token_missing", token: () => Response.json({ error: "bad_verification_code" }), user: () => Response.json({ id: 1 }) },
      { name: "github_user_lookup_failed", token: () => Response.json({ access_token: "gho_test_token" }), user: () => new Response("nope", { status: 401 }) },
    ] as const;
    for (const item of cases) {
      github.token.mockImplementation(item.token as never);
      github.user.mockImplementation(item.user as never);
      const app = await buildApp(directConfig, fakeRepository(pendingFlow(), {}));
      apps.push(app);
      const response = await app.inject({ method: "GET", url: CALLBACK_URL });
      expect(response.statusCode, item.name).toBe(502);
      expect(response.json().error, item.name).toBe(item.name);
    }
  });

  it("capabilities 在直连模式下仍报 github 可用（互斥不能让按钮消失）", async () => {
    expect(directConfig.oidc.github.configured).toBe(false);
    expect(directConfig.githubDirect.configured).toBe(true);
    const app = await buildApp(directConfig, fakeRepository(pendingFlow(), {}));
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/auth/capabilities" });
    expect(response.statusCode).toBe(200);
    expect(response.json().oidc.github.configured).toBe(true);
  });

  it("未配直连时不抢路由：GitHub 回落到 OIDC 路径（未配 OIDC 则 503）", async () => {
    expect(oidcOnlyConfig.githubDirect.configured).toBe(false);
    const app = await buildApp(oidcOnlyConfig, fakeRepository(pendingFlow(), {}));
    apps.push(app);
    const response = await app.inject({
      method: "POST", url: "/api/auth/oidc/github/start",
      headers: { origin: oidcOnlyConfig.authOrigin }, payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("provider_not_configured");
  });
});
