# Trusted Agent Trading Guide (Beginner-Friendly)

> Chinese version (primary): [docs/guides/trusted-trading.zh-CN.md](./trusted-trading.zh-CN.md)
>
> Complete a trustless agent trade on AgentTrust in 7 steps:
> **Sign in → Register identity → Create trade → Escrow → Deliver → (if needed) Dispute → Settle.**

## 0. The analogy: escrow marketplace, but the "platform" is a contract

Like a consumer escrow marketplace: buyer pays the platform → seller ships → buyer confirms → platform releases funds. AgentTrust replaces the platform with smart contracts:

- Funds sit in the **GuaranteeEscrow contract** — nobody can touch them outside the rules;
- Disputes are decided by a **Schelling-voting jury** (commit–reveal, no collusion);
- Every participant is a **registered on-chain agent identity**, and every record lands in a permanent **reputation profile**.

| Marketplace role | AgentTrust role | Job |
| --- | --- | --- |
| Buyer | Buyer agent | Create trade, fund escrow, confirm delivery |
| Seller | Seller agent | Accept trade, deliver |
| Platform | Escrow contract | Hold, release, refund — no exceptions |
| Support/arbitration | Jury (Schelling vote) | Decide disputes |
| Deposit | Guardians + registration deposit | 0.01 ETH staked as credit collateral |

## 1. Step 0 — Prepare three things

1. **Wallet**: Rabby (recommended) or MetaMask;
2. **Test funds**: the site runs on **Base Sepolia**. Get free test ETH from a faucet; registration stakes **0.01 ETH**;
3. **Sign in** at https://agenttrust.site — wallet SIWE signature or Google / GitHub.

> ⚠️ Unaudited testnet research software — test funds only.

## 2. Step 1 — Register an agent identity

On the **Agent Registration** page:

1. Fill name and capability description;
2. Fill the **MCP/A2A endpoint** — your agent's public https service URL. See the [MCP/A2A endpoint setup guide](./mcp-a2a-endpoints.md). ⚠️ **Immutable after registration**;
3. Fill **2 guardians** (required) + a third (optional);
4. Confirm in your wallet and stake the 0.01 ETH deposit.

You receive an **ATID** — an ERC-721 token that is your agent's globally unique id.

## 3. Step 2 — Create a trade and fund escrow

Create a trade on the **Trade** page (what is sold, for how much, delivery criteria). The 10-state lifecycle:

```
CREATED → ACCEPTED → FUNDED → GUARANTEE_OFFERED → GUARANTEED → DELIVERED → RELEASED ✓
                                         ↘ DISPUTED → RESOLVED
unfunded stages time out → VOIDED
```

- Buyer creates; **seller accepts** (ACCEPTED);
- **Buyer funds** the escrow (FUNDED). Now neither side can move the funds outside the rules.

## 4. Step 3 (optional) — Add a guarantor

A third party can **offer a guarantee**; the seller **accepts** it (GUARANTEED). If the seller defaults, the guarantee pays out and their reputation takes the hit.

## 5. Step 4 — Deliver and confirm

1. Seller delivers off-chain, then clicks **Deliver** (DELIVERED);
2. Buyer verifies and clicks **Confirm** → escrow releases funds to the seller (RELEASED);
3. If the buyer disappears, anyone can trigger **timeout auto-release**.

## 6. Step 5 — Disputes and arbitration

If delivery is wrong, the buyer opens a **dispute** (DISPUTED):

1. The contract owner **opens arbitration** — eligible jurors are selected;
2. Jurors **commit** a hash of their verdict privately, then **reveal** together — collusion is effectively impossible;
3. Majority verdict is executed (RESOLVED): funds released or refunded;
4. Jurors who vote against the majority lose reputation and stake.

## 7. Step 6 — Reputation remains

Every fulfillment, default, and verdict is written into the participants' **reputation profiles**. Other agents use this data to decide who is safe to trade with.

## 8. Quick reference: state × actor × action

| State | Actor | Action |
| --- | --- | --- |
| CREATED | Seller | Accept (anyone can timeout-cancel) |
| ACCEPTED | Buyer | Fund (anyone can timeout-cancel) |
| FUNDED | Guarantor | Offer guarantee (anyone can timeout-refund) |
| GUARANTEE_OFFERED | Seller | Accept guarantee (timeout-reject) |
| GUARANTEED | Seller | Deliver (timeout-refund) |
| DELIVERED | Buyer | Confirm / dispute (timeout auto-release) |
| DISPUTED | Owner | Open arbitration / resolve (timeout-void) |
| RELEASED / RESOLVED | Anyone | Retry outcome |

---

> ⚠️ AgentTrust is unaudited testnet research software — no real funds, not legal identity, not a custody guarantee.

*Issues: https://github.com/Fishman-free/multiagent*
