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

`src/WorldIDPoHVerifier.sol` is the real World ID proof-of-humanity adapter. It is deployed and configured separately and is not one of the four manifest-tracked core contracts. `AnvilDevPoHVerifier`, defined in `script/Deploy.s.sol`, is local-only test infrastructure and must never be deployed to a public or valuable network.

## Tests

The authoritative Foundry baseline is **146 tests passed, 0 failed, 0 skipped across 10 suites**, including unit, fuzz, E2E, and invariant coverage.

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

A public-network deployment requires a separately deployed real `WorldIDPoHVerifier` address in `POH_VERIFIER`; see the [Base Sepolia deployment guide](./demo/DEPLOY-BaseSepolia.md).

## Demo

See the [full-path demo](./demo/DEMO.md) for registration → guaranteed trade → delivery → dispute → community vote → slashing → reputation updates.

## More

- [Project overview](../README.md)
- [Base Sepolia deployment guide](./demo/DEPLOY-BaseSepolia.md)
- [Design specification](../docs/superpowers/specs/2026-08-08-agenttrust-design.md)
