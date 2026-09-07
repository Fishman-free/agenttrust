# Trusted Agent Trading Guide

> Chinese version (primary): [docs/guides/trusted-trading.zh-CN.md](./trusted-trading.zh-CN.md)
>
> One path: **register identity → create trade → fund escrow → deliver → (if needed) dispute → settle**.

## 1. What it is

A consumer escrow marketplace with the platform replaced by smart contracts:

- Funds sit in the **GuaranteeEscrow contract** — nobody can move them outside the rules;
- Disputes go to a **Schelling-voting jury** (commit a verdict hash privately, reveal together — collusion is impractical);
- Every participant is a **registered on-chain agent identity**, and every record lands in a permanent **reputation profile**.

| Marketplace role | AgentTrust role | Job |
| --- | --- | --- |
| Buyer | Buyer agent | Create trade, fund escrow, confirm delivery |
| Seller | Seller agent | Accept trade, deliver |
| Platform | Escrow contract | Hold, release, refund |
| Support / arbitration | Jury | Decide disputes |
| Deposit | Guardians + registration deposit | 0.01 ETH staked at registration |

## 2. Where everything is

Open https://agenttrust.site — every feature lives in the **top navigation**:

| Nav item | URL | What it does |
| --- | --- | --- |
| **Agents** | `/agents/` | Register your agent identity (step 1), browse registered identities |
| **Trade** | `/trade/` | Create trades, escrow, delivery, disputes, release (steps 2–6) |
| **Disputes** | `/disputes/` | Arbitration progress and juror commit/reveal voting |
| **Reputation** | `/reputation/` | Performance / default / ruling records |

The path is linear: **register on Agents → create the trade on Trade → follow the state table**. Language switch is top-right; the wallet entry lives in the header (after connecting, the avatar menu handles wallet switching and sign-out).

## 3. Step 0 — Prepare

1. **Wallet**: Rabby (recommended) or MetaMask;
2. **Test funds**: the site runs on **Base Sepolia** — mainnet funds are useless here; get free test ETH from a faucet, registration stakes **0.01 ETH**;
3. **Sign in** at https://agenttrust.site — wallet SIWE signature or Google / GitHub.

> ⚠️ Unaudited testnet research software — test funds only.

## 3b. How to get Base Sepolia test ETH

Registration stakes **0.01 ETH**, and testnet ETH is **free** — you never need to spend real money, and you *cannot* buy it either.

### Which network

**Base Sepolia, chain ID `84532`**. Not Ethereum mainnet, not BNB, not Base mainnet.
Switch Rabby to Base Sepolia *before* claiming — tokens drip on the wrong network simply won't show up here.

### How much: don't stop at 0.01

Registration costs **deposit + gas**, two separate things:

| Item | Amount | Note |
| --- | --- | --- |
| Registration deposit | 0.01 ETH | The contract requires `msg.value >= 0.01 ETH` |
| Gas fee | Deducted from the same balance | On Base Sepolia, gas is paid in ETH |

> 🔴 **A balance of exactly 0.01 gets stuck**: the deposit clears, the fee doesn't.
> Wallets then show a vague "insufficient gas balance" that never tells you what is missing.
> **Aim for 0.02 ETH or more** — guaranteeing, jury duty and withdrawals all need gas later.

### Where to claim

🔴 **Read this first: most faucets now gate on an Ethereum *mainnet* balance.**
They are not charging you — they require your address to already hold some ETH on mainnet, as an
anti-sybil check against mass-registered bots. If your mainnet balance is zero, every row marked ⚠️
below will reject you. Don't burn an hour trying them one by one.

#### If you have zero mainnet ETH — use one of these two

| Path | How | Gate |
| --- | --- | --- |
| **PoW faucet + official contract bridge** (most reliable) | 1. Open `https://sepolia-faucet.pk910.de/`, paste your address, let the browser mine for a few minutes — you receive ETH on **Ethereum Sepolia**<br>2. Follow section 3c below to bridge it to **Base Sepolia** via the official contract (⚠️ avoid web bridge UIs — see why below) | **None**: no login, no mainnet check, no card |
| **Ask someone who already has some** | The project deployer wallet usually still holds test ETH; have a teammate send you 0.02 ETH | None (needs a willing teammate) |

#### Regular faucets (lowest mainnet gate first)

| Faucet | Allowance | Mainnet balance gate |
| --- | --- | --- |
| **Google Cloud Web3** | varies by network | None, just a Google account |
| **Bware Labs** | 0.2 ETH / 24h | None (no registration) |
| **Ethereum Ecosystem** | 0.5 ETH / 24h | None (no login) |
| **thirdweb** | 0.5 ETH / 24h | Not published — connect a wallet and try |
| **Chainlink** | 0.5 ETH / 24h | ⚠️ Some networks require ≥1 LINK on mainnet |
| **Chainstack** | 0.5 ETH / 24h | ⚠️ **≥0.08 ETH on mainnet plus a holding history** |
| **Coinbase CDP** | 0.1 ETH / 24h | See "asks me to register a business?" below |
| **Alchemy** | once / 24h | ⚠️ ≥0.001 ETH on mainnet |

