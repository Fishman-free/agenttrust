# Anti-Sybil Analysis: Limiting an Agent to One Community ID

**English** | [简体中文](anti-sybil-analysis.zh-CN.md)

[← Back to feature walkthrough](../feature-walkthrough.md) · [World ID integration](../world-id-integration.md) · [Project README](../../README.md)

> Question: How can an agent—or its operator—bypass registration and obtain multiple community IDs?
> This document describes the implemented controls, enumerates bypass paths, and records both mitigations and residual risks. It does not claim strict one-human-one-ID enforcement.

---

## 1. Why Community ID uniqueness matters

The AgentTrust Community ID, an ERC-721 Agent ID, is the identity used for trading, guarantees, voting, and reputation. If one entity can obtain multiple IDs, it can:

- **Manipulate juries:** vote through multiple identities and distort Schelling outcomes. The protocol requires a majority of at least 2/3 and at least three valid votes, so Sybil IDs can manufacture or dilute that majority.
- **Farm reputation:** trade among controlled identities to create false COMPLETED and dispute-win records.
- **Avoid slashing:** distribute defaults across low-cost identities and abandon them.
- **Fabricate volume:** create misleading market activity and distort guarantor pricing.

“One human, one ID” is therefore a trust objective, but EVM address uniqueness alone cannot prove it.

---

## 2. Controls before the current mitigation

| Control | Location | Intended effect | Gap |
|---|---|---|---|
| Registration fee / anti-Sybil stake | `AgentRegistry.registrationFee` in the earlier design | Raises registration cost | The demo default was **0**, and payment increases cost without proving uniqueness |
| One vote per address | `hasCommitted[msg.sender]` in `SchellingVoting.commitVote` | Prevents the same address from voting twice | Does not prevent voting from **multiple addresses** |
| Eligibility snapshot | `isRegisteredSubjectAtCount` using `firstAgentIdPlusOne` | Only subjects registered before trade creation may vote | Cannot distinguish one human from many wallets |
| Stable responsible subject outside approved recovery | `responsibleParty` is unchanged by ordinary NFT transfer | NFT transfer does not move legal/accounting responsibility; approved PoH recovery deliberately migrates the responsible wallet | Does not prevent registrations from multiple wallets |

**Critical pre-fix fact:** `registerAgent` had no uniqueness check. The same wallet could mint unlimited Agent IDs, and the old test suite even registered multiple roles from one address.

---

## 3. Bypass paths and mitigations

### Path 1: Repeated registration from one wallet (easy; fixed)
A single private key repeatedly calls `registerAgent`, minting another ID each time.

**Mitigation:** `_registerAgent` now requires `!registeredSubjects[msg.sender]`. `registeredSubjects` is a lifetime tombstone, so one responsible subject can receive only one Community ID, including after deregistration or recovery retirement.

### Path 2: Multi-wallet Sybil identities (fundamental; reduced, not eliminated)
An operator creates N EOAs, contract wallets, or ERC-4337 wallets and registers once from each. The EVM cannot determine that unrelated addresses share an operator.

**Mitigations:**
- The standard PoH registration deposit defaults to **0.01 ETH** through `REGISTRATION_DEPOSIT`; the ordinary path requires `registrationDeposit × 3` (0.03 ETH at the default), raising the cost of disposable identities.
- PoH-verified registration or `bindPoH` consumes a unique human-proof nullifier.
- The two roles with the greatest direct governance/insurance leverage—guarantor and juror—require `isPoHVerified`.

**Residual exposure:** One operator can still create multiple ordinary buyer/seller identities from unrelated wallets. Those identities cannot guarantee or serve as jurors, but can still fabricate bilateral activity unless economic costs, counterparty checks, and off-chain monitoring deter it.

### Path 3: Proof-of-Humanity anchoring (World ID dual path implemented; real integration pending)
A purely on-chain system cannot distinguish one human from many wallets. It can only increase cost. Human uniqueness depends on an external proof system whose result is verified on-chain.

The implemented PoH layer is described in [World ID integration](../world-id-integration.md):
- `WorldIDPoHVerifier` is the real adapter design. Registration and upgrade call official `WorldIDRouter.verifyProof` through the consuming path; recovery uses non-consuming same-identity verification based on matching `nullifierHash` plus a signal bound to the new wallet.
- **Dual-path registration:** the ordinary path uses a 3× deposit, has no recovery anchor, and cannot guarantee or serve as a juror; the PoH path uses the standard deposit and unlocks all roles. This preserves permissionless buyer/seller onboarding.
- `bindPoH` consumes an unused nullifier, creates the anchor, unlocks privileged roles and recovery, and refunds the deposit difference.
- `registerAgentVerified` requires a valid unused nullifier; `usedPoHNullifiers` provides a registry-level replay defense in addition to router consumption.
- `GuaranteeEscrow.guarantee` and `SchellingVoting.commitVote` enforce the PoH role gates.

> ⚠️ `WorldIDPoHVerifier` is not the same as `AnvilDevPoHVerifier` or `MockPoHVerifier`. Local Anvil and CI mocks exercise contract transitions but do not validate actual World ID proofs. The adapter is **not yet deployed or validated on Base Sepolia**, so the real integration remains pending.

### Path 4: Buying or borrowing an ID (reduced by identity semantics)
Because the Agent ID is ERC-721, an attacker can buy or rent an NFT with a strong reputation.

**Current behavior:** Ordinary NFT transfer changes token control but does not change the responsible subject, voting eligibility, or accounting identity. `commitVote` checks the subject snapshot against `msg.sender`, so a buyer cannot use a purchased ID to vote as themselves or redirect its reputation. Approved PoH recovery is the explicit exception: it migrates the responsible wallet while retaining the same Agent ID and reputation history.

