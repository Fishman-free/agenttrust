# AgentTrust Frontend

**English** | [简体中文](./README.zh-CN.md)

AgentTrust's Next.js App Router frontend provides Agent registration, guaranteed trades, dispute resolution, and reputation lookup. Wallet and onchain interactions use wagmi, viem, and TanStack Query.

## Local development

Requires **Node.js >=20.9**. Install dependencies in this directory and start the development server:

```bash
npm ci
npm run dev
```

The default target is local Anvil (chain ID `31337`, RPC `http://127.0.0.1:8545`). Open `http://localhost:3000`.

## Environment variables

| Variable | Accepted values | Default | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CHAIN` | `anvil`, `base-sepolia` | `anvil` | Select the chain and contract-address set |
| `NEXT_PUBLIC_BASE_PATH` | For example, `/multiagent` | empty | Set the Next.js base path for subpath deployments |

An unknown `NEXT_PUBLIC_CHAIN` fails the build instead of silently connecting to the wrong network. Chain configuration and addresses come from `lib/deployments.ts`, generated from repository-root `deployments/*.json`. Do not edit the generated file or hard-code addresses in `lib/config.ts`.

The Base Sepolia manifest is currently explicitly `undeployed`, so that target displays an unavailable/read-only status and disables all write actions. After changing a manifest, run `node scripts/deployment-manifest.mjs generate` from the repository root; CI uses `check` mode to prevent generated-file drift. See the [Base Sepolia deployment guide](../contracts/demo/DEPLOY-BaseSepolia.md).

PowerShell example:

```powershell
$env:NEXT_PUBLIC_CHAIN="base-sepolia"
$env:NEXT_PUBLIC_BASE_PATH="/multiagent"
npm run build
```

## Common commands

```bash
npm run lint
npm run build
npm run test
npm run test:watch
npm run e2e
```

Contract ABIs are generated deterministically from Foundry artifacts by repository-root `scripts/gen-abi.mjs`:

```bash
forge build --root contracts
node scripts/gen-abi.mjs
node scripts/gen-abi.mjs --check
```

Do not edit `lib/abi.ts` manually.

`npm run build` uses `output: "export"` to generate `out/`. With `trailingSlash: true`, every route becomes an `index.html` inside its route directory. This supports GitHub Pages, object storage, and Nginx static hosting while safely handling deep links such as `/agents/`. For Nginx, follow the `try_files $uri $uri/` example in `nginx.conf`.

## Wallet and transaction UI

The global header provides wallet connect/disconnect, current address and chain, wrong-network detection, and target-chain switching or addition. Every contract page waits for the onchain receipt through `app/components/transaction-status.tsx`, parses events, and refreshes state. The trade UI implements the complete ten-state lifecycle. The dispute UI implements the 2% bond, permissionless case opening, commit–reveal, claim/withdraw, and juror-metric finalization.

Commit secrets are generated with the browser CSPRNG and isolated in `localStorage` by chain, Voting address, case, and voter. Export a backup before clearing browser data; otherwise reveal may become impossible and the voting stake may be slashed.

## Tests

Vitest uses jsdom and React Testing Library to cover ABI drift, manifest/config behavior, event parsing, ten-state mappings, commit-secret lifecycle, transaction feedback, and Agents/Disputes/Reputation page logic.

`npm run e2e` starts disposable Anvil, deploys the current contracts, and runs serial Chromium E2E for a normal trade and a six-identity disputed trade. The test wallet provider is injected only for localhost/31337, uses unlocked Anvil accounts, and is excluded from the production bundle.

The MetaMask/Synpress smoke test is separate and non-blocking:

```bash
npm run e2e:metamask:cache
npm run e2e:metamask
```

Synpress 4's cache CLI does not support native Windows. Use Linux/WSL or manually trigger the non-blocking MetaMask GitHub Actions job. Use only the public disposable Anvil mnemonic; never reuse a real wallet mnemonic.

For the end-to-end workflow and its secret-handling warnings, see the [full-path demo](../contracts/demo/DEMO.md).
