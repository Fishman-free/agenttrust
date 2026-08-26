# AgentTrust Full-Path Demo

**English** | [简体中文](./DEMO.zh-CN.md)

> Use this guide only with a disposable local Anvil chain. Never use the published Anvil private keys or mnemonic on a public or valuable network.

## Start everything

Start from clean state. After any contract change, remove the old volume:

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
```

Without Docker, start Anvil, deploy, and run the frontend separately. The frontend requires **Node.js >=20.9**.

```bash
anvil --host 127.0.0.1 --chain-id 31337 --port 8545

RPC_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
sh contracts/scripts/deploy.sh

npm --prefix frontend ci
npm --prefix frontend run dev
```

Deployment addresses come from `deployments/31337.json`. `deploy.sh` validates the four core contracts' bytecode, dependencies, ACLs, and ownership. On local chain `31337`, `Deploy.s.sol` also creates the local-only `AnvilDevPoHVerifier`; it is not manifest-tracked and must never be used publicly. Never use the published Anvil key with a non-31337 chain or a non-local RPC.

## Normal trade

Prepare at least three distinct accountable owners:

1. Register a buyer Agent.
2. Register a seller Agent.
3. Register a guarantor Agent.
4. As buyer, create a trade with `amount` and `maxPremium`.
5. As seller, accept the trade.
6. As buyer, fund the principal in escrow.
7. As guarantor, enter the guarantor Agent ID, `coverage`, and `premium`, then stake the exact onchain `requiredStake`.
8. As seller, accept the guarantee.
9. As seller, deliver.
10. As buyer, confirm delivery.
11. As seller and guarantor, withdraw pull-payment balances.
12. On the reputation page, confirm that the seller's `completed` count increased.

A new Agent starts at reputation 50. Under the current smoothing formula, that corresponds to minimum coverage of 75% and a reference premium rate of 7.5%. The UI reads the quote and exact stake directly from the chain.

## Disputed trade

A valid adjudication requires at least six distinct accountable owners:

- buyer, seller, and guarantor;
- three independent jurors.

All three jurors must register before the trade is created because jury eligibility is snapshotted at trade creation. The buyer, seller, and guarantor cannot vote on their own trade.

Flow:

1. Register all six owners.
2. Advance the trade to `DELIVERED`.
3. As buyer or seller, pay the exact 2% dispute bond read from the chain.
4. Anyone calls permissionless `openCase(tradeId)`.
5. Each juror generates and backs up a salt, then submits a commitment and the fixed case stake.
6. Advance to the reveal phase.
7. Reveal with the original side/salt.
8. After the reveal window closes, call `settle`.
9. Each eligible participant calls `claim`, then `withdraw`.
10. Anyone calls permissionless `finalizeJurorMetrics`.
11. Check Escrow balances, seller business reputation, and juror reveal/consensus metrics.

Clearing browser `localStorage` deletes reveal secrets and can cause a juror's stake to be slashed. Export the secret backup provided by the UI before clearing browser data.

## Automated verification

The authoritative Foundry baseline is **146 tests passed, 0 failed, 0 skipped across 10 suites**.

```bash
forge test --root contracts --match-contract E2ETest -vvv
npm --prefix frontend run e2e
```

The main Playwright gate starts and resets Anvil automatically and covers:

- static deep links and genuine 404s;
- a three-identity normal trade, withdrawals, and reputation;
- a six-identity dispute with commit/reveal, time advancement, settle, claim, withdraw, and juror metrics.

The MetaMask/Synpress smoke test is separate and non-blocking. It only verifies a real extension connection, switching to chain 31337, and local registration. Synpress 4 does not support its cache CLI on native Windows; use Linux/WSL or trigger the GitHub Actions job manually.

```bash
npm --prefix frontend run e2e:metamask:cache
npm --prefix frontend run e2e:metamask
```

Use only the public disposable Anvil mnemonic. Never reuse a real wallet mnemonic.

## Advance chain time locally

Deployment parameters use a one-day commit window followed by a one-day reveal window. Use these methods only with local Anvil:

```bash
cast rpc evm_increaseTime 86401 --rpc-url http://127.0.0.1:8545
cast rpc evm_mine --rpc-url http://127.0.0.1:8545
```

Never call Anvil time-manipulation methods against a public RPC.

## Known limitations

- Jury selection is not random.
- Sybil identities registered before trade creation may still participate.
- “Consensus aligned” only means alignment with the protocol's effective ruling; it does not prove real-world truth.
- Juror metrics depend on permissionless finalization after settlement.
- The Base Sepolia manifest is currently `undeployed`; Pages publishes an explicitly read-only research preview only.
- The contracts have not received an independent audit and must not be treated as production-ready.

For public testnet preparation, use the [Base Sepolia deployment guide](./DEPLOY-BaseSepolia.md).
