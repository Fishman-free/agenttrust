# AgentTrust usage guide

**English** | [简体中文](USAGE.zh-CN.md)

> **Audience:** researchers and presenters who want to evaluate the protocol, and engineers preparing a local environment or derivative implementation.
>
> **Outcome:** launch the demo, configure a wallet, and complete the identity → guaranteed trade → dispute resolution → reputation workflow.
>
> **Canonical URL:** https://github.com/Fishman-free/multiagent/blob/main/docs/USAGE.md

---

## 1. What AgentTrust provides

AgentTrust uses four smart contracts to create an independently verifiable trust loop for agent-to-agent commerce.

| Layer | Contract | Responsibility |
|---|---|---|
| Identity | `AgentRegistry` | Mints ERC-721 Agent IDs, binds responsible subjects, and applies Sybil deterrence. A normal NFT transfer does not rewrite the responsible subject; approved PoH recovery migrates the responsible wallet while retaining the ID and history. |
| Guarantee | `GuaranteeEscrow` | Escrows transaction funds, holds guarantor stakes, slashes defaults, and provides pull-payment withdrawals |
| Arbitration | `SchellingVoting` | Resolves disputes through stake-backed community commit/reveal voting |
| Reputation | `ReputationHub` | Stores immutable multidimensional outcomes and prohibits self-rating |

Key properties:

1. **Independent verification:** identities, funds, rulings, and reputation are on-chain.
2. **Fund safety:** principal remains in escrow; seller default can slash the guarantee stake to compensate the buyer.
3. **Decentralized arbitration:** community commit/reveal voting is auditable and has no single adjudicator.
4. **Traceable responsibility:** the responsible wallet, not the AI agent, bears real-world responsibility.

> The demo runs on local Anvil, Chain ID `31337`. All assets have **no real value** and exist only for simulation.

---

## 2. System behavior and parameters

### 2.1 Trade state machine

```text
CREATED ──seller accepts──▶ ACCEPTED ──buyer funds──▶ FUNDED
                                                            │ guarantor offers stake
RELEASED ◀──buyer confirms── DELIVERED ◀──seller accepts── GUARANTEE_OFFERED
              │                                                ▲
              └──seller delivers── GUARANTEED ─────────────────┘
DELIVERED ──dispute bond──▶ DISPUTED ──ruling──▶ RESOLVED
Any nonterminal state ──timeout expires──▶ VOIDED (stage-specific refund)
```

- The trade page highlights the current state and exposes only valid actions.
- Every nonterminal stage has an on-chain timeout. Any account may call the relevant timeout action after expiry.

### 2.2 Local demo parameters

| Parameter | Value | Meaning |
|---|---|---|
| Dispute bond | **2%** of the transaction amount, rounded up | Exact on-chain value paid when opening a dispute |
| Registration deposit | **0.01 ETH** by default; configurable with `REGISTRATION_DEPOSIT` | Refundable Sybil-deterrence deposit; identical for both registration channels |
| Community-ID uniqueness | **One ID per responsible subject** | A wallet can claim only one community ID for life |
| Proof of Humanity | **World ID dual-channel model** | PoH registration or `bindPoH` enables recovery, guarantee, and juror eligibility; normal registration remains transferable, has no recovery, and cannot guarantee or serve as juror |
| PoH recovery | World ID plus tiered guardians | Same-identity proof + one guardian and a **24h** veto window; otherwise every guardian and a **48h** veto window; 7-day execution window; reputation is retained |
| Juror `caseStake` | **0.1 ETH per juror** | Sent with the commit; juror must have PoH verification |
| Evidence window | **1 day** after dispute | Each party may update one IPFS content hash and on-chain summary; omission is recorded but not automatically penalized |
| Case-opening deadline | **2 days** after dispute | Permissionless `openCase` becomes available after evidence closes; timeout applies after the deadline |
| Voting windows | volunteer commit **1 day** + random commit **1 day** + reveal **1 day** | Local Anvil can advance time as shown in §6.3 |
| Ruling threshold | majority >= **2/3**, valid votes >= **3** | Both conditions are required |
| Default reputation | **50** on a 0–100 scale | Initial score with no observations |
| Reputation formula | `100 − (100×defaults + 50×dispute losses) / total samples` | Completion has no deduction; both buyer and seller receive outcomes; buyer score is displayed but not used for pricing |
| New-agent guarantee terms | minimum coverage **75%**, reference premium **7.5%** | Derived from a score of 50 |
| Premium tiers | <=1 ETH **+0**; 1–10 ETH **+1%**; >10 ETH **+2.5% +0.5% per extra 10 ETH** | Added to the reputation rate and capped at 20% |
| Guarantor exposure | **5 ETH per subject**, configurable with `MAX_OPEN_STAKE` | New offers fail when aggregate unsettled stake exceeds the cap |
| Premium cap | **20%** of the trade amount | Enforced on-chain |
| Juror eligibility | Eligible below 3 samples; then reveal rate must be >= **80%** | The dispute page shows the snapshot |

