# Base Sepolia Deployment Guide

**English** | [简体中文](./DEPLOY-BaseSepolia.zh-CN.md)

> **Current status: undeployed.** `deployments/84532.json` has `status: "undeployed"` and zero addresses. This is a preparation and execution guide, not evidence of a live deployment.
>
> The contracts have not received an independent audit and must not be treated as production-ready.

## 1. Deployment model

Base Sepolia uses chain ID **84532**. The deployment has two parts:

1. **Four manifest-tracked core contracts:** `AgentRegistry`, `ReputationHub`, `GuaranteeEscrow`, and `SchellingVoting`. `script/Deploy.s.sol` deploys and wires these contracts, and `deployments/84532.json` tracks them.
2. **One separately deployed and configured adapter:** `WorldIDPoHVerifier`. It is not tracked by the four-contract manifest. Deploy it first, then pass its address as the required `POH_VERIFIER` when running `Deploy.s.sol`.

`AnvilDevPoHVerifier` is local-only test infrastructure. `Deploy.s.sol` creates it automatically only on local Anvil chain `31337` when `POH_VERIFIER` is unset. Never deploy or configure it on Base Sepolia, any public network, or any network carrying value.

The frontend can be exported for GitHub Pages with `NEXT_PUBLIC_CHAIN=base-sepolia`, but it must remain explicitly unavailable/read-only while the manifest status is `undeployed`.

## 2. Prerequisites

- **Node.js >=20.9**.
- Foundry (`forge`, `cast`, and `anvil`).
- A dedicated testnet deployer wallet and its private key.
- Base Sepolia test ETH for gas.
- A Base Sepolia RPC, such as `https://sepolia.base.org`.
- A BaseScan API key if using `--verify` during deployment.
- A World Developer Portal staging `app_id` and a single action, for example `agenttrust-identity`.
- The correct World ID group ID for the selected staging configuration; confirm it against the portal and official documentation.
- All contract tests green. The authoritative baseline is **146 tests passed, 0 failed, 0 skipped across 10 suites**:

```bash
NO_PROXY="127.0.0.1,localhost,::1" forge test --root contracts
```

Useful resources:

- Base Sepolia faucets: `https://faucet.quicknode.com/base/sepolia` and `https://base.org/faucets`
- Base Sepolia explorer: `https://sepolia.basescan.org`
- Base Sepolia WorldIDRouter: `0x379c62556c665f1edd25f2c2a0f76bc70a53b2e4`
- World ID address book: `https://docs.world.org/world-id/reference/address-book`

## 3. Security requirements

- Never commit a private key or include it in chat, logs, screenshots, shell history, or documentation.
- Use a dedicated testnet key; do not reuse a wallet that controls real assets.
- Store the key only in `contracts/.env`, which is ignored by git, or enter it with a non-echoing prompt such as `read -s`.
- Do not use `echo` with a literal private key.
- Confirm that `.env` is ignored before deployment.
- The public Anvil keys and mnemonic in the demo are forbidden on Base Sepolia.

## 4. Deployment procedure

### Step 1: store the deployment key locally

```bash
cd contracts
printf 'PRIVATE_KEY=0x<your-testnet-private-key-without-spaces>\n' > .env
# This command must print .env, confirming that git ignores it.
git check-ignore .env
```

The command above is a template: replace the placeholder locally and never paste the resulting file or key into chat, a commit, or a screenshot. For a non-echoing interactive alternative:

```bash
cd contracts
read -rsp "Base Sepolia private key: " PRIVATE_KEY; printf '\n'
printf 'PRIVATE_KEY=%s\n' "$PRIVATE_KEY" > .env
unset PRIVATE_KEY
git check-ignore .env
```

### Step 2: deploy the real World ID adapter separately

From the repository root, set deployment-specific values locally and deploy `WorldIDPoHVerifier`:

```bash
set -a
. contracts/.env
set +a
export WORLD_ID_ROUTER=0x379c62556c665f1edd25f2c2a0f76bc70a53b2e4
export WORLD_ID_GROUP_ID=<confirmed-group-id>
export WORLD_ID_APP_ID='<staging-app-id>'
export WORLD_ID_ACTION='agenttrust-identity'

forge create contracts/src/WorldIDPoHVerifier.sol:WorldIDPoHVerifier \
  --rpc-url https://sepolia.base.org \
  --private-key "$PRIVATE_KEY" \
  --constructor-args "$WORLD_ID_ROUTER" "$WORLD_ID_GROUP_ID" "$WORLD_ID_APP_ID" "$WORLD_ID_ACTION"
```

Record the deployed adapter address as `POH_VERIFIER`. Registration and recovery must use the same `action`; that shared action is required for the nullifier-hash identity anchor. The adapter still requires a real Base Sepolia/IDKit integration check before the PoH channel can be considered validated.

### Step 3: deploy and configure the four core contracts