**Residual exposure:** Off-chain key sharing or custody arrangements can still let another person act through the registered subject’s wallet. The protocol cannot reliably distinguish authorized use from credential sharing.

### Path 5: Zero-deposit configuration (configuration risk; safer default)
A deployment with a zero deposit makes ordinary identity creation free.

**Mitigation:** `Deploy.s.sol` defaults `REGISTRATION_DEPOSIT` to `0.01 ether`; operators may explicitly override it. Ordinary registration then charges three times the configured deposit.

**Residual exposure:** The owner can configure an ineffective value, and a fixed ETH amount changes in deterrent value with market price.

### Path 6: Just-in-time snapshot registration (allowed participation, not a bug)
A subject may register immediately before trade creation and qualify for that trade’s jury snapshot. This follows the open-participation design. Risk is bounded by registration-time eligibility, exclusion of buyer/seller/guarantor, PoH, and juror stake, but jurors are still not randomly sampled.

---

## 4. Implemented changes and verification

| File | Change |
|---|---|
| `contracts/src/AgentRegistry.sol` | Lifetime one-ID check; PoH dual path; `bindPoH`; tiered recovery with 24h/48h veto windows; `isPoHVerified` |
| `contracts/src/WorldIDPoHVerifier.sol` | World ID adapter with consuming registration/upgrade verification and non-consuming same-identity recovery verification |
| `contracts/src/GuaranteeEscrow.sol`, `contracts/src/SchellingVoting.sol` | PoH gates for guarantors and jurors |
| `contracts/script/Deploy.s.sol` | `REGISTRATION_DEPOSIT` default of `0.01 ether`; `POH_VERIFIER` (`0` disables external PoH configuration; Anvil automatically deploys the development verifier) |
| `contracts/test/mocks/MockPoHVerifier.sol` | Test verifier: non-empty proofs, one-time nullifier consumption, and forced same-identity failure for the G path |
| `contracts/test/AgentRegistry.t.sol` | Dual-path deposits, `bindPoH`, S/G thresholds and windows, role gates, fallback, and replay protection |
| `contracts/test/WorldIDPoHVerifier.t.sol` | Adapter parameter forwarding, non-consuming checks, and rejection paths using fake router/Semaphore verifiers |
| `deployments/31337.json`, `frontend/lib/*.ts` | Regenerated for the registry runtime-bytecode change |

Current verification baseline: `forge test` **146 contract tests passed**; `npm test` 69/69 passed; manifest and ABI `--check` passed.

### Tiered recovery properties

- Ordinary registration: 3× deposit, no recovery, no guarantee/jury access.
- PoH registration: standard deposit, recovery, and privileged-role access. `bindPoH` upgrades an ordinary identity and refunds the difference.
- **S path:** same-device, non-consuming World ID proof → at least one guardian + 24-hour veto window.
- **G path:** missing or failed same-identity proof → all guardians + 48-hour veto window.
- Recovery has a seven-day execution period and migrates NFT control, responsible subject, deposit, eligibility snapshot, guardians, and nullifier anchor without resetting reputation.
- Recovery and deregistration require both escrow `openTradeCount` and voting `openCommitmentCount` to be zero.
- Local Anvil deploys `AnvilDevPoHVerifier` for demos/E2E. A real chain must configure `POH_VERIFIER` with a deployed and validated `WorldIDPoHVerifier`.

---

## 5. Residual risks

1. **World ID uniqueness is device-based:** one human with multiple devices may obtain multiple identities. The practical on-chain property is “one device, one ID,” with deposits, reputation, and guardians as secondary defenses.
2. **The real adapter remains unvalidated:** `WorldIDPoHVerifier` depends on the official router and Semaphore verifier. Its hash convention must be checked against actual IDKit output after obtaining `app_id`. It is **currently undeployed on Base Sepolia**.
3. **Verifier governance:** `setPoHVerifier` is owner-controlled. A compromised or malicious owner can substitute the verifier.
4. **Recovery trust assumptions:** S-path identity assurance requires the original World ID device. G-path security depends on guardian honesty and availability during the 48-hour veto window; guardian collusion can steal an identity.
5. **Unlinked wallets remain opaque:** one entity can create multiple ordinary buyer/seller identities. PoH role gates reduce the highest-impact attack surface but do not eliminate fake trading or reputation farming.
6. **Jurors are not randomly selected:** even with PoH, coordinated participants can target cases and stack votes. Random selection and additional stake weighting remain future work.
7. **Credential sharing and ID rental:** ordinary NFT transfer does not transfer the responsible subject or voting rights, but the chain cannot detect shared private keys or custodial control. Approved recovery remains a separate, guardian-gated identity migration path.
8. **Fixed deposit economics:** the deterrent value of an ETH-denominated deposit fluctuates and must be reviewed by operators.
9. **Off-chain World ID assumptions:** device issuance, official infrastructure availability, group membership, and upstream policy changes remain outside AgentTrust’s control.

---

## 6. Future directions

- Complete the Base Sepolia deployment and end-to-end IDKit validation in the [World ID integration checklist](../world-id-integration.md); do not describe PoH as production-live before it passes.
- Add random juror selection and quadratic/additional staking to raise vote-stacking costs.
- Introduce progressive deposit or vote-stake requirements for low-reputation subjects.
- Add off-chain clustering of suspicious funding sources and registration timing as a frontend warning layer, without treating heuristics as proof of shared identity.

---

[← Back to feature walkthrough](../feature-walkthrough.md) · [World ID integration](../world-id-integration.md) · [Project README](../../README.md)
