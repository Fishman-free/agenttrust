#!/bin/sh
# One-shot Compose setup: deploy or safely reuse four contracts, then publish readiness.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONTRACTS_DIR=$(dirname "$SCRIPT_DIR")
cd "$CONTRACTS_DIR"

RPC_URL="${RPC_URL:-http://anvil:8545}"
INSECURE_ANVIL_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
PRIVATE_KEY="${PRIVATE_KEY:-$INSECURE_ANVIL_KEY}"
CHAIN_ID="${CHAIN_ID:-31337}"
MANIFEST_PATH="${MANIFEST_PATH:-$CONTRACTS_DIR/../deployments/$CHAIN_ID.json}"
READY_FILE="${READY_FILE:-${TMPDIR:-/tmp}/agenttrust-contracts-ready}"

REGISTRY=0x5fBDB2315678afecb367f032d93F642f64180aa3
HUB=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
ESCROW=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
VOTING=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9

fail() {
  echo "error: $*" >&2
  exit 1
}

lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

clear_readiness() {
  rm -f "$READY_FILE" "$READY_FILE.tmp"
}

publish_readiness() {
  printf 'contracts and wiring ready\n' > "$READY_FILE.tmp"
  mv "$READY_FILE.tmp" "$READY_FILE"
  ready_published=1
}

ready_published=0
mkdir -p "$(dirname "$READY_FILE")"
clear_readiness
trap '[ "$ready_published" -eq 1 ] || clear_readiness' EXIT
trap 'clear_readiness; exit 1' HUP INT TERM

[ -f "$MANIFEST_PATH" ] || fail "missing deployment manifest: $MANIFEST_PATH"

manifest_hash() {
  key=$1
  awk -v key="\"$key\"" '
    index($0, "\"runtimeBytecodeHashes\"") { in_hashes = 1 }
    in_hashes && index($0, key) && match($0, /0x[0-9a-fA-F]{64}/) {
      print substr($0, RSTART, RLENGTH)
      exit
    }
  ' "$MANIFEST_PATH"
}

manifest_string() {
  key=$1
  awk -v key="\"$key\"" '
    index($0, key) && match($0, /:[[:space:]]*"[0-9]+"/) {
      value = substr($0, RSTART, RLENGTH)
      gsub(/[^0-9]/, "", value)
      print value
      exit
    }
  ' "$MANIFEST_PATH"
}

manifest_number() {
  key=$1
  awk -v key="\"$key\"" '
    index($0, key) && match($0, /:[[:space:]]*[0-9]+/) {
      value = substr($0, RSTART, RLENGTH)
      gsub(/[^0-9]/, "", value)
      print value
      exit
    }
  ' "$MANIFEST_PATH"
}

REGISTRY_HASH=$(manifest_hash agentRegistry)
HUB_HASH=$(manifest_hash reputationHub)
ESCROW_HASH=$(manifest_hash guaranteeEscrow)
VOTING_HASH=$(manifest_hash schellingVoting)
CASE_STAKE=$(manifest_string caseStake)
COMMIT_WINDOW=$(manifest_number commitWindow)
REVEAL_WINDOW=$(manifest_number revealWindow)
for value in "$REGISTRY_HASH" "$HUB_HASH" "$ESCROW_HASH" "$VOTING_HASH" "$CASE_STAKE" "$COMMIT_WINDOW" "$REVEAL_WINDOW"; do
  [ -n "$value" ] || fail "manifest is missing runtime hashes or voting parameters"
done

has_code() {
  code=$(cast code "$1" --rpc-url "$RPC_URL" 2>/dev/null || true)
  [ -n "$code" ] && [ "$code" != "0x" ]
}

assert_runtime_hash() {
  name=$1
  address=$2
  expected=$3
  actual=$(cast codehash "$address" --rpc-url "$RPC_URL") || fail "$name codehash call failed"
  [ "$(lower "$actual")" = "$(lower "$expected")" ] || fail "$name stale or unknown runtime bytecode: expected $expected, got $actual"
  echo "   runtime bytecode ok: $name $address $actual"
}

assert_address_call() {
  label=$1
  contract=$2
  signature=$3
  expected=$4
  actual=$(cast call "$contract" "$signature" --rpc-url "$RPC_URL") || fail "$label call failed"
  [ "$(lower "$actual")" = "$(lower "$expected")" ] || fail "$label expected $expected, got $actual"
}

assert_true_call() {
  label=$1
  contract=$2
  signature=$3
  argument=$4
  actual=$(cast call "$contract" "$signature" "$argument" --rpc-url "$RPC_URL") || fail "$label call failed"
  [ "$actual" = "true" ] || fail "$label expected true, got $actual"
}

assert_uint_call() {
  label=$1
  contract=$2
  signature=$3
  expected=$4
  actual=$(cast call "$contract" "$signature" --rpc-url "$RPC_URL") || fail "$label call failed"
  actual=${actual%% *}
  [ "$actual" = "$expected" ] || fail "$label expected $expected, got $actual"
}