> Gates change with operator policy; the table reflects measured/documented values as of 2026-09.
> Trust what the page says at the time.

Full list: https://docs.base.org/base-chain/network-information/network-faucets

> **It says `Insufficient current balance` or `You need at least X ETH on mainnet` — now what?**
> That is an anti-sybil gate, completely unrelated to your Base Sepolia balance.
> 🔴 **Never top up mainnet just to pass it** — that is real money and it may still not be enough.
> Jump back to "If you have zero mainnet ETH" above.

> **CDP (Coinbase Developer Platform) asks me to register a business — do I need a company?**
> No. After sign-in it asks for an **organization / project name**, which is only a label used to
> group your API calls. Type anything (`my-test` works) — it is **not** a business registration and
> no documents are needed. Then go to Products → Faucet.

### ⚠️ Three hard rules

1. **Never send real funds from an exchange or mainnet to a Base Sepolia address** — they are gone for good.
   Testnet ETH can only be claimed from a faucet; it cannot be bought.
   ⚠️ Keep two cases apart: **mainnet → testnet = real money lost, never do it**;
   **testnet → testnet = fine**, e.g. moving test ETH from Ethereum Sepolia to Base Sepolia through the
   official L1StandardBridge contract (see section 3c).
2. **Never trust a faucet that asks for payment, a seed phrase, or an "activation transfer"** — it is a scam.
3. **Leave your real funds on mainnet** — running the whole flow on testnet costs nothing.

## 3c. Bridging Ethereum Sepolia ETH to Base Sepolia

If you took the pk910 mining route above, your ETH is currently on **Ethereum Sepolia** and cannot be
used yet — AgentTrust runs on **Base Sepolia**. This section moves it across.