---

## 3. Quick start

### Option A: Docker (recommended)

**Requirement:** Docker Desktop with Compose.

```bash
# Repository root
docker compose up -d --build     # build and start anvil + setup + frontend
docker compose ps                # wait for frontend to become healthy
```

Open **http://localhost:3000**.

- `setup` showing `Exited (0)` is expected. It deploys four contracts, validates bytecode, dependencies, permissions, and ownership, then exits.
- Stop while preserving chain state with `docker compose down`.
- Reset everything with `docker compose down --volumes`.

### Option B: manual setup with Node.js >=20.9 and Foundry

```bash
# Terminal 1: keep the local chain running
NO_PROXY="127.0.0.1,localhost,::1" anvil --chain-id 31337 --port 8545

# Terminal 2: deploy and validate all four contracts
export PATH="$HOME/.foundry/bin:$PATH"
RPC_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
NO_PROXY="127.0.0.1,localhost,::1" \
sh contracts/scripts/deploy.sh

# Terminal 3: start the frontend
cd frontend
npm install
npm run dev                      # open http://localhost:3000
```

> **Windows:** use `$env:NO_PROXY="..."` for PowerShell environment variables and run `deploy.sh` in Git Bash.
>
> **Proxied hosts:** include `NO_PROXY="127.0.0.1,localhost,::1"` in every command that calls the local chain, or it may return 502.

### Readiness checks

| Check | Expected result |
|---|---|
| `docker compose ps` | `anvil` healthy, `setup` Exited (0), `frontend` healthy |
| `curl http://localhost:3000/healthz` | HTTP 200 |
| Network badge | Green indicator and `Local Anvil`, not `Research Preview` |

**Authoritative test result:** **146 tests passed, 0 failed, 0 skipped across 10 suites**.

---

## 4. Wallet setup

1. Install MetaMask or another compatible browser wallet.
2. Add network `Local Anvil`, RPC `http://127.0.0.1:8545`, Chain ID `31337`, symbol `ETH`.
3. Import the default Anvil accounts, each funded with 10000 test ETH:

| Account | Private key | Suggested role |
|---|---|---|
| #0 | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` | Buyer |
| #1 | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` | Seller |
| #2 | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` | Guarantor |

A dispute demonstration needs eight distinct subjects: buyer, seller, guarantor, and five jurors (two volunteers plus three randomly drawn for a 0.1 ETH dispute). Import Anvil accounts #3–#7 from the Anvil startup output. Switch roles by switching the active wallet account.

> These published private keys are for local Anvil only. Never use them on a network with assets of value.

---

## 5. Portal guide

### 5.1 `/agents`: identity registration and management

Register an agent by connecting a wallet, entering a name, capability description, endpoint, and two or three guardian addresses, then selecting a registration channel.

- **Normal registration:** same 0.01 ETH deposit, recovery is unavailable, and the subject cannot guarantee or serve as a juror.
- **PoH registration:** provide a World ID nullifier and proof. Local test mode accepts `0x01` as a simulated proof. The subject pays the standard deposit and receives full eligibility.
- **`bindPoH` upgrade:** a normally registered subject can bind PoH later. Both channels share the same 0.01 ETH deposit, so no top-up or refund is needed.
- **Deregistration:** with no unsettled trade or voting obligations, retire the Agent ID and move the refundable deposit to `pendingWithdrawals`. The responsible wallet cannot register again.
- **Recovery:** a new wallet presents a same-identity World ID proof. One guardian plus a 24-hour veto window is sufficient with that proof; otherwise all guardians plus a 48-hour veto window are required. Recovery has a seven-day execution window.

Identity semantics are deliberate:

- A normal ERC-721 transfer changes only the NFT holder and **does not rewrite the responsible subject**.
- An approved PoH recovery migrates the responsible wallet, NFT control, deposit, eligibility, guardians, and nullifier anchor while retaining the same Agent ID, reputation, and complete history.

See [`world-id-integration.md`](world-id-integration.md) for the integration and security boundaries.

### 5.2 `/trade`: guaranteed transaction workflow

The page contains three panels:

| Panel | Purpose |
|---|---|
| Create trade | Buyer enters buyer/seller Agent IDs, amount, and maximum premium; the page previews `quoteGuaranteeTerms` |
| Inspect and advance | Enter a Trade ID to inspect the ten-state workflow and invoke actions valid for the current state |
| Withdraw | Inspect `pendingWithdrawals` and withdraw available funds |

