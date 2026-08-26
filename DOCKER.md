# AgentTrust: one-command Docker setup

**English** | [简体中文](DOCKER.zh-CN.md)

Start the complete local environment with one command. Apart from Docker, no local Node.js, Foundry, or Anvil installation is required.

```text
Open http://localhost:3000 in a browser
```

## Prerequisites

- **Docker Desktop** with Docker Compose
- Access to Docker Hub and `ghcr.io` for the initial Foundry, Node, and nginx image pulls

> **Windows proxy note:** host proxy settings can cause `cast` or `forge` calls to localhost to return 502. The Compose `setup` container connects to the `anvil` service over the internal Docker network, so it bypasses the host proxy. The browser connects directly to `http://127.0.0.1:8545`.

## Start everything

```bash
docker compose up -d --build     # build and start in the background
docker compose ps                # anvil, setup, and frontend
```

Wait until `frontend` is `healthy`, then open **http://127.0.0.1:3000**. The frontend and RPC ports bind only to the host loopback interface and are not exposed to the LAN.

```bash
docker compose ps   # frontend should report healthy
```

## Validate the environment

```bash
# Frontend HTML
curl http://localhost:3000

# Anvil RPC JSON, including chainId
curl http://localhost:8545

# Deployment and four-contract validation logs
docker compose logs setup
```

The authoritative contract-test result is **146 tests passed, 0 failed, 0 skipped across 10 suites**. Run the tests outside this runtime-only Compose flow with the command documented in [`README.md`](README.md).

## How it works

| Service | Role |
|---|---|
| `anvil` | Pinned Foundry v1.7.1 node at `127.0.0.1:8545`; persists state in a named volume through `--state /home/foundry/state.json --state-interval 1` |
| `setup` | One-shot container that deploys or reuses four named contracts and validates runtime bytecode hashes, voting parameters, dependency getters, Hub authorization, and Escrow ownership; exits after success |
| `frontend` | Statically exported frontend served by nginx at `127.0.0.1:3000`; `/healthz` requires both nginx and the readiness marker written atomically by `setup` |

### Network model: two meanings of port 8545

| Client | Endpoint | Reason |
|---|---|---|
| `setup` container | `http://anvil:8545` | Docker Compose service discovery between containers |
| Browser frontend | `http://127.0.0.1:8545` | The browser runs on the host, where Anvil is mapped to port 8545 |

The browser RPC value comes from `deployments/31337.json` through generated `frontend/lib/deployments.ts`; it is currently `http://127.0.0.1:8545`.

### Contract addresses and deployment state

`deployments/31337.json` records the canonical deterministic addresses produced by the first four `CREATE` operations from the default Anvil account. `deployments/84532.json` explicitly marks Base Sepolia as `undeployed`; Base Sepolia is currently **read-only and has no active contract deployment**. `frontend/lib/config.ts` selects a generated manifest and contains no address literals.

```bash
node scripts/deployment-manifest.mjs --write  # alias: generate; rebuild TypeScript after manifest changes
node scripts/deployment-manifest.mjs --check  # alias: check; validate schema, metadata, canonical addresses, and generated output
```

`setup` reads `broadcast/Deploy.s.sol/31337/run-latest.json` and requires exactly one `CREATE` for each `contractName`, with every address matching the manifest. The manifest also stores runtime bytecode hashes, constructor arguments, and any deployer, transaction hash, and block number available from the broadcast. `cast` then validates all four runtime hashes, Escrow and Voting dependencies, Voting `caseStake`/`commitWindow`/`revealWindow`, both Hub writer grants, and Escrow ownership.

Only after every validation succeeds does `setup` atomically write the readiness marker to the shared volume. nginx returns 503 from `/healthz` while the marker is absent, so health means more than “nginx is running.” Any setup failure removes the marker and either blocks the first frontend start or makes a running frontend unhealthy.

## Common commands

```bash
# Start
docker compose up -d --build

# Status and logs
docker compose ps
docker compose logs -f frontend
docker compose logs setup

# Stop containers but preserve Anvil state; the next up revalidates hashes and wiring before reuse
docker compose down
docker compose up -d

# Stop without removing containers or state
docker compose stop

# Remove chain state and redeploy to canonical addresses on the next start
docker compose down --volumes
```

## Troubleshooting

### `setup` reports `Exited (0)`

This is expected. `setup` is a one-shot service and exits with code 0 after successful deployment and validation. `frontend` starts only after that successful completion.

### The wallet asks to switch networks

Anvil uses Chain ID `31337` and network name `Local Anvil`. Configure a browser wallet with RPC `http://127.0.0.1:8545`. For local testing only, you can import the default Anvil key:

`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

### Can I use Base Sepolia?

Base Sepolia (Chain ID 84532) is currently **undeployed and read-only**. Static testnet publishing is outside this Compose setup. See [`README.md`](README.md), [`contracts/demo/DEPLOY-BaseSepolia.md`](contracts/demo/DEPLOY-BaseSepolia.md), and `frontend/lib/config.ts`.

### Port 8545 is already in use

A host Anvil or older demo process is probably using the port.

1. Find and stop it with `tasklist | grep anvil`, then `taskkill //PID <PID> //F`.
2. Alternatively, change `127.0.0.1:8545:8545` to `127.0.0.1:8546:8545` in `docker-compose.yml`, update `rpcUrl` in `deployments/31337.json`, and regenerate the frontend module.
3. Run `docker compose up -d` again after the port is free.

### `partial canonical deployment detected`, `stale or unknown runtime bytecode`, or wiring validation fails

The persistent volume contains incomplete, outdated, or unknown chain state. Run `docker compose down --volumes`, then rebuild. A normal `docker compose down` followed by `up` reuses matching state only after revalidation; the setup script rejects unknown state to avoid nonce, bytecode, or frontend-manifest drift.

### The first build is slow or an image pull fails

The Foundry, Node, and nginx images total roughly 500 MB or more. If a pull times out, prefetch with `docker pull ghcr.io/foundry-rs/foundry:stable` and `docker pull nginx:stable-alpine`.

## Related files and guides

- `docker-compose.yml` — three-service orchestration
- `contracts/Dockerfile` and `contracts/scripts/deploy.sh` — setup image and deployment script
- `frontend/Dockerfile` and `frontend/nginx.conf` — multi-stage frontend image and nginx static server
- [`README.md`](README.md) — English project overview
- [`docs/USAGE.md`](docs/USAGE.md) — English usage guide
- [`docs/feature-walkthrough.md`](docs/feature-walkthrough.md) — complete feature walkthrough
- [`docs/world-id-integration.md`](docs/world-id-integration.md) — World ID integration