```bash
cd contracts
export PATH="$HOME/.foundry/bin:$PATH"
export POH_VERIFIER=<deployed-WorldIDPoHVerifier-address>
NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast --verify \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

`POH_VERIFIER` is required for this public testnet procedure. Do not omit it: on Base Sepolia, an unset value does not deploy the Anvil development verifier; it leaves the PoH channel disabled. If verification credentials are not ready, omit `--verify` and `--etherscan-api-key`, deploy first, and verify later.

`Deploy.s.sol` performs the following wiring:

1. Deploys `AgentRegistry` → `ReputationHub` → `GuaranteeEscrow` → `SchellingVoting`.
2. Grants Escrow and Voting their Hub writer roles.
3. Configures the guarantor exposure cap, obligation oracles, registration deposit, and `AgentRegistry.pohVerifier` using `POH_VERIFIER`.
4. Transfers Escrow ownership to Voting so community rulings can drive escrow settlement.

### Step 4: inspect the broadcast and generate the four-contract manifest

The core-contract broadcast is at `contracts/broadcast/Deploy.s.sol/84532/run-latest.json`. Base Sepolia's chain ID is **84532**, not Base mainnet's 8453. Do not copy an unnamed address list manually; the manifest tool extracts exactly one named `CREATE` for each of the four core contracts.

From the repository root:

```bash
node scripts/deployment-manifest.mjs --write \
  --chain-id 84532 \
  --broadcast contracts/broadcast/Deploy.s.sol/84532/run-latest.json \
  --rpc-url https://sepolia.base.org

# Checks runtime hashes, deployment receipts, Voting parameters, constructor dependencies,
# Hub roles, and Escrow ownership for the four manifest-tracked contracts.
node scripts/deployment-manifest.mjs --check \
  --chain-id 84532 \
  --rpc-url https://sepolia.base.org
```

`--write` and `--check` are compatibility aliases for `generate` and `check`. The write command updates `deployments/84532.json` and regenerates `frontend/lib/deployments.ts`. Do not edit the generated module or hard-code addresses in `frontend/lib/config.ts`.

The manifest intentionally tracks only the four core contracts. Record and review the separately deployed `WorldIDPoHVerifier` address through controlled deployment records, and verify its Registry configuration directly:

```bash
export REGISTRY=<AgentRegistry-address-from-manifest>
cast call "$REGISTRY" "pohVerifier()(address)" --rpc-url https://sepolia.base.org
```

The returned address must equal `POH_VERIFIER`.

### Step 5: build and test the frontend locally

```bash
cd frontend
NEXT_PUBLIC_CHAIN=base-sepolia npm run build
# Interactive check:
NEXT_PUBLIC_CHAIN=base-sepolia npm run dev
```

Connect MetaMask to Base Sepolia and test the minimum registration/guaranteed-trade flow. Also complete the World ID registration and same-identity recovery checks before considering the PoH integration validated.

### Step 6: enable and publish GitHub Pages

The Pages workflow is intentionally restricted to an explicit read-only research preview while chain 84532 is undeployed. After onchain wiring, manifest checks, World ID integration checks, and review are complete, change `.github/workflows/deploy-pages.yml` from the undeployed/read-only gate to the deployed gate, then publish:

```bash
git add deployments/84532.json frontend/lib/deployments.ts .github/workflows/deploy-pages.yml
git commit -m "feat: connect Base Sepolia deployment to frontend"
git push
```

Before that gate is changed, the workflow must not publish a deployed manifest while labeling it as a read-only preview.

### Step 7: verify onchain state

- Confirm verified source for all four core contracts and the separately deployed `WorldIDPoHVerifier`: `https://sepolia.basescan.org/address/<address>`.
- Open `https://<your-username>.github.io/multiagent/`, switch MetaMask to Base Sepolia, and complete at least “register Agent → create guaranteed trade.”
- Spot-check Registry:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
NO_PROXY="127.0.0.1,localhost,::1" cast call "$REGISTRY" "nextAgentId()" --rpc-url https://sepolia.base.org
cast call "$REGISTRY" "pohVerifier()(address)" --rpc-url https://sepolia.base.org
```

## 5. Gas planning

| Item | Rough gas | Notes |
|---|---:|---|
| Four core contracts | ~2.5–3.5M | Registry + Hub + Escrow + Voting |
| Hub roles and core wiring | ~0.1M | Performed by `Deploy.s.sol` |
| `WorldIDPoHVerifier` | Estimate separately | Separate deployment; not included in the four-contract manifest |

Use `forge script --estimate-gas` and actual deployment output as the source of truth. Keep a generous test-ETH buffer; estimates and network fees can change.

## 6. Failure and recovery

| Failure | Response |
|---|---|
| RPC unavailable | Retry or use another reputable Base Sepolia RPC |
| Wrong adapter inputs | Stop; redeploy `WorldIDPoHVerifier` with the confirmed router, group ID, app ID, and shared action |
| `POH_VERIFIER` omitted or wrong | Do not publish; correct the value, redeploy the core contracts if necessary, and verify `pohVerifier()` |
| Wrong core addresses | Regenerate from the named broadcast; let manifest RPC validation reject incorrect wiring |
| Frontend addresses stale | Run manifest `--check`, inspect Actions logs for `NEXT_PUBLIC_CHAIN=base-sepolia`, then clear Pages cache and hard-refresh |
| Insufficient gas | Obtain more faucet ETH, then use `forge script --resume` where safe or redeploy |
| Testnet key exposed | Treat it as compromised, replace it, and repeat the deployment with a new dedicated testnet key |

## 7. Related documentation

- [Contracts README](../README.md)
- [Local full-path demo](./DEMO.md)
- [World ID integration notes](../../docs/world-id-integration.md)