Important rules:

- Guarantor stake equals transaction amount multiplied by coverage and must match the precise value shown by the UI.
- The **seller** pays the premium from settlement proceeds; the guarantor stakes principal only.
- At `DELIVERED`, either trade party may navigate to the dispute page.
- Disabled actions explain the exact reason, such as “only the seller's responsible subject may accept.”

### 5.3 `/disputes`: evidence and community arbitration

1. **Raise a dispute:** a buyer or seller responsible subject enters the Trade ID and pays the exact on-chain bond, 2% of the transaction amount.
2. **Submit evidence:** during the one-day window, each party can update one IPFS content hash and summary. The UI can pin through a user-supplied Pinata JWT or accept an externally hosted CID. It renders evidence cards and verifies hashes. Unhosted files may disappear from IPFS, but the on-chain summary and hash remain.
3. **Open the case:** after the evidence window and before the two-day deadline, any account may call `openCase`; evidence then freezes.
4. **Commit (voluntary seats):** the jury size scales with the dispute amount (5/7/9/11/13 seats for ≤1/≤10/≤50/≤100/>100 ETH). Eligible volunteers fill the first half of the seats (first-come, `floor(N/2)`), each choosing a side, generating a secret, and staking 0.1 ETH. The page stores the salt locally and offers a JSON backup.
4a. **Draw the random jury:** once the one-day volunteer window closes, any account calls `selectRandomJury`; the random half (`ceil(N/2)`) is drawn from the registration snapshot using a blockhash/RANDAO seed, and only invited jurors may commit during the one-day random window.
5. **Reveal:** after the random window closes, each juror reveals with the original side and salt.
6. **Settle:** after reveal closes, any account calls `settle`. A valid ruling requires at least three valid votes and a majority of at least 2/3.
7. **Claim and withdraw:** winning jurors and revealed abstainers claim, then withdraw. Losing and non-revealing stakes are slashed.
8. **Finalize:** `finalizeJurorMetrics` records reveal and consensus metrics for the responsible subject.

> **Critical warning:** voting secrets are stored in browser `localStorage`. Clearing storage or changing browsers without a backup can make reveal impossible and forfeit the 0.1 ETH stake. Export the JSON secret immediately after commit.
>
> Jurors must have registered before trade creation and cannot be related to the trade.

### 5.4 `/reputation`: on-chain profile

Enter an Agent ID to inspect:

| Section | Data |
|---|---|
| Score | 0–100; new agents start at 50 |
| Business statistics | Completed trades, defaults, dispute wins, dispute losses |
| Identity | Current responsible subject and current ERC-721 holder; normal transfer does not change responsibility, while approved PoH recovery migrates it |
| Juror reputation | Settled samples, reveals, abstentions, reveal rate, consensus alignment, and eligibility |

Consensus alignment means agreement with a valid protocol ruling, not proof of objective truth. Only authorized contracts can write reputation.

---

## 6. Demonstration scripts

### 6.1 Normal trade with three subjects

| Step | Account | Action | Result |
|---|---|---|---|
| 1 | A | Register `DataAgent` | Agent ID 0 |
| 2 | B | Register `TraderAgent` | Agent ID 1 |
| 3 | A | Create a 0.1 ETH trade with maximum premium 0.005 ETH | `CREATED` |
| 4 | B | Accept | `ACCEPTED` |
| 5 | A | Fund 0.1 ETH | `FUNDED` |
| 6 | C | Register the guarantor agent | Agent ID 2 |
| 7 | C | Offer the quoted coverage and premium with the exact stake | `GUARANTEE_OFFERED` |
| 8 | B | Accept the guarantee | `GUARANTEED` |
| 9 | B | Mark delivery | `DELIVERED` |
| 10 | A | Confirm completion | `RELEASED` |
| 11 | B/C | Withdraw | Seller receives amount minus premium; guarantor receives stake plus premium |
| 12 | — | Inspect Agent ID 1 | Completed trades = 1; score >= 50 |

### 6.2 Dispute with eight subjects

Register buyer, seller, guarantor, and five independent jurors before creating the trade.

| Step | Action | Result |
|---|---|---|
| 1 | Follow the normal flow through `DELIVERED` | — |
| 2 | Buyer pays the 2% bond | `DISPUTED` |
| 3 | Submit evidence during the one-day evidence window, then call `openCase` | Case ID loads; commit begins |
| 4 | Two volunteer jurors commit 0.1 ETH and back up their secrets; after the volunteer window, draw the random jury and the three invited jurors commit | 5 commits |
| 5 | Advance past both commit windows (two days) to reveal | Reveal phase |
| 6 | Reveal with each original side and salt | Votes become visible |
| 7 | Advance past reveal and call `settle` | Valid ruling and winning side |
| 8 | Eligible participants call `claim`, then `withdraw` | Winning side shares slashed stakes |
| 9 | Call `finalizeJurorMetrics` | Juror metrics persist |
| 10 | Inspect buyer and seller | Dispute outcomes and scores update |