validate_deployment() {
  assert_runtime_hash AgentRegistry "$REGISTRY" "$REGISTRY_HASH"
  assert_runtime_hash ReputationHub "$HUB" "$HUB_HASH"
  assert_runtime_hash GuaranteeEscrow "$ESCROW" "$ESCROW_HASH"
  assert_runtime_hash SchellingVoting "$VOTING" "$VOTING_HASH"
  assert_address_call "GuaranteeEscrow.registry" "$ESCROW" "registry()(address)" "$REGISTRY"
  assert_address_call "GuaranteeEscrow.hub" "$ESCROW" "hub()(address)" "$HUB"
  assert_address_call "SchellingVoting.escrow" "$VOTING" "escrow()(address)" "$ESCROW"
  assert_address_call "SchellingVoting.registry" "$VOTING" "registry()(address)" "$REGISTRY"
  assert_address_call "SchellingVoting.hub" "$VOTING" "hub()(address)" "$HUB"
  assert_address_call "GuaranteeEscrow.owner" "$ESCROW" "owner()(address)" "$VOTING"
  assert_true_call "ReputationHub.outcomeWriters" "$HUB" "outcomeWriters(address)(bool)" "$ESCROW"
  assert_true_call "ReputationHub.jurorMetricWriters" "$HUB" "jurorMetricWriters(address)(bool)" "$VOTING"
  assert_uint_call "SchellingVoting.caseStake" "$VOTING" "caseStake()(uint256)" "$CASE_STAKE"
  assert_uint_call "SchellingVoting.commitWindow" "$VOTING" "commitWindow()(uint256)" "$COMMIT_WINDOW"
  assert_uint_call "SchellingVoting.revealWindow" "$VOTING" "revealWindow()(uint256)" "$REVEAL_WINDOW"
  echo "   dependency, role, ownership, and voting parameter wiring ok"
}

extract_named_addresses() {
  contract_name=$1
  awk -v name="$contract_name" '
    match($0, /"transactionType"[[:space:]]*:[[:space:]]*"[A-Z]+"/) {
      type = substr($0, RSTART, RLENGTH)
    }
    type ~ /"CREATE"/ && index($0, "\"contractName\": \"" name "\"") { named_create = 1 }
    named_create && match($0, /"contractAddress"[[:space:]]*:[[:space:]]*"0x[0-9a-fA-F]{40}"/) {
      value = substr($0, RSTART, RLENGTH)
      sub(/^.*"0x/, "0x", value)
      sub(/"$/, "", value)
      print value
      named_create = 0
      type = ""
    }
  ' "$RUN_FILE"
}

assert_single_broadcast_address() {
  name=$1
  expected=$2
  addresses=$(extract_named_addresses "$name")
  set -- $addresses
  [ "$#" -eq 1 ] || fail "broadcast must contain exactly one named CREATE deployment for $name; found $#"
  actual=$1
  [ "$(lower "$actual")" = "$(lower "$expected")" ] || fail "$name broadcast address $actual does not match manifest address $expected"
  echo "   broadcast ok: $name $actual"
}

echo "AgentTrust deployment: RPC=$RPC_URL expected-chain=$CHAIN_ID"
attempt=0
until cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || fail "RPC did not become ready: $RPC_URL"
  sleep 2
done

actual_chain_id=$(cast chain-id --rpc-url "$RPC_URL")
[ "$actual_chain_id" = "$CHAIN_ID" ] || fail "RPC chain id is $actual_chain_id, expected $CHAIN_ID"
if [ "$PRIVATE_KEY" = "$INSECURE_ANVIL_KEY" ]; then
  [ "$actual_chain_id" = "31337" ] || fail "the public Anvil key is forbidden outside chain 31337"
  case "$RPC_URL" in
    http://127.0.0.1:*|http://localhost:*|http://anvil:*) ;;
    *) fail "the public Anvil key is allowed only with a local or Compose Anvil endpoint" ;;
  esac
fi
echo "RPC ready on chain $actual_chain_id"

present=0
for address in "$REGISTRY" "$HUB" "$ESCROW" "$VOTING"; do
  if has_code "$address"; then present=$((present + 1)); fi
done

if [ "$present" -eq 4 ]; then
  echo "Reusing persisted deployment after runtime bytecode and wiring validation."
  validate_deployment
  publish_readiness
  echo "AgentTrust deployment is ready."
  exit 0
fi

[ "$present" -eq 0 ] || fail "partial canonical deployment detected ($present/4 contracts); reset the Anvil state volume before retrying"

echo "Deploying AgentRegistry, ReputationHub, GuaranteeEscrow, and SchellingVoting."
export PRIVATE_KEY
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --private-key "$PRIVATE_KEY" -vv

RUN_FILE="broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"
[ -f "$RUN_FILE" ] || fail "missing broadcast file: $RUN_FILE"
assert_single_broadcast_address AgentRegistry "$REGISTRY"
assert_single_broadcast_address ReputationHub "$HUB"
assert_single_broadcast_address GuaranteeEscrow "$ESCROW"
assert_single_broadcast_address SchellingVoting "$VOTING"
validate_deployment
publish_readiness

echo "AgentTrust deployment is ready."
