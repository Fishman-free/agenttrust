# World ID Integration

**English** | [简体中文](world-id-integration.zh-CN.md)

[← Back to feature walkthrough](feature-walkthrough.md) · [Anti-Sybil analysis](security/anti-sybil-analysis.md) · [Project README](../README.md)

> Status: Contract and frontend scaffolding implemented as of 2026-08-26; **the real World ID adapter has not been deployed or validated on Base Sepolia**. Validation requires a World Developer Portal `app_id` and frontend IDKit integration. Local Anvil and CI use development/mock verifiers to simulate the flows; they are not evidence that real World ID verification works.
> Verification baseline: **146 contract tests passed**.
> Design reference: [`docs/superpowers/specs/2026-08-26-world-id-poh-tiered-recovery-design.md`](superpowers/specs/2026-08-26-world-id-poh-tiered-recovery-design.md)

## 1. Architecture

```text
Frontend (IDKit creates proof) ──► AgentRegistry.registerAgentVerified / bindPoH
                                      │
                                      ▼
                             WorldIDPoHVerifier.verifyAndConsume
                                      │
                                      ▼
                            official WorldIDRouter.verifyProof (consuming)

New wallet (recovery) ──► AgentRegistry.requestRecovery
                                      │
                                      ▼
                             WorldIDPoHVerifier.verifySameIdentity (non-consuming)
                                      │
                                      ├─ query router for Semaphore verifier + latestRoot()
                                      ├─ require proof.nullifierHash == registration anchor
                                      │  (same action and same device)
                                      └─ require proof.signalHash == H(newWallet), without consumption
```

- Registration and upgrade are **consuming**: the router permits one use per identity per action.
- Recovery is **non-consuming**: only the same device can reproduce the anchored `nullifierHash`. Replays do not execute recovery because the registry independently enforces nonce, expiry, and one-time execution.

### Real adapter versus local test verifiers

- `WorldIDPoHVerifier` is the production-oriented adapter. It calls the official World ID router/Semaphore verification path and must be validated against actual IDKit output on the target chain.
- `AnvilDevPoHVerifier` and `MockPoHVerifier` are local/testing substitutes with deliberately simplified behavior. They exercise registry state transitions but **do not validate a real World ID proof, router address, group root, or IDKit hashing convention**.
- A passing local or CI flow must never be described as a successful Base Sepolia or production World ID integration.

## 2. Official deployment addresses