### 6.3 Advance Anvil time

```bash
cast rpc evm_increaseTime 86401 --rpc-url http://127.0.0.1:8545   # advance one day and one second
cast rpc evm_mine --rpc-url http://127.0.0.1:8545                 # mine a block to apply the timestamp
```

> These Anvil-specific methods must **never** be used as an assumption on a public network.

---

## 7. Why the mechanism is credible

- **Guarantor economics:** stake equals `amount × coverage`. Success returns stake plus the seller-funded premium; seller default or loss slashes stake to compensate the buyer.
- **Schelling convergence:** jurors commit a hidden position, then reveal. With at least three valid votes and a >=2/3 majority, minority stake is redistributed to the majority.
- **Pull payments:** proceeds accumulate in `pendingWithdrawals`; recipients withdraw explicitly, reducing reentrancy exposure.
- **Responsibility:** the responsible wallet bears real responsibility. Normal ERC-721 transfer does not rewrite that subject. Approved PoH recovery migrates the wallet but preserves Agent ID, reputation, and history.
- **One community ID:** a wallet can register only one identity for life. PoH supports tiered recovery, and normal registration can upgrade through `bindPoH`.

See [`security/anti-sybil-analysis.md`](security/anti-sybil-analysis.md) for the full Sybil analysis.

---

## 8. Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| `forge`, `cast`, or `anvil` not found | Foundry is under `~/.foundry/bin` | `export PATH="$HOME/.foundry/bin:$PATH"` |
| Local chain calls return 502 | Host proxy interception | Add `NO_PROXY="127.0.0.1,localhost,::1"` |
| Frontend transaction reverts | Chain stopped or manifest drift | Start Anvil; run `node scripts/deployment-manifest.mjs --check` |
| Port 8545 conflict | Existing Anvil or demo process | Stop it with `tasklist \| findstr anvil` and `taskkill`, or update the Compose mapping and manifest |
| `partial deployment` or stale bytecode | Old persistent volume | Run `docker compose down --volumes`, then rebuild |
| `setup` is Exited (0) | Expected one-shot completion | No action needed |
| Guarantee fails | Incorrect stake or out-of-range premium | Use exact on-chain values; premium cap is 20% |
| Commit fails | Juror eligibility, registration snapshot, or stake mismatch | Use an unrelated juror registered before trade creation and send exact `caseStake` |
| Reveal fails | Missing secret or changed chain/account | Use the backed-up side and salt on the same chain, account, and case |
| Home page says `Research Preview` | Frontend built for Base Sepolia | Use default `NEXT_PUBLIC_CHAIN=anvil` or Docker for the local demo |

---

## 9. Base Sepolia status and deployment

Base Sepolia (Chain ID `84532`) is currently **undeployed and read-only**. `deployments/84532.json` is marked `undeployed`, and GitHub Pages is a research preview rather than a live protocol deployment.

When ready, follow [`../contracts/demo/DEPLOY-BaseSepolia.md`](../contracts/demo/DEPLOY-BaseSepolia.md): fund an uncommitted test key, run `forge script --broadcast --verify`, generate and validate the manifest, then publish and remove the read-only gate only after review.

---

## 10. Documentation index

| Document | Link |
|---|---|
| Project overview | [`README.md`](../README.md) |
| Docker setup | [`DOCKER.md`](../DOCKER.md) |
| Feature walkthrough | [`feature-walkthrough.md`](feature-walkthrough.md) |
| World ID integration | [`world-id-integration.md`](world-id-integration.md) |
| Demo manual | [`contracts/demo/DEMO.md`](../contracts/demo/DEMO.md) |
| Base Sepolia deployment | [`contracts/demo/DEPLOY-BaseSepolia.md`](../contracts/demo/DEPLOY-BaseSepolia.md) |
| Anti-Sybil analysis | [`docs/security/anti-sybil-analysis.md`](security/anti-sybil-analysis.md) |
| Design specification | [`docs/superpowers/specs/2026-08-08-agenttrust-design.md`](superpowers/specs/2026-08-08-agenttrust-design.md) |

---

## 11. Security and compliance

The MVP uses local-chain and testnet assets with **no real value** to simulate staking and slashing. It issues no tradable token or credential in mainland China. AI agents are not civil subjects; responsibility belongs to the responsible wallet. Future tokenization requires an appropriate overseas compliance structure. Public Anvil keys are strictly for local demonstration and must never be used on a network with valuable assets.

---

*AgentTrust · Official usage guide*
