// 手写 GitHub OAuth App 流程。
// 背景：GitHub OAuth App 不是 OIDC —— 没有 discovery 端点、没有 id_token；
// openid-client 不能用，因此单独走 fetch + GitHub REST API。
//
// 调用方约定（来自 oidc.ts 分发）：
//   路由仍是 /api/auth/oidc/github/start 与 /api/auth/oidc/github/callback，
//   前端零改动；仅当 config.githubDirect.configured 为 true 时本文件被命中。
//
// 身份去重策略：
//   GitHub 没有 issuer 概念。accountForOidc 用 (provider, issuer, subject) 三元组做主键。
//   我们把 issuer 写死成 "github:direct"（与 Casdoor 中转的 https://login.agenttrust.site
//   不重叠），subject 是 GitHub 的数字 ID 字符串。这样直接中转路径切换时不会与旧身份串号，
//   同一用户先走 Casdoor 后切直连则视为两个不同 identity（管理员按需迁移）。
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import type { AuthRepository } from "./db.js";
import { randomToken, sanitizeReturnTo, sha256, setNoStore } from "./security.js";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_USER = "https://api.github.com/user";
const GITHUB_EMAILS = "https://api.github.com/user/emails";
// 真实 GitHub OAuth 的 subject锚点：用户在 GitHub 上的全局数字 ID，永远不变。
const DIRECT_ISSUER = "github:direct";
// GitHub API 强制要求 User-Agent 头，匿名请求会被 403。
const GITHUB_USER_AGENT = "agenttrust-auth-bff";

const startSchema = z.object({ returnTo: z.string().max(2048).optional() }).strict();
const callbackSchema = z.object({ code: z.string().min(1), state: z.string().min(16) }).passthrough();

type IssueSession = (accountId: string, reply: FastifyReply) => Promise<void>;

export async function githubDirectStart(
  request: FastifyRequest,
  config: Config,
  repository: AuthRepository,
  reply: FastifyReply,
) {
  const body = startSchema.parse(request.body ?? {});
  const state = randomToken(24);
  // nonce / codeVerifier 字段是 db schema 的必填项，但 GitHub OAuth2 不使用 OIDC 的 nonce / PKCE。
  // 这里填随机值占位以满足 schema，callback 不会读取它们（通过 provider=github 的 OIDC 路径
  // 才读；本路径直接 consumeOidcFlow 拿到 flow 后只取 return_to）。
  const returnTo = sanitizeReturnTo(body.returnTo, config);
  await repository.createOidcFlow({
    provider: "github",
    stateHash: sha256(state),
    nonce: randomToken(24),
    codeVerifier: "",
    returnTo,
    expiresAt: new Date(Date.now() + config.OIDC_FLOW_TTL_SECONDS * 1000),
  });
  setNoStore(reply);
  const url = new URL(GITHUB_AUTHORIZE);
  url.searchParams.set("client_id", config.githubDirect.clientId);
  url.searchParams.set("redirect_uri", config.githubDirect.redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  // 关掉 GitHub 在 OAuth 流程里展示的"注册新账号"入口：用户必须先登录 GitHub 再授权，
  // 避免拉来一群匿名账号污染数据库。
  url.searchParams.set("allow_signup", "false");
  return { authorizationUrl: url.toString() };
}

export async function githubDirectCallback(
  request: FastifyRequest,
  config: Config,
  repository: AuthRepository,
  issueSession: IssueSession,
  reply: FastifyReply,
) {
  const query = callbackSchema.parse(request.query);
  const flow = await repository.transaction((db) => repository.consumeOidcFlow(db, sha256(query.state), "github"));
  if (!flow) throw Object.assign(new Error("invalid_or_consumed_oauth_state"), { statusCode: 400 });
  // GitHub 要求 Accept: application/json，否则会返回 200 + urlencoded 错误体（不抛错）。
  const tokenResp = await fetch(GITHUB_TOKEN, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": GITHUB_USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: config.githubDirect.clientId,
      client_secret: config.githubDirect.clientSecret,
      code: query.code,
      redirect_uri: config.githubDirect.redirectUri,
      state: query.state,
    }).toString(),
  });
  if (!tokenResp.ok) throw Object.assign(new Error("github_token_exchange_failed"), { statusCode: 502 });
  const tokenJson = (await tokenResp.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) throw Object.assign(new Error("github_token_missing"), { statusCode: 502 });
  const accessToken = tokenJson.access_token;

  const userResp = await fetch(GITHUB_USER, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": GITHUB_USER_AGENT,
    },
  });
  if (!userResp.ok) throw Object.assign(new Error("github_user_lookup_failed"), { statusCode: 502 });
  const user = (await userResp.json()) as { id: number; login: string; email: string | null };

  // 主邮箱可能因用户隐私设置未公开，需另取 /user/emails 取 primary+verified 邮箱。
  let email = typeof user.email === "string" ? user.email : null;
  if (!email) {
    const emailsResp = await fetch(GITHUB_EMAILS, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/vnd.github+json",
        "user-agent": GITHUB_USER_AGENT,
      },
    });
    if (emailsResp.ok) {
      const emails = (await emailsResp.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
      email = emails.find((e) => e.primary && e.verified)?.email
        ?? emails.find((e) => e.verified)?.email
        ?? null;
    }
  }

  const accountId = await repository.transaction((db) => repository.accountForOidc(db, {
    provider: "github",
    issuer: DIRECT_ISSUER,
    subject: String(user.id),
    email,
  }));
  await issueSession(accountId, reply);
  return reply.redirect(flow.return_to, 303);
}

export function registerGithubDirectRoutes(
  app: FastifyInstance,
  config: Config,
  repository: AuthRepository,
  issueSession: IssueSession,
) {
  // 仅当 GitHub 直连 OAuth 三项齐全时挂载，否则 oidc.ts 的 OIDC 路径继续生效。
  // 调用方应在挂载 oidc 之前先调一次 registerGithubDirectRoutes，让其优先级
  // 高于 /api/auth/oidc/github/* 的 OIDC 实现（同一路由前缀 Fastify 会按注册顺序匹配）。
  if (!config.githubDirect.configured) return;
  app.post("/api/auth/oidc/github/start", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    return githubDirectStart(request, config, repository, reply);
  });
  app.get("/api/auth/oidc/github/callback", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    return githubDirectCallback(request, config, repository, issueSession, reply);
  });
}