| Chain/network | WorldIDRouter |
|---|---|
| Base Sepolia (project testnet target; adapter currently undeployed) | `0x379c62556c665f1edd25f2c2a0f76bc70a53b2e4` |
| OP Sepolia | `0xe177f37af0a862a02edfea4f59c02668e9d0aaa4` |
| Base mainnet | Use the official [Address Book](https://docs.world.org/world-id/reference/address-book) |

The adapter queries the Semaphore verifier and group root through router methods `verifierLookupTable(groupId)` and `latestRoot()`; it does not hard-code them.

> ⚠️ Chain distinction: Base Sepolia, OP Sepolia, and Base mainnet use different deployments and environments. Do not reuse an address, `app_id`, action environment, or proof across networks without confirming the official configuration.

## 3. Deploy `WorldIDPoHVerifier`

```bash
forge create contracts/src/WorldIDPoHVerifier.sol:WorldIDPoHVerifier \
  --rpc-url <RPC> \
  --private-key <PK> \
  --constructor-args <router-address> <groupId> "<app_id>" "<action>"
```

Then inject the adapter into the project deployment:

```bash
POH_VERIFIER=<adapter-address> PRIVATE_KEY=<PK> forge script contracts/script/Deploy.s.sol --broadcast
```

- Create `app_id` and `action` in the World Developer Portal; keep staging and production separate.
- **Registration and recovery must use the same action**, such as `agenttrust-identity`, with different signals. Equal `nullifierHash` anchors depend on this.
- Use the official `groupId` for the target network. Staging commonly uses `1`, but the portal and current official documentation are authoritative.
- After deployment, configure the registry with `setPoHVerifier` and verify the resulting on-chain address before exposing the PoH UI.

## 4. Hashing conventions (frontend and adapter must match)

Adapter implementation in Solidity:

```solidity
signalHash        = uint256(keccak256(abi.encodePacked(wallet))) >> 8;
externalNullifier = uint256(keccak256(abi.encodePacked(appId, action))) >> 8;
```

When integrating IDKit, verify that the generated `nullifier_hash` and `external_nullifier` use exactly these conventions. If the selected IDKit version reduces values differently, for example modulo the SNARK field, implement an equivalent TypeScript pre-hash and ensure that the submitted on-chain `nullifier` matches the proof’s public input.

> ⚠️ **Do not enable the PoH path on a production chain until every item in §6 passes.** Local mock success does not validate these hashing assumptions.

## 5. Known limitations and residual risks

1. **One identity per device, not necessarily per human:** World ID identities are device-based. A person with multiple devices may obtain multiple identities, so the on-chain guarantee is “one device, one ID.” Deposits, reputation, and guardians provide secondary defenses.
2. **Orb-only enforcement is unavailable on-chain:** the router proves group membership, including device-level verified identities, but does not expose the verification level. Orb-only onboarding can only be encouraged at the product layer.
3. **Same-identity recovery depends on the device:** the S path works only while the registration device is available. Device loss falls back to the G path with all guardians and a 48-hour veto window.
4. **No PoH anchor means no identity recovery:** a standard registration that loses its key is permanently inaccessible. `bindPoH` is the only remedy and must be completed before key loss.
5. **Router and verifier dependency:** `WorldIDPoHVerifier` depends on official router and Semaphore behavior. Upgrades, group-root availability, or network configuration changes can break verification.
6. **Governance control:** the registry owner can call `setPoHVerifier`; compromise or misuse could replace the trusted verifier. Operational controls and on-chain monitoring remain necessary.
7. **Integration remains unvalidated:** the adapter’s hash convention and real IDKit output have not yet been checked end-to-end on Base Sepolia.

## 6. Required Base Sepolia validation checklist

Base Sepolia is the intended integration testnet, but the adapter is **currently undeployed there**. Complete and record all of the following before treating the integration as live:

1. Create a staging app in the Developer Portal and one action named `agenttrust-identity`.
2. Deploy `WorldIDPoHVerifier` as described in §3, call `setPoHVerifier`, and verify both addresses on Base Sepolia.
3. Generate a registration proof in World App; confirm `registerAgentVerified` succeeds, `usedPoHNullifiers` is set, and `isPoHVerified` returns true.
4. On the same device, generate a recovery proof with `signal = newWallet`; confirm non-consuming `verifySameIdentity` succeeds, the router has no consumption record for recovery, and S-path parameters apply (one guardian and 24-hour veto window).
5. Test from a different device and with an empty/invalid proof; confirm fallback to the G path (all guardians and 48-hour veto window).
6. Integrate `@worldcoin/idkit` in the frontend, with `app_id` and action supplied through environment configuration; keep local and E2E execution on an explicit mock branch.
7. Confirm the §4 hashing conventions against actual IDKit output and proof public inputs.
8. Confirm chain IDs, router address, explorer records, and frontend write readiness all identify Base Sepolia—not Local Anvil (31337), OP Sepolia, or Base mainnet.

## 7. Local development

- On Local Anvil (31337), `Deploy.s.sol` automatically deploys `AnvilDevPoHVerifier`. It accepts any non-empty proof, consumes each nullifier once, and treats same-identity proofs as valid, allowing registration, upgrade, and recovery flows to be demonstrated locally.
- Tests cover both S and G paths by using `MockPoHVerifier.setSameIdentityFailure` to force same-identity verification failure.
- These verifiers are mocks. Never configure their addresses on Base Sepolia, OP Sepolia, Base mainnet, or any production deployment.

---

[← Back to feature walkthrough](feature-walkthrough.md) · [Anti-Sybil analysis](security/anti-sybil-analysis.md) · [Project README](../README.md)
