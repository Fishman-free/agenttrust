# AgentTrust Feature Walkthrough (Real User Flows × Technical Design)

**English** | [简体中文](feature-walkthrough.zh-CN.md)

[← Back to project README](../README.md) · [World ID integration](world-id-integration.md) · [Anti-Sybil analysis](security/anti-sybil-analysis.md)

> Version: `main` at `6a662cf` (B: dual-path World ID PoH and tiered recovery; A: premium tiers, exposure caps, and buyer accounting; C: evidence submission and juror decision basis; English-first UI and docs — all merged).
> Demo environment: Docker Compose (Anvil 31337 + development PoH verifier + six preconfigured accounts + automatic deployment), frontend at http://localhost:3000.
> Verification baseline: **146 contract tests passed**.
> ⚠️ After upgrading to the new contracts, run `docker compose down --volumes && docker compose up -d --build` once.

---

## Stage 0: Connect and select the network

| User action | UI | Under the hood |
|---|---|---|
| Open http://localhost:3000 and click “Connect wallet” | Header wallet bar | wagmi `useConnect` + EIP-1193 provider; the local demo injects its built-in Anvil provider for account switching and time travel, while production uses MetaMask/World App |
| Confirm the network is Local Anvil (31337) | Wallet bar | `useAccount`/`useBlock`; every write first calls `getWriteReadiness`, and is disabled with an explanation if the wallet is disconnected, on the wrong chain, or missing a contract configuration |

---

## 1. Identity layer: onboarding, upgrade, recovery, and deregistration

### 1.1 Standard registration (low-barrier path)
**User:** Enter a name, capability description, endpoint, and two or three guardians, then click “Register (0.03 ETH refundable deposit).”

**Technical flow:** `AgentRegistry.registerAgent`:
- Locks `registrationDeposit × 3` (0.03 ETH) in `deposits`; any excess is immediately credited to `pendingWithdrawals`.
- Mints an ERC-721 Agent ID; `agentCount` increments, while `registeredAtBlock` and `firstAgentIdPlusOne` preserve eligibility snapshots.
- Enforces **one ID per subject** with the lifetime tombstone `registeredSubjects`; the same wallet cannot register again.
- Creates **no recovery anchor and grants no guarantor/juror access** until PoH is bound (role gates are described in §2.3 and §3.4).

### 1.2 Unverified warning and one-click upgrade (`bindPoH`)
**User:** The UI warns, “Human verification is incomplete: a lost private key cannot be recovered, and this identity cannot guarantee or serve as a juror.” Enter a nullifier and proof (`0x01` in the demo), then click “Bind PoH.”

**Technical flow:** `bindPoH` consumes a **previously unused nullifier** through `verifyAndConsume` (development verifier or World ID adapter), anchors `subjectNullifier` ↔ `nullifierSubject`, **automatically refunds the deposit difference (0.03 → 0.01 ETH)**, and unlocks recovery, guarantees, and jury service. Deregistration and re-registration are unnecessary.

### 1.3 PoH registration (fully enabled from entry)
**User:** Select “Register with World ID human verification,” then enter the nullifier and proof.

**Technical flow:** `registerAgentVerified` requires the standard 0.01 ETH deposit. Deposit validation is mandatory, fixing the previous silent-underflow defect. The nullifier is **consumed once** to prevent replay, and `isPoHVerified(subject)` becomes a hard requirement for guarantors and jurors.

### 1.4 Identity recovery (PoH identities only, tiered)
**Scenario:** A private key is lost. The **new wallet** requests recovery; guardians approve it in the “Recovery and guardians” card; the original wallet may veto during the veto window; after the window expires, recovery can be executed.

**Technical flow:** `requestRecovery(nullifier, proof, newWallet)` automatically selects a tier:
- **S path:** a same-identity proof succeeds through non-consuming `verifySameIdentity` (matching the anchored `nullifierHash`, with the signal bound to the new wallet) → at least **one guardian** + **24-hour** veto window.
- **G path:** the proof is absent or fails, including when the identity device is lost → **all guardians** (2/2 or 3/3) + **48-hour** veto window.
- Execution is available for seven days. It migrates NFT control, responsible subject, deposit, eligibility snapshot, guardians, and the nullifier anchor. **Reputation is preserved, no second identity is created, and the old wallet is permanently retired.**
- Recovery and deregistration require **zero unsettled obligations**, enforced through the escrow/voting obligation oracle.

### 1.5 Deregistration (permanent exit)
**User:** Click “Deregister and refund deposit,” then “Withdraw pending balance.”

