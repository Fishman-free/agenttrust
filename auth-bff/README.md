# AgentTrust Auth BFF

Standalone Node 22 / TypeScript ESM authentication BFF using Fastify, Zod, PostgreSQL, SIWE, and generic OIDC. It is intentionally independent from the repository root compose, frontend, deployment, and World ID service.

## API contract

All paths below are prefixed with `/api/auth`. Every `POST` requires `Origin` to exactly equal `AUTH_ORIGIN`; authenticated `POST` requests also require `X-CSRF-Token` from the authenticated session response. JSON request bodies reject unknown fields.

- `GET /health` → `{ ok, service, database }`; performs a PostgreSQL readiness query.
- `GET /capabilities` → `{ wallet: { enabled, chainId, siwe }, oidc: { google: { configured }, github: { configured }, apple: { configured }, casdoor: { configured } } }`. The nested shape is stable.
- `GET /session` → `{ authenticated: false }` when no valid session, otherwise `{ authenticated: true, csrfToken, account: { id, created_at, wallet, identities: [{ provider, issuer, email }] } }`. Responses are `Cache-Control: no-store`; use `csrfToken` as `X-CSRF-Token` for logout and wallet linking.
- `POST /logout` with no body → `204`; revokes the current session and clears session/CSRF cookies.
- `POST /wallet/challenge` with `{ address }` → `{ message, nonce, expiresAt, chainId, purpose: "wallet_login" }`.
- `POST /wallet/verify` with `{ nonce, message, signature }` → `{ authenticated: true, account }` and sets session/CSRF cookies.
- `POST /wallet/link/challenge` with `{ address }` → the same challenge shape with `purpose: "wallet_link"`; requires session and CSRF.
- `POST /wallet/link/verify` with `{ nonce, message, signature }` → `{ linked: true, account }`; requires session and CSRF.
- `POST /oidc/:provider/start` with optional `{ returnTo }` → `{ authorizationUrl }` for `google`, `github`, `apple`, or `casdoor`. The server persists state, PKCE verifier, and OIDC nonce; the URL includes state, PKCE challenge, and nonce.
- `GET /oidc/:provider/callback?code=...&state=...` validates state, PKCE, and the persisted expected OIDC nonce, keys identities by validated `issuer + subject`, creates a session, then returns `303` to the sanitized `returnTo`.

Casdoor is treated only as a standards-based OIDC provider. No Casdoor Web3 or wallet API is used. Every OIDC provider returns `503 provider_not_configured` until issuer, client ID, client secret, and redirect URI are all supplied.

## Security contract

- SIWE is generated server-side and verifies the exact stored message, domain, URI, configured positive `SIWE_CHAIN_ID`, purpose statement, nonce, address, issued-at, and expiry before signature acceptance. Production uses Base Sepolia `84532`; local Compose/CI may explicitly use `31337`.
- PostgreSQL atomically consumes each challenge; replay races result in one winner.
- The session cookie is opaque, `HttpOnly`, `SameSite=Lax`, path `/`, and `Secure` with a `__Host-` name in production. Only SHA-256 token hashes are stored.
- Development HTTP must explicitly use `COOKIE_SECURE=false` and a non-`__Host-` `COOKIE_NAME`.
- A separate readable CSRF cookie must exactly match `X-CSRF-Token` and its server-side hash. The authenticated `/session` response returns the current value as `csrfToken` and rotates it if the CSRF cookie is absent or invalid. Unsafe requests also require the exact configured Origin and accepted Fetch Metadata.
- `returnTo` accepts only safe `/`-prefixed paths resolved against `AUTH_ORIGIN`, or absolute HTTP(S) URLs whose origin exactly matches `AUTH_ORIGIN`/`RETURN_TO_ORIGINS`; protocol-relative paths, backslashes, credentials, control characters, foreign origins, and non-HTTP schemes fall back to `AUTH_ORIGIN/`.
- Fastify/Pino redacts cookies, authorization, CSRF, SIWE messages/signatures, set-cookie, and OIDC secrets. Responses containing auth state are `no-store`.
- A unique account wallet and globally unique normalized wallet address are enforced in PostgreSQL.

## Setup

Requires Node.js 22 and PostgreSQL 14+.

```bash
cp .env.example .env
npm install
set -a && . ./.env && set +a
npm run migrate
npm run dev
```

For Windows PowerShell, load `.env` with your preferred environment loader or set each variable before running scripts. The service itself does not automatically read `.env`, avoiding accidental production secret loading.

## Database migrations

`npm run migrate` applies sorted files in `migrations/` once and records them in `auth_bff_migrations`. Run migrations as a deployment step before starting or upgrading the service. Call `SELECT auth_bff_delete_expired_data();` periodically to remove stale challenges, OIDC flows, and sessions.

## Tests and build

```bash
npm run lint
npm test
npm run build
```

Unit tests always run. PostgreSQL integration tests run when `TEST_DATABASE_URL` points to a disposable database; they truncate auth tables and must never target production.

```bash
TEST_DATABASE_URL=postgresql://auth_bff:password@127.0.0.1:5432/auth_bff_test npm test
```

## Deployment

The Docker image runs as uid/gid `10001` and expects migrations to be run separately. The `agenttrust-auth-bff@.service` template expects files in `/opt/agenttrust/auth-bff`, a dedicated `auth-bff` system user, and an environment file at `/etc/agenttrust/auth-bff-<instance>.env` with mode `0600`. Terminate TLS at a trusted reverse proxy, keep the app bound to loopback, and set `TRUST_PROXY` only to match that topology.
