# Base Sepolia Deployment Guide

**English** | [简体中文](./DEPLOY-BaseSepolia.zh-CN.md)

> **Current status:** the four core contracts are deployed on Base Sepolia (Chain ID 84532) and have passed RPC-backed manifest validation. Authoritative addresses, bytecode hashes, transactions, blocks, and constructor metadata are in [`../../deployments/84532.json`](../../deployments/84532.json).
>
> https://agenttrust.site is live on Tokyo Caddy with valid HTTPS; `www` redirects to the apex. The GitHub Pages deployment-gate workflow is modified but not merged. The contracts are unaudited, testnet-only, and not production-ready.
>
> World ID app `app_01728cabff1e05950af1ff18c06c9d38` and RP `rp_fd884ac4342cc4d1` are registered. Because Base Sepolia has no v4 direct verifier, same-origin `/api/world-id` uses the official v4 Developer Portal API and server-only trusted-attester keys. `WorldIDV4AttestationVerifier` at `0x1325C3eD12d535Bc33A56305466159d370BDf6cE` is bound to the Registry. PoH registration and guarantor/juror gates are enabled through this backend trust model—not direct onchain World verification. `verifySameIdentity` returns `false`, so recovery requires all guardians plus a 48-hour veto.

## 1. Deployment model

Base Sepolia uses chain ID **84532**. The current deployment consists of four manifest-tracked core contracts: `AgentRegistry`, `ReputationHub`, `GuaranteeEscrow`, and `SchellingVoting`. `script/Deploy.s.sol` deployed and wired them, and [`../../deployments/84532.json`](../../deployments/84532.json) is the only authoritative address source.

World ID is tracked separately from the four-contract manifest. The legacy `WorldIDPoHVerifier` must not be deployed against the deprecated V1/Contracts 3.0 interface. The live v4 integration uses the backend-attestation adapter recorded in [`../../deployments/84532-world-id.json`](../../deployments/84532-world-id.json); it is deployed, bound, and explicitly introduces a trusted server-side attester.

`AnvilDevPoHVerifier` is local-only test infrastructure. `Deploy.s.sol` creates it automatically only on local Anvil chain `31337` when `POH_VERIFIER` is unset. Never deploy or configure it on Base Sepolia, any public network, or any network carrying value.

The frontend can be exported with `NEXT_PUBLIC_CHAIN=base-sepolia`. GitHub Pages remains pending the workflow merge; https://agenttrust.site is live on Tokyo Caddy. PoH registration and guarantor/juror gates are enabled through trusted backend attestation. Neither hosting nor PoH availability makes this unaudited testnet deployment production-ready.

## 2. Prerequisites

- **Node.js >=20.9**.
- Foundry (`forge`, `cast`, and `anvil`).
- A dedicated testnet deployer wallet and its private key.
- Base Sepolia test ETH for gas.
- A Base Sepolia RPC, such as `https://sepolia.base.org`.
- A BaseScan API key if using `--verify` during deployment.
- For future PoH work only: the existing World ID app is `app_01728cabff1e05950af1ff18c06c9d38`; confirm current v4 portal, action, and proof requirements before designing the replacement adapter. Do not reuse legacy V1/Contracts 3.0 assumptions.
- All contract tests green. The authoritative baseline is **159 tests passed, 0 failed, 0 skipped**:

```bash
NO_PROXY="127.0.0.1,localhost,::1" forge test --root contracts
```

Useful resources:

- Base Sepolia faucets: `https://faucet.quicknode.com/base/sepolia` and `https://base.org/faucets`
- Base Sepolia explorer: `https://sepolia.basescan.org`
- World ID documentation: `https://docs.world.org/` — use current v4 documentation; the legacy router/interface previously referenced by this project is deprecated

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

### Step 2: deploy and bind the World ID v4 attestation path

The live integration uses World ID v4 IDKit and the official Developer Portal verification API through the same-origin `/api/world-id` backend. The backend issues short-lived EIP-712 enrollment attestations; `WorldIDV4AttestationVerifier` verifies them on Base Sepolia. Deployment metadata and transaction hashes are recorded in [`../../deployments/84532-world-id.json`](../../deployments/84532-world-id.json).