**Technical flow:** `deregister` verifies that there are no unsettled obligations, active recovery, or transferred Agent ID; burns the Agent ID while leaving the profile readable by ID; credits the full deposit through pull-payment; and retains the lifetime tombstone. `agentCount` does not decrease, preserving snapshot semantics.

---

## 2. Transaction layer: guaranteed-trade lifecycle

### 2.1 Create a trade (the quote fixes pricing)
**User:** On the trade page, enter buyer and seller Agent IDs, amount, and maximum premium, then inspect the `quoteGuaranteeTerms` preview.

**Technical flow:** `createTrade` calls `quoteGuaranteeTerms(sellerId, amount, maxPremium)`:
- Minimum coverage is `coverageBps = 5000 + (100−score)×100/2` (a new seller at 50 points requires **75%**; 100 points requires 50%; zero points requires 100%).
- The reference premium rate is the score-based bps (750 bps = 7.5% for a new seller) **plus a size tier**: ≤1 ETH +0; 1–10 ETH +100 bps; >10 ETH +250 bps. The total rate is capped at 20%.
- `insurable = maxPremium ≥ reference && ≤ 20%`; `referencePremium`, `minCoverage`, and `eligibilityAgentCount` are snapshotted when the trade is created.

### 2.2 Acceptance and escrow funding
**User:** The seller clicks “Accept trade,” then the buyer escrows 0.1 ETH.

**Technical flow:** `acceptTrade`/`fund` move the state machine CREATED → ACCEPTED → FUNDED, each with a one-day window. `openTradeCount` records the buyer at creation and the seller at acceptance. Permissionless `timeoutCancel*` methods advance expired states.

### 2.3 Guarantee quote (multiple checks)
**User:** The guarantor enters a guarantor Agent ID, coverage, and premium; reviews exact `requiredStake` and **remaining guarantee capacity**; then clicks “Provide guarantee and stake 0.075 ETH.”

**Technical flow:** `guarantee` checks, in order:
1. State is FUNDED and still in its window.
2. The guarantor passes the **PoH gate**.
3. Coverage is at least `minCoverage` and no more than 200%.
4. Premium lies in `[referencePremium, maxPremium]`.
5. `stake = amount × coverage`, and `msg.value` is exact.
6. The **exposure cap** holds: `openStakeBySubject[subject] + stake ≤ maxOpenStake` (default 5 ETH; excess is rejected and the frontend shows remaining capacity).

The stake enters `totalLiability`; `openTradeCount` and `openStakeBySubject` are updated.

### 2.4 Delivery and confirmation (release + dual accounting)
**User:** The seller clicks “Confirm delivery,” then the buyer clicks “Confirm completion.”

**Technical flow:** `deliver` → `confirm` → `_release`: the seller receives `amount − premium`, the guarantor receives `stake + premium`, and the buyer’s escrowed `amount` is fully distributed. Both buyer and seller receive a COMPLETED outcome. Idempotent outcome IDs are `keccak(escrow, tradeId)` for the seller and `keccak(escrow, tradeId, 1)` for the buyer. If the hub is unavailable, the result remains pending and `retryOutcome` can record it later.

### 2.5 Withdrawals
**User:** Each account clicks “Withdraw pending balance/all balance.”

**Technical flow:** `withdraw` uses pull-payment, transferring only from `pendingWithdrawals` and updating `totalLiability`. If a recipient contract rejects payment, both the balance and liability remain unchanged.

### 2.6 Permissionless timeout family
`timeoutCancelUnaccepted` (not accepted), `timeoutCancelUnfunded` (not funded; records buyer DEFAULTED), `timeoutRejectGuarantee`/`timeoutRefund` in FUNDED (cancel and refund), `timeoutRefund` in GUARANTEED (seller did not deliver; records seller DEFAULTED and buyer COMPLETED, and uses the full guarantor stake for compensation), and `timeoutAutoRelease` (delivered but not confirmed; automatically releases and records both sides COMPLETED). Every timeout is one day, permissionless, and checked on-chain.

---

## 3. Arbitration layer: disputes, evidence, and jury voting

### 3.1 Open a dispute
**User:** From the trade page, open the dispute page, enter the Trade ID, and click “Pay exact bond and open dispute.”

**Technical flow:** `dispute` requires an exact 2% bond, rounded up and read from the chain; moves the trade to DISPUTED; and adds the bond to `totalLiability`.

### 3.2 Evidence submission (C: one one-day round)
**User:** In “Evidence,” enter a CID and summary, or use “Upload evidence to IPFS” by pasting a personal Pinata JWT and selecting a file. Jurors see both parties’ evidence cards: summary, content hash, CIDv0/CIDv1 gateway links, hash-check action, reputation score, four counters, and recent trades. A party that submitted nothing is marked **“No evidence submitted.”**

