# AgentTrust Smart Contracts (Foundry)

**English** | [简体中文](./README.zh-CN.md)

AgentTrust's Solidity implementation, developed, tested, and deployed with Foundry.

## Contract inventory

Four core contracts are tracked in each deployment manifest:

| Contract | Responsibility |
|---|---|
| `src/AgentRegistry.sol` | Agent identity registry: ERC-721 Agent IDs, accountable-owner binding, registration deposits, and proof-of-humanity configuration |
| `src/GuaranteeEscrow.sol` | Trade escrow, guarantor stake, settlement, and slashing |
| `src/SchellingVoting.sol` | Dispute resolution through staked Schelling-point community voting |
| `src/ReputationHub.sol` | Onchain attestations; only authorized Escrow/Voting writers may update reputation, and self-review is forbidden |

World ID app `app_01728cabff1e05950af1ff18c06c9d38` and RP `rp_fd884ac4342cc4d1` are registered. `src/WorldIDPoHVerifier.sol` is a legacy adapter for deprecated World ID V1/Contracts 3.0 and is not the live integration. Because a v4 direct verifier is unavailable on Base Sepolia, the project uses an explicit backend-attestation architecture: the same-origin `/api/world-id` service calls the official v4 Developer Portal API and signs with server-only trusted-attester keys; `WorldIDV4AttestationVerifier` at `0x1325C3eD12d535Bc33A56305466159d370BDf6cE` verifies those attestations and is bound to the Registry. This is not direct onchain World verification. `AnvilDevPoHVerifier`, defined in `script/Deploy.s.sol`, remains local-only test infrastructure and must never be deployed publicly.

## Tests

The authoritative Foundry baseline is **159 tests passed, 0 failed, 0 skipped**, including unit, fuzz, E2E, and invariant coverage.

```bash
export PATH="$HOME/.foundry/bin:$PATH"
NO_PROXY="127.0.0.1,localhost,::1" forge test -vvv

# Full-path E2E only
NO_PROXY="127.0.0.1,localhost,::1" forge test --match-contract E2ETest -vvv
```

> **Windows:** If Foundry is not on `PATH`, first run `export PATH="$HOME/.foundry/bin:$PATH"`. A local proxy can make `cast`/`forge` requests return 502; use `NO_PROXY="127.0.0.1,localhost,::1"` for local RPC calls.

## Local deployment

```bash
# Disposable local Anvil chain used by the full-path demo
export PATH="$HOME/.foundry/bin:$PATH"
NO_PROXY="127.0.0.1,localhost,::1" anvil --chain-id 31337 --port 8545

# Deploy; Deploy.s.sol also reads PRIVATE_KEY through vm.envUint
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
NO_PROXY="127.0.0.1,localhost,::1" \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key "$PRIVATE_KEY"
```

The published key is an insecure, disposable Anvil key. Never use it on a public or valuable network.

The script deploys Registry → Hub → Escrow → Voting, grants Escrow/Voting their Hub writer roles, transfers Escrow ownership to Voting, configures obligation oracles and registration parameters, and—only on chain `31337` when `POH_VERIFIER` is unset—deploys the local-only `AnvilDevPoHVerifier`.

The four Base Sepolia core contracts are deployed and RPC-validated; addresses are in [`../deployments/84532.json`](../deployments/84532.json). The separate `WorldIDV4AttestationVerifier` is deployed at `0x1325C3eD12d535Bc33A56305466159d370BDf6cE` and bound to the Registry. PoH registration and guarantor/juror gates are enabled through the trusted backend-attestation model. `verifySameIdentity` returns `false`, so Base Sepolia recovery always uses all guardians plus a 48-hour veto. See the [Base Sepolia deployment guide](./demo/DEPLOY-BaseSepolia.md).

## Demo

See the [full-path demo](./demo/DEMO.md) for registration → guaranteed trade → delivery → dispute → community vote → slashing → reputation updates.

## More

- [Project overview](../README.md)
- [Base Sepolia deployment guide](./demo/DEPLOY-BaseSepolia.md)
- [Design specification](../docs/superpowers/specs/2026-08-08-agenttrust-design.md)
