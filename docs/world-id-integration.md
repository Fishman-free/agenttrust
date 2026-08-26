# World ID Integration

**English** | [简体中文](world-id-integration.zh-CN.md)

[← Back to feature walkthrough](feature-walkthrough.md) · [Anti-Sybil analysis](security/anti-sybil-analysis.md) · [Project README](../README.md)

> **Live testnet status:** the Base Sepolia core deployment is RPC-validated in [`../deployments/84532.json`](../deployments/84532.json). World ID app `app_01728cabff1e05950af1ff18c06c9d38` and relying party `rp_fd884ac4342cc4d1` are registered. The contracts are unaudited, testnet-only, and not production-ready.

## 1. Live architecture

World ID v4 has no direct verifier available on Base Sepolia. AgentTrust therefore uses an explicit **backend-attestation** architecture rather than claiming direct onchain World proof verification:

```text
IDKit / World proof
  → same-origin /api/world-id
  → official World ID v4 Developer Portal API
  → trusted-attester signature (server-only signer key)
  → WorldIDV4AttestationVerifier
  → AgentRegistry
```

| Component | Verified live state |
|---|---|
| Public site | https://agenttrust.site on Tokyo Caddy with valid HTTPS; `www` redirects to apex |
| Core contracts | Deployed and RPC-validated; use [`../deployments/84532.json`](../deployments/84532.json) |
| App / RP | `app_01728cabff1e05950af1ff18c06c9d38` / `rp_fd884ac4342cc4d1` |
| Backend | Same-origin `/api/world-id`, using the official v4 Developer Portal API |
| Adapter | `WorldIDV4AttestationVerifier` at `0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF` |
| Registry binding | Adapter bound to `AgentRegistry` |
| Enabled gates | PoH registration, guarantor eligibility, and juror eligibility |
| GitHub Pages | Deployment-gate workflow modified but not merged |

The backend signer keys are server-only. They must never be placed in frontend bundles, public environment variables, logs, or documentation.

## 2. Trust boundary

The adapter verifies a trusted-attester signature; it does **not** independently verify the World proof onchain. Security therefore depends on all of the following:

1. the official World ID v4 Developer Portal API returning the correct result;
2. the `/api/world-id` backend validating requests and responses correctly;
3. trusted-attester signer keys remaining confidential and under operator control;
4. the Registry remaining bound to the intended adapter; and
5. replay, action, signal, chain, expiry, and nullifier checks remaining correctly enforced.

A compromise of the backend or attester key can create false PoH attestations. Rotate and revoke compromised keys, monitor adapter/Registry changes, and treat every attestation as backend-trusted—not trustless direct World verification.

## 3. Registration and privileged-role behavior

A successful backend verification produces the attestation consumed by the Registry path. This enables verified registration or `bindPoH`, and the contracts enforce `isPoHVerified` for guarantors and jurors. Ordinary registration remains available with its higher deposit and without privileged-role eligibility.

Local Anvil and CI continue to use development/mock verifiers for deterministic testing. Those mocks are not evidence of real World verification and must never be deployed publicly.

## 4. Recovery behavior

The deployed adapter's `verifySameIdentity` returns `false`. Therefore the same-identity fast path is unavailable on Base Sepolia. Recovery always falls back to the guardian path:

- **all configured guardians must approve**;
- the request has a **48-hour veto window**; and
- normal execution-window and unsettled-obligation checks still apply.

Documentation or UI must not advertise one-guardian/24-hour recovery for the live Base Sepolia deployment.

## 5. Operational checks

- Confirm `/api/world-id` remains same-origin and HTTPS-only.
- Confirm signer secrets are server-only and absent from static output.
- Verify `AgentRegistry.pohVerifier()` equals `0x219A3c4F80d1CE97Caf83f1Aa882a231cb1025FF`.
- Monitor attester rotation and Registry verifier changes.
- Test rejection of replayed, expired, wrong-action, wrong-signal, wrong-chain, and malformed requests.
- Keep the unaudited/testnet-only/not-production-ready warning visible.

---

[← Back to feature walkthrough](feature-walkthrough.md) · [Anti-Sybil analysis](security/anti-sybil-analysis.md) · [Project README](../README.md)