**Technical flow:** `submitEvidence(contentHash, summary)` anchors an **IPFS content hash (sha2-256 digest as `bytes32`) and text summary** on-chain. Only the buyer or seller can submit, only while DISPUTED before the case opens, and only during the evidence window. A party may replace its submission within the single round; submission count is tracked. Verification fetches the content from a gateway, recomputes raw-encoded sha2-256, and compares it with the anchor. Unpinned files may disappear from IPFS, but the summary and hash remain on-chain. Failure to submit evidence is not automatically penalized.

### 3.3 Open the arbitration case (C sequencing)
**User:** Anyone clicks `openCase`.

**Technical flow:** `SchellingVoting.openCase` → `escrow.openArbitration` is allowed **after the one-day evidence window ends and for the following two days**. This prevents an early case opening from depriving either party of its full evidence opportunity. Evidence then freezes.

### 3.4 Jury voting (Schelling commit–reveal)
**User:** Three jurors select a side, click “Generate secret and commit” (the UI generates a salt and tells them to back it up), and later use the saved secret to reveal.

**Technical flow:** `commitVote` requires a registration predating the trade snapshot, **PoH**, eligible jury reputation (after at least three samples, reveal rate ≥80%), no buyer/seller/guarantor role in the trade, and a 0.1 ETH stake. Commitment is `keccak256(caseId, subject, side, salt)` to prevent vote following. `revealVote` has a one-day window. `settle` requires a winning side with ≥2/3 of valid votes and at least three valid votes. Non-revealers are slashed; jurors who reveal an abstention are exempt.

### 3.5 Execute the ruling
**Technical flow:** `resolveDispute`, called by the voting contract as escrow owner, distributes funds according to the ruling: the buyer receives refund plus its stake share, the seller keeps the awarded payment, and the guarantor receives remaining stake. The **dispute bond goes to the winner**. Outcomes are recorded for both parties: seller WON/LOST and buyer LOST/WON; a partial ruling records buyer WON. If there is no valid ruling, `voidDispute` refunds everything.

### 3.6 Claims and juror metrics
**User:** Winners and eligible jurors click “Claim,” then “Withdraw”; each juror clicks “Finalize my juror metrics.”

**Technical flow:** `claim` distributes winner rewards and loser slashing; `finalizeJurorMetrics` writes reveal and consensus-alignment rates into the juror profile using an idempotent `recordId`.

---

## 4. Reputation and governance

| Dimension | Rule | Implementation |
|---|---|---|
| Transaction reputation | `100 − (100×defaults + 50×losses)/total samples`; default is 50 with no history | `ReputationHub.reputationScore`; both buyer and seller are recorded, but buyer reputation is display-only and does not affect pricing |
| Juror reputation | Eligible with <3 samples; afterward reveal rate must be ≥80% | `isJurorEligible` + `recordJurorCase` |
| Guarantee pricing | Score-based rate + amount-tier surcharge | §2.1 |
| Exposure | Sum of each guarantor’s unsettled stakes ≤ `maxOpenStake` | §2.3 |
| Governance | Deposit, exposure cap, verifier, and obligation oracle are owner-configurable; **escrow is owned by the voting contract**, so jurors control rulings | Deploy script + `transferOwnership` |
| Reserved slashing | `slashDeposit` exists but no caller is authorized | Registry |

**On-chain invariants** protected by Forge invariant tests: `totalLiability ≤ contract balance`; obligation counts equal unresolved-trade flags; `openStakeBySubject` equals unsettled stakes; and each trade outcome and juror record is written exactly once.

---

## 5. Security boundaries and residual risks

1. **World ID uniqueness is device-based:** one person with multiple devices may obtain multiple identities. The chain guarantees “one device, one ID,” not strict human uniqueness.
2. **S-path recovery depends on the registration device:** if that device is lost, recovery falls back to the guardian-based G path. Standard registrations have no recovery anchor, so the warning reflects a real constraint.
3. **Jurors are not randomly selected:** participation is open, subject to snapshot eligibility, PoH, and stake; security relies on Schelling-point convergence.
4. **Evidence persistence is external:** only the hash and summary are on-chain. Submitters must pin files; the UI offers Pinata upload and warns about persistence.
5. **The real World ID adapter is not the local mock:** local Anvil and CI use development/mock verifiers to exercise flows, not to prove real World ID compatibility. `WorldIDPoHVerifier` exists, but **has not yet been deployed and validated on Base Sepolia**. Keep the production PoH path disabled until the integration checklist in [World ID integration](world-id-integration.md) passes.

---

[← Back to project README](../README.md) · [World ID integration](world-id-integration.md) · [Anti-Sybil analysis](security/anti-sybil-analysis.md)