This is **trusted backend attestation**, not direct onchain World proof verification. The legacy V1 adapter remains prohibited. The live adapter enables verified registration, guarantor, and juror gates. Its `verifySameIdentity` deliberately returns `false`, so recovery always uses all guardians and the 48-hour veto path.

### Step 3: core deployment record (redeploy only when intentionally replacing it)

```bash
cd contracts
export PATH="$HOME/.foundry/bin:$PATH"
# Leave POH_VERIFIER unset until a reviewed v4 adapter exists.
NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast --verify \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

The current four-contract deployment is already recorded and RPC-validated; do not rerun this command unless intentionally replacing it. The attestation adapter is deployed and bound separately. If verification credentials are unavailable during a future intentional redeploy, omit `--verify` and `--etherscan-api-key`, then verify source later.

`Deploy.s.sol` performs the following wiring:

1. Deploys `AgentRegistry` → `ReputationHub` → `GuaranteeEscrow` → `SchellingVoting`.
2. Grants Escrow and Voting their Hub writer roles.
3. Configures the guarantor exposure cap, obligation oracles, and registration deposit. The v4 attestation adapter was deployed and bound separately after the core deployment.
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

The core manifest intentionally tracks only four contracts. The separate World ID manifest records adapter `0x1325C3eD12d535Bc33A56305466159d370BDf6cE`, its trust model, attester, RP/action, and deployment transactions. The Registry binding was directly verified with `pohVerifier()` before enabling the PoH UI.

### Step 5: build and test the frontend locally

```bash
cd frontend
NEXT_PUBLIC_CHAIN=base-sepolia npm run build
# Interactive check:
NEXT_PUBLIC_CHAIN=base-sepolia npm run dev
```

Connect MetaMask to Base Sepolia and verify network/address selection, core reads/writes, and the World ID v4 enrollment flow. Verified registration and guarantor/juror gates use trusted backend attestation. Do not advertise fast same-person recovery: the live adapter returns `false`, so recovery requires all guardians plus the 48-hour veto.

### Step 6: enable and publish GitHub Pages

The core deployment and manifest gate are ready, but GitHub Pages becomes writable only after the pending workflow merge. Do not bypass repository review or manually publish from an unmerged workflow. The custom domain `https://agenttrust.site` is live behind Tokyo Caddy with valid HTTPS and `www` redirects to apex. Keep the unaudited/testnet-only and backend-attestation trust warnings visible on every public host.

### Step 7: verify onchain state

- Confirm source and runtime bytecode for all four core contracts using the addresses in [`../../deployments/84532.json`](../../deployments/84532.json): `https://sepolia.basescan.org/address/<address>`.
- After each host is actually published, open the merged-workflow GitHub Pages URL and `https://agenttrust.site`, switch MetaMask to Base Sepolia, and verify non-PoH behavior. Do not describe either host as live before deployment completes.
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
| World ID v4 attestation adapter | Actual deployment receipt | Deployed and bound separately; recorded in `deployments/84532-world-id.json` |

Use `forge script --estimate-gas` and actual deployment output as the source of truth. Keep a generous test-ETH buffer; estimates and network fees can change.

## 6. Failure and recovery

| Failure | Response |
|---|---|
| RPC unavailable | Retry or use another reputable Base Sepolia RPC |
| Legacy adapter selected | Stop; do not deploy the V1/Contracts 3.0 `WorldIDPoHVerifier`; implement and review a v4 adapter |
| Unexpected verifier binding | Verify `pohVerifier()` equals `0x1325C3eD12d535Bc33A56305466159d370BDf6cE`; disable affected flows and review any mismatch |
| Wrong core addresses | Regenerate from the named broadcast; let manifest RPC validation reject incorrect wiring |
| Frontend addresses stale | Run manifest `--check`, inspect Actions logs for `NEXT_PUBLIC_CHAIN=base-sepolia`, then clear Pages cache and hard-refresh |
| Insufficient gas | Obtain more faucet ETH, then use `forge script --resume` where safe or redeploy |
| Testnet key exposed | Treat it as compromised, replace it, and repeat the deployment with a new dedicated testnet key |

## 7. Related documentation

- [Contracts README](../README.md)
- [Local full-path demo](./DEMO.md)
- [World ID integration notes](../../docs/world-id-integration.md)