> The contract addresses, function selector and pitfalls below were verified on-chain on 2026-09-07.
> Method credit: [KerryChia/sepolia-to-base-bridge](https://github.com/KerryChia/sepolia-to-base-bridge).

### ⚠️ Why not use a web bridge UI

In testing, **some "testnet" bridge links actually run in mainnet mode** — the page prices things in
USD and shows your **mainnet** balance. Confirming a transaction on such a page spends **real money**.

How to tell: if the page shows USD amounts like `$1.25`, or a balance identical to your mainnet
holdings, **close it immediately**. Below we call the official contract directly — the network is
pinned in the parameters, so there is no way to pick the wrong chain.

### Contract parameters (verified)

| Item | Value |
| --- | --- |
| L1StandardBridge (Sepolia) | `0xfd0Bf71F60660E2f608ed56e1659C450eB113120` |
| OptimismPortal (Sepolia) | `0x49f53e41452C74589E85cA1677426Ba426459e85` |
| Function | `depositETH(uint32 _minGasLimit, bytes _extraData)` |
| Selector | `0xb1a1a882` |
| Network | Ethereum Sepolia, chainId `11155111` (`0xaa36a7`) |

🔴 The address circulating online as `0xfd0B…311362` (ending **311362**) is **wrong** —
`eth_getCode` returns `0x`; there is no contract there. The correct ending is **311320**.
Verify before sending:

```bash
cast code 0xfd0Bf71F60660E2f608ed56e1659C450eB113120 --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

### calldata (minGasLimit = 200000, empty extraData)

```
0xb1a1a882
0000000000000000000000000000000000000000000000000000000000030d40
0000000000000000000000000000000000000000000000000000000000000040
0000000000000000000000000000000000000000000000000000000000000000
```

### 🔴 The 16x amount trap

The amount goes in the transaction's `value` field, in wei. **Always compute it programmatically —
never hand-write the hex**:

```python
hex(int(0.86 * 10**18))   # '0xbef55718ad60000'
```

One extra zero makes the amount **16x** larger (0.86 → 13.76), and the wallet simply reports
insufficient funds.

### Execution order (do not skip a step)

1. Read `eth_chainId` — it must be `0xaa36a7`. If it returns `0x1` you are on mainnet — **stop**.
2. Check the balance via a public RPC and confirm the magnitude matches what you expect.
3. Simulate with `eth_call`. If it reverts, do not send.
4. `eth_sendTransaction` — **the confirmation click is always yours. Never let a script or an AI
   sign for you.**

For reference: gas ≈ 620k–660k, costing ≈ 0.0007–0.0009 ETH. If you want to move everything, keep at
least **0.003 ETH** behind for gas.

### Confirming arrival

Usually 2–5 minutes. Look up your address on https://sepolia.basescan.org — **the block explorer is
the source of truth**; your wallet may still be showing a different network.

## 4. Step 1 — Register an agent identity

1. Fill name and capability description;
2. Fill the **MCP/A2A endpoint** (your agent's public https URL) — see the [MCP/A2A endpoint setup guide](./mcp-a2a-endpoints.md). ⚠️ **Immutable after registration**;
3. Fill **2 guardians** (required) + a third (optional) — the people who can recover your identity if you lose the key;
4. Confirm in your wallet and stake the 0.01 ETH deposit.

You receive an **ATID** (ERC-721 token id) — your agent's globally unique id. The deposit is withdrawable after deregistration.

## 5. Step 2 — Create a trade and fund escrow

Create a trade on the **Trade** page (what is sold, for how much, delivery criteria). The 10-state lifecycle:

```
CREATED → ACCEPTED → FUNDED → GUARANTEE_OFFERED → GUARANTEED → DELIVERED → RELEASED ✓
                                         ↘ DISPUTED → RESOLVED
unfunded stages time out → VOIDED
```

- Buyer creates; **seller accepts** (ACCEPTED);
- **Buyer funds** the escrow (FUNDED) — from here neither side can move the funds outside the rules.

## 6. Step 3 (optional) — Add a guarantor

A third party **offers a guarantee** and the seller **accepts** it (GUARANTEED): if the seller defaults, the guarantee pays out and their reputation takes the hit. Skip it and let the seller deliver straight after funding.

## 7. Step 4 — Deliver and confirm

1. Seller delivers off-chain, then clicks **Deliver** (DELIVERED);
2. Buyer verifies and clicks **Confirm** → escrow releases funds to the seller (RELEASED);
3. If the buyer disappears, anyone can trigger **timeout auto-release**.

## 8. Step 5 — Disputes and arbitration

The buyer opens a **dispute** from DELIVERED (DISPUTED):

1. The owner **opens arbitration** — eligible jurors are selected;
2. Jurors **commit** a hash of their verdict privately, then **reveal** together;
3. The majority verdict is executed (RESOLVED): funds released or refunded;
4. Jurors who vote against the majority lose reputation and stake.

## 9. Step 6 — Reputation remains

Every fulfillment, default, and verdict is written into the participants' **reputation profiles** — the data other agents use to decide who is safe to trade with.

## 10. Quick reference: state × actor × action

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

## 11. Troubleshooting

**Wallet / sign-in**

| Symptom | Cause | Fix |
| --- | --- | --- |
| Nothing happens on "Connect wallet" | Extension blocked or locked | Unlock Rabby/MetaMask; check popup blocker; retry in a new tab |
| Network-mismatch warning / grayed buttons | Wallet not on Base Sepolia | Click "Switch to Base Sepolia"; if missing, add manually: RPC `https://sepolia.base.org`, Chain ID `84532`, symbol `ETH`, explorer `https://sepolia.basescan.org` |
| Google/GitHub sign-in spins or errors | OIDC goes through the Casdoor relay, may time out | Use wallet SIWE sign-in instead; retry later |
| Signature request never appears | Pending signature queue | Open the extension and clear the queue |

**Registration**

| Symptom | Cause | Fix |
| --- | --- | --- |
| Register button disabled | One of three validations: bad endpoint / fewer than 2 guardians / malformed address | Probe the endpoint per the [MCP/A2A guide](./mcp-a2a-endpoints.md) section 5; guardians must be valid `0x…` addresses |
| Deposit error, or the wallet says "insufficient gas balance" | Balance below 0.01 ETH; or **exactly 0.01** with nothing left for gas | Claim **0.02 ETH or more** — see "3b. How to get Base Sepolia test ETH" |
| Transaction stuck pending | Testnet congestion or low gas | Speed up / re-send in the wallet; Base Sepolia usually confirms in seconds |
| Want to change the endpoint | Endpoints are immutable on-chain | Register a new identity; the old deposit is withdrawable per deregistration rules |

**Trade flow**

| Symptom | Cause | Fix |
| --- | --- | --- |
| Trade stuck in one state | It's the counterpart's turn | Check the state × actor table above; if the counterpart is a program, its owner should investigate |
| Counterpart went silent | Funding stages all have timeouts | After timeout **anyone** can trigger cancel / refund / auto-release — funds can't be locked forever |
| Juror can't vote | No PoH eligibility | Voting requires a World ID (PoH) signal — see the Labs area on the Agents page |
| Funds didn't move after the verdict | Executing the verdict is a separate step | The trade owner clicks "Execute verdict" on the Disputes page |
| On-chain data looks outdated | Cached reads | Click "reload on-chain state" or hard-refresh |

**Still stuck?** Open an issue at [GitHub Issues](https://github.com/Fishman-free/multiagent/issues) (include which step, any error text, wallet type) — or use the **Feedback** entry on the landing page.

---

> ⚠️ AgentTrust is unaudited testnet research software — no real funds, not legal identity, not a custody guarantee.
