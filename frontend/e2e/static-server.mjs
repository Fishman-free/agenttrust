import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";
import { verifyMessage } from "viem";

const root = resolve(process.cwd(), "out");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const challenges = new Map();
const sessions = new Map();
function json(response, status, value, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}
function body(request) {
  return new Promise((resolveBody, reject) => {
    let value = "";
    request.on("data", (chunk) => { value += chunk; if (value.length > 16_384) reject(new Error("body_too_large")); });
    request.on("end", () => { try { resolveBody(value ? JSON.parse(value) : {}); } catch (error) { reject(error); } });
  });
}
function sessionId(request) { return request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("agenttrust_e2e="))?.slice(15); }
function auth(request) { return sessions.get(sessionId(request)); }
function requireCsrf(request, session) { return Boolean(session && request.headers["x-csrf-token"] === session.csrfToken); }
function challengeMessage(address, nonce, purpose) {
  return `agenttrust.site wants you to sign in with your Ethereum account:\n${address}\n\nAgentTrust ${purpose}\n\nURI: http://127.0.0.1:3000\nVersion: 1\nChain ID: 31337\nNonce: ${nonce}`;
}
function accountView(session) { return { id: session.id, created_at: session.createdAt, wallet: session.wallet, identities: session.identities }; }

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/api/auth/")) {
    try {
      if (request.method === "GET" && url.pathname === "/api/auth/capabilities") return json(response, 200, { wallet: { enabled: true, chainId: 31337, siwe: true }, oidc: { google: { configured: false }, github: { configured: false }, apple: { configured: false }, casdoor: { configured: false } } });
      if (request.method === "GET" && url.pathname === "/api/auth/session") {
        const session = auth(request);
        return json(response, 200, session ? { authenticated: true, account: accountView(session), csrfToken: session.csrfToken } : { authenticated: false });
      }
      if (request.method === "POST" && (url.pathname === "/api/auth/wallet/challenge" || url.pathname === "/api/auth/wallet/link/challenge")) {
        const linking = url.pathname.includes("/link/");
        const session = auth(request);
        if (linking && !requireCsrf(request, session)) return json(response, 403, { error: "csrf_validation_failed" });
        const { address } = await body(request);
        if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) return json(response, 400, { error: "invalid_address" });
        const nonce = randomBytes(16).toString("hex");
        const purpose = linking ? "wallet link" : "wallet login";
        const message = challengeMessage(address, nonce, purpose);
        challenges.set(nonce, { address: address.toLowerCase(), message, purpose, sessionId: linking ? session.id : null, expires: Date.now() + 60_000 });
        return json(response, 200, { nonce, message, expiresAt: new Date(Date.now() + 60_000).toISOString(), chainId: 31337, purpose: linking ? "wallet_link" : "wallet_login" });
      }
      if (request.method === "POST" && (url.pathname === "/api/auth/wallet/verify" || url.pathname === "/api/auth/wallet/link/verify")) {
        const linking = url.pathname.includes("/link/");
        const session = auth(request);
        if (linking && !requireCsrf(request, session)) return json(response, 403, { error: "csrf_validation_failed" });
        const { nonce, message, signature, ...extra } = await body(request);
        if (Object.keys(extra).length) return json(response, 400, { error: "invalid_request" });
        const challenge = challenges.get(nonce); challenges.delete(nonce);
        if (!challenge || challenge.expires < Date.now() || challenge.message !== message || (linking ? challenge.sessionId !== session.id : challenge.sessionId !== null)) return json(response, 400, { error: "invalid_or_consumed_challenge" });
        const address = `0x${challenge.address.slice(2)}`;
        if (!await verifyMessage({ address, message, signature })) return json(response, 400, { error: "siwe_signature_invalid" });
        if (linking) {
          if (session.wallet) return json(response, 409, { error: "conflict" });
          session.wallet = address;
          return json(response, 200, { linked: true, account: accountView(session) });
        }
        const id = randomBytes(24).toString("hex");
        const csrfToken = randomBytes(24).toString("hex");
        const next = { id, createdAt: new Date().toISOString(), wallet: address, identities: [], csrfToken };
        sessions.set(id, next);
        return json(response, 200, { authenticated: true, account: accountView(next) }, { "set-cookie": `agenttrust_e2e=${id}; HttpOnly; SameSite=Lax; Path=/` });
      }
      if (request.method === "POST" && /^\/api\/auth\/oidc\/(google|github|apple)\/start$/.test(url.pathname)) return json(response, 503, { error: "provider_not_configured" });
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        const session = auth(request);
        if (!requireCsrf(request, session)) return json(response, 403, { error: "csrf_validation_failed" });
        sessions.delete(sessionId(request));
        return json(response, 204, undefined, { "set-cookie": "agenttrust_e2e=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
      }
      return json(response, 404, { error: "not_found" });
    } catch { return json(response, 400, { error: "bad_request" }); }
  }
  const pathname = decodeURIComponent(url.pathname);
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  let candidate = join(root, relative);
  if (!candidate.startsWith(root)) candidate = join(root, "404.html");
  if (existsSync(candidate) && statSync(candidate).isDirectory()) candidate = join(candidate, "index.html");
  if (!existsSync(candidate) && !extname(candidate)) candidate = join(candidate, "index.html");
  let status = 200;
  if (!existsSync(candidate) || !candidate.startsWith(root)) { candidate = join(root, "404.html"); status = 404; }
  response.writeHead(status, { "content-type": mime[extname(candidate)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(candidate).pipe(response);
}).listen(3000, "127.0.0.1", () => console.log("E2E static export + Auth BFF listening on http://127.0.0.1:3000"));
