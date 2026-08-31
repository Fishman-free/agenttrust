# Agent External Identity Binding (L1–L4)

Date: 2026-08-31
Status: approved (design fixed during research phase, user green-lit "完成L1-L4的落地")

## Problem

`AgentRegistry` mints one ERC-721 `ATID` per responsible subject (wallet + PoH anchor), but the
`AgentInfo` record carries no reference to *which external agent* (from Dify / Coze / OpenAI /
self-hosted A2A / MCP / ERC-8004 ecosystems) the ID stands for. Guarantees, reputation, and
disputes therefore attach to a wallet, not to the agent actually executing work. Binding an
external agent to a unique on-chain ID is the prerequisite for trustworthy agent trading.

Insight from research: binding is **proof-of-control** (challenge–response), not naming.
Industry alignment: ERC-8004 Trustless Agents (spec saved at
`papers/2608-eip-8004-trustless-agents.md`), A2A v1.0 signed Agent Cards, BAID, KYA tiering.

## Design

### Verification levels (monotonic, never downgrade)

| Level | Name | Proof | Verifier |
|---|---|---|---|
| L1 | Declared | `platform` + `externalAgentId` claim, unique-key reservation | none (deposit at stake, existing mechanism) |
| L2 | KeyControl (EVM) | EIP-191 signature by the external agent's control key over `agentId + gateway nonce` | on-chain `ECDSA.recover`, no trust needed |
| L2' | KeyControl (generic) | off-chain verification artifact (e.g. A2A Agent Card Ed25519 JWS) → hash | `identityVerifier` attestation role (BFF gateway) |
| L3 | DomainControl | `https://{domain}/.well-known/agent-registration.json` contains a matching `registrations[]` entry (ERC-8004 semantics) | `identityVerifier` attestation role |
| L4 | Erc8004 | cross-contract `ownerOf` on same-chain ERC-8004 IdentityRegistry | on-chain, trustless |

Monotonicity: level may only increase. Downgrade calls revert. This prevents
"high-trust → low-trust" resets that could launder reputation signals.

### State & interfaces (additive, no breaking changes to existing functions)

```solidity
enum VerificationLevel { Declared, KeyControl, DomainControl, Erc8004 }

struct ExternalIdentity {
    string platform;         // "dify", "coze", "openai", "a2a", "mcp", "erc8004", ...
    string externalAgentId;  // platform-local identifier
    string domain;           // L3 verified HTTPS domain
    address controlKey;      // L2 key that answered the EIP-191 challenge
    address erc8004Registry; // L4 same-chain ERC-8004 IdentityRegistry
    uint256 erc8004AgentId;  // L4 tokenId on that registry
    bytes32 proofHash;       // keccak256 of verification artifact (L2'/L3)
    uint64 verifiedAt;
}

mapping(uint256 => ExternalIdentity) public externalIdentities;      // agentId → identity
mapping(bytes32 => uint256) public declaredKeyToAgent;               // keccak256(platform, externalAgentId) → agentId  (anti-squat / anti-duplicate)
mapping(bytes32 => bool) public usedBindingNonces;                   // L2 replay protection

function bindExternalIdentity(uint256 agentId, string platform, string externalAgentId) external
function proveKeyControl(uint256 agentId, bytes32 nonce, bytes calldata signature) external
function attestIdentity(uint256 agentId, uint8 level, bytes32 proofHash, string calldata domain) external  // identityVerifier only
function linkErc8004(uint256 agentId, address erc8004Registry, uint256 externalAgentId) external
function verificationLevelOf(uint256 agentId) external view returns (uint8)
function agentByDeclaredKey(string calldata, string calldata) external view returns (uint256)
function setIdentityVerifier(address verifier) external onlyOwner
```

Rules:
- `bindExternalIdentity`: caller must be active, non-deregistered owner of `agentId`; each
  agent binds at most one external identity per lifetime of the ATID (aligned with the
  one-lifetime-ID philosophy); the declared key is globally unique (second binder reverts).
- `proveKeyControl`: digest = EIP-191 `toEthSignedMessageHash(keccak256("AgentTrust external-agent binding: " + agentId + nonce))`;
  recovered `controlKey != 0` upgrades to `KeyControl`. Nonce single-use.
- `attestIdentity`: only `identityVerifier` (pattern matches existing `pohVerifier` /
  slash-source oracle roles); level ∈ {KeyControl, DomainControl}; requires prior L1 bind;
  monotonic check. Domain required for DomainControl.
- `linkErc8004`: caller must own `agentId` AND `IERC721(erc8004Registry).ownerOf(externalAgentId) == msg.sender`
  (same-chain trustless check, mirroring ERC-8004 ownership semantics).
- `deregister`: clears `declaredKeyToAgent` (the external identity dies with the ATID; the
  subject tombstone prevents re-registration, so no laundering). The freed external key may
  be claimed by a future ATID (agent ownership transfer).
- Recovery migration: mappings key on `agentId` (tokenId), which survives wallet recovery —
  external identity is a property of the ATID, not the wallet.
- Events: `ExternalIdentityBound`, `KeyControlProved`, `IdentityAttested`, `Erc8004Linked`.

### ERC-8004 alignment (beyond the contract)

- Registration file JSON generated by frontend/BFF SHOULD follow ERC-8004 `registration-v1`
  shape, with a `registrations[]` entry `{ agentId, agentRegistry: "eip155:{chainId}:{AgentRegistry}" }`
  so AgentTrust IDs are cross-referenceable by ERC-8004 tooling.
- L3 gateway check mirrors ERC-8004 "Endpoint Domain Verification": fetch
  `.well-known/agent-registration.json`, require a `registrations` entry matching the
  on-chain agent, hash the artifact, attest.
- Agent wallet semantics (ERC-8004 `agentWallet` w/ EIP-712) deferred to a future PR; noted
  as follow-up, not in scope.

### Borrowed from other systems (research summary)

- ERC-8004: registrations cross-reference + domain verification + on-chain/off-chain split.
- A2A v1.0: signed Agent Card (Ed25519 detached JWS) is the standard artifact hashed at L2'.
- BAID (arXiv:2512.17538): challenge–response proof-of-control; biometric/zkVM tiers are
  future phases (not MVP).
- KYA industry consensus: trust proportional to value at risk — L1 stays viable because the
  registration deposit (already enforced) backs declared-only bindings. This is AgentTrust's
  differentiating closed loop: mis-binding is disputable and slashable, which pure
  registries cannot offer.

## Test plan (TDD, written first)

New `contracts/test/AgentRegistryExternalIdentity.t.sol`:
1. L1 bind: level, unique mapping, event emission.
2. L1 reverts: foreign caller, inactive/deregistered subject, empty platform, duplicate key,
   double bind on same agent.
3. Proof functions revert before L1 bind.
4. L2 `proveKeyControl`: valid signature upgrades; wrong signer / replayed nonce revert.
5. L2'/L3 `attestIdentity`: verifier-only, monotonic level, domain required at L3,
   non-verifier revert, unknown level revert.
6. L4 `linkErc8004` with `MockERC8004Registry` (ERC-721): owner path upgrades to Erc8004;
   non-owner of external token reverts; wrong registry reverts.
7. `deregister` frees the declared key (re-bindable by a new subject).
8. Recovery migration preserves external identity on the same agentId.
9. View helpers return expected values at each level.

## Out of scope (follow-ups)

- BFF gateway endpoints for nonce issuance and `.well-known` fetch (frontend wiring next).
- Ed25519/JWS on-chain verification (precompile absent; gateway attestation covers it).
- ERC-8004 `agentWallet` equivalent and multi-chain registrations.
