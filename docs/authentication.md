# AgentTrust authentication

## Trust boundaries

AgentTrust separates four states that must not be presented as one credential:

1. An application session proves a successful wallet signature or OIDC login.
2. A linked wallet proves control of the address used for transaction prompts.
3. an AgentRegistry entry creates the onchain Agent identity used by trades.
4. The current Base Sepolia contracts use their PoH flag for guarantor and juror eligibility.

Google and Apple login are not real-name verification. World ID is an experimental proof-of-humanity path, not legal identity. The planned enhanced identity module is not active and must not collect documents or grant onchain roles.

## Wallet authentication

`auth-bff` creates the SIWE message and stores a short-lived challenge in PostgreSQL. Verification checks the exact stored message, domain, URI, chain, purpose, address, timestamps and signature before atomically consuming the challenge. A successful login creates an opaque HttpOnly session; only its SHA-256 hash is stored.

Casdoor's MetaMask and Web3-Onboard providers are prohibited. Their client-side flows are not part of the AgentTrust trust boundary.

## Google and Apple through Casdoor

Casdoor is optional and acts only as an OIDC broker. It must not be started or exposed until at least one real OAuth provider is configured. The checked-in example pins Casdoor v3.161.1 and keeps its database and port private.

Before enabling `login.agenttrust.site`:

- replace the default administrator credentials and require administrator MFA;
- disable public local-password registration unless explicitly needed;
- configure only Google and/or Apple OAuth providers;
- verify that no MetaMask, Web3 or Web3-Onboard provider exists;
- create a confidential OIDC application for Auth BFF;
- keep the client secret, Google secret and Apple `.p8` key outside Git;
- use Authorization Code with PKCE, state and OIDC nonce;
- identify users by verified `issuer + subject`, never by matching email;
- restrict the management interface by IP, VPN or a separate protected hostname;
- back up the Casdoor database and test restoration before relying on it.

Until provider credentials exist, `/api/auth/capabilities` reports Google and Apple as unavailable and the frontend displays an honest configuration placeholder.

## Production cookies and CSRF

Production uses a host-only `__Host-` session cookie with `Secure`, `HttpOnly`, `SameSite=Lax` and `Path=/`. The BFF validates Origin and Fetch Metadata on unsafe requests and requires the CSRF header returned by `/api/auth/session` for logout and wallet linking. Authentication responses are `no-store`.

## Deployment layout

```text
agenttrust.site
├── /api/auth/*      -> 127.0.0.1:8323 (Auth BFF)
├── /api/world-id/*  -> 127.0.0.1:8322 (World ID service)
└── /*                -> /var/www/agenttrust (static export)

login.agenttrust.site (not enabled without OAuth credentials)
└── /*                -> private Casdoor service
```

Auth BFF and Casdoor use separate PostgreSQL databases and database users. Auth BFF never reads Casdoor's internal tables. Neither database listens on a public interface.
