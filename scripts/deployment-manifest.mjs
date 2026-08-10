#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS_DIR = join(ROOT, "deployments");
const GENERATED_MODULE = join(ROOT, "frontend", "lib", "deployments.ts");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const CONTRACT_NAMES = {
  AgentRegistry: "agentRegistry",
  ReputationHub: "reputationHub",
  GuaranteeEscrow: "guaranteeEscrow",
  SchellingVoting: "schellingVoting",
};
const CONTRACT_KEYS = Object.values(CONTRACT_NAMES);
const CANONICAL_ANVIL = {
  agentRegistry: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  reputationHub: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
  guaranteeEscrow: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
  schellingVoting: "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
};

function fail(message) {
  console.error(`deployment-manifest: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const modes = [];
  const rest = [];
  for (const arg of argv) {
    if (arg === "generate" || arg === "--write") modes.push("generate");
    else if (arg === "check" || arg === "--check") modes.push("check");
    else rest.push(arg);
  }
  if (modes.length !== 1) {
    fail("usage: deployment-manifest.mjs <generate|check|--write|--check> [--broadcast FILE --chain-id ID --rpc-url URL]");
  }
  const options = { command: modes[0] };
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (!["--broadcast", "--chain-id", "--rpc-url"].includes(option)) fail(`unknown option: ${option}`);
    const value = rest[++index];
    if (!value || value.startsWith("--")) fail(`${option} requires a value`);
    options[option.slice(2).replace("-", "_")] = value;
  }
  if (options.broadcast && options.command !== "generate") fail("--broadcast is only valid with generate/--write");
  if (options.broadcast && (!options.chain_id || !options.rpc_url)) fail("--broadcast requires --chain-id and --rpc-url so runtime bytecode can be captured");
  if (options.rpc_url && !options.chain_id) fail("--rpc-url requires --chain-id");
  return options;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
}

function normalize(value) {
  return value.toLowerCase();
}

function hasExactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...keys].sort().join();
}

function validateMetadata(metadata, key, path) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) fail(`${path}: ${key} deployment metadata is required`);
  if (!Array.isArray(metadata.constructorArgs) || metadata.constructorArgs.some((arg) => typeof arg !== "string")) {
    fail(`${path}: ${key}.constructorArgs must be a string array`);
  }
  if (metadata.deployer !== undefined && !ADDRESS_PATTERN.test(metadata.deployer)) fail(`${path}: invalid ${key}.deployer`);
  if (metadata.transactionHash !== undefined && !HASH_PATTERN.test(metadata.transactionHash)) fail(`${path}: invalid ${key}.transactionHash`);
  if (metadata.blockNumber !== undefined && (!Number.isSafeInteger(metadata.blockNumber) || metadata.blockNumber < 0)) {
    fail(`${path}: invalid ${key}.blockNumber`);
  }
}

function expectConstructorArgs(manifest, path) {
  const c = manifest.contracts;
  const m = manifest.deploymentMetadata;
  const p = manifest.votingParameters;
  if (m.agentRegistry.constructorArgs.length !== 0) fail(`${path}: AgentRegistry constructorArgs must be empty`);
  if (m.reputationHub.constructorArgs.length !== 0) fail(`${path}: ReputationHub constructorArgs must be empty`);
  const escrowArgs = m.guaranteeEscrow.constructorArgs;
  if (escrowArgs.length !== 2 || normalize(escrowArgs[0] ?? "") !== normalize(c.agentRegistry)
    || normalize(escrowArgs[1] ?? "") !== normalize(c.reputationHub)) {
    fail(`${path}: GuaranteeEscrow constructorArgs do not match registry/hub`);
  }
  const votingArgs = m.schellingVoting.constructorArgs;
  if (votingArgs.length !== 6
    || normalize(votingArgs[0] ?? "") !== normalize(c.guaranteeEscrow)
    || normalize(votingArgs[1] ?? "") !== normalize(c.agentRegistry)
    || normalize(votingArgs[2] ?? "") !== normalize(c.reputationHub)
    || votingArgs[3] !== p.caseStake
    || votingArgs[4] !== String(p.commitWindow)
    || votingArgs[5] !== String(p.revealWindow)) {
    fail(`${path}: SchellingVoting constructorArgs do not match wiring/votingParameters`);
  }
}

function validateManifest(manifest, path) {
  if (manifest.schemaVersion !== 2) fail(`${path}: schemaVersion must be 2`);
  if (!Number.isSafeInteger(manifest.chainId) || manifest.chainId <= 0) fail(`${path}: invalid chainId`);
  if (typeof manifest.chainName !== "string" || !manifest.chainName) fail(`${path}: chainName is required`);
  if (!["deployed", "undeployed"].includes(manifest.status)) fail(`${path}: invalid status`);
  if (typeof manifest.rpcUrl !== "string" || !/^https?:\/\//.test(manifest.rpcUrl)) fail(`${path}: invalid rpcUrl`);
  if (!hasExactKeys(manifest.contracts, CONTRACT_KEYS)) fail(`${path}: contracts must contain exactly ${CONTRACT_KEYS.join(", ")}`);
  if (!hasExactKeys(manifest.runtimeBytecodeHashes, CONTRACT_KEYS)) fail(`${path}: runtimeBytecodeHashes must contain exactly ${CONTRACT_KEYS.join(", ")}`);
  if (!hasExactKeys(manifest.deploymentMetadata, CONTRACT_KEYS)) fail(`${path}: deploymentMetadata must contain exactly ${CONTRACT_KEYS.join(", ")}`);
  const p = manifest.votingParameters;
  if (!p || typeof p !== "object" || !DECIMAL_PATTERN.test(p.caseStake ?? "") || BigInt(p.caseStake) <= 0n) {
    fail(`${path}: votingParameters.caseStake must be a positive decimal string`);
  }
  for (const key of ["commitWindow", "revealWindow"]) {
    if (!Number.isSafeInteger(p[key]) || p[key] <= 0) fail(`${path}: votingParameters.${key} must be a positive integer`);
  }
  for (const key of CONTRACT_KEYS) {
    const address = manifest.contracts[key];
    if (!ADDRESS_PATTERN.test(address)) fail(`${path}: invalid ${key} address`);
    const isZero = normalize(address) === ZERO_ADDRESS;
    const hash = manifest.runtimeBytecodeHashes[key];
    const metadata = manifest.deploymentMetadata[key];
    if (manifest.status === "deployed") {
      if (isZero) fail(`${path}: deployed manifest contains zero ${key}`);
      if (!HASH_PATTERN.test(hash ?? "")) fail(`${path}: deployed manifest requires ${key} runtime bytecode hash`);
      validateMetadata(metadata, key, path);
    } else {
      if (!isZero) fail(`${path}: undeployed manifest contains non-zero ${key}`);
      if (hash !== null || metadata !== null) fail(`${path}: undeployed ${key} hash and metadata must be null`);
    }
  }
  if (manifest.status === "deployed") expectConstructorArgs(manifest, path);
}

function loadManifests() {
  const files = readdirSync(DEPLOYMENTS_DIR).filter((name) => /^\d+\.json$/.test(name)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
  if (files.length === 0) fail("no deployment manifests found");
  const manifests = files.map((file) => {
    const path = join(DEPLOYMENTS_DIR, file);
    const manifest = readJson(path);
    validateManifest(manifest, path);
    if (`${manifest.chainId}.json` !== file) fail(`${path}: filename must match chainId`);
    return manifest;
  });
  const duplicate = manifests.find((manifest, index) => manifests.findIndex((item) => item.chainId === manifest.chainId) !== index);
  if (duplicate) fail(`duplicate chainId ${duplicate.chainId}`);
  const anvil = manifests.find(({ chainId }) => chainId === 31337);
  if (!anvil || anvil.status !== "deployed") fail("31337 manifest must be deployed");
  for (const key of CONTRACT_KEYS) {
    if (normalize(anvil.contracts[key]) !== normalize(CANONICAL_ANVIL[key])) fail(`31337 ${key} is not the canonical Anvil address`);
  }
  if (!manifests.some(({ chainId }) => chainId === 84532)) fail("explicit 84532 manifest is required");
  return manifests;
}

function blockNumber(value, label) {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "string" && value.startsWith("0x") ? Number.parseInt(value, 16) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`invalid ${label}: ${value}`);
  return parsed;
}

function extractNamedDeployments(broadcastPath) {
  const broadcast = readJson(resolve(broadcastPath));
  if (!Array.isArray(broadcast.transactions)) fail("broadcast file has no transactions array");
  const receipts = new Map((broadcast.receipts ?? []).filter((receipt) => HASH_PATTERN.test(receipt.transactionHash ?? ""))
    .map((receipt) => [normalize(receipt.transactionHash), receipt]));
  const contracts = {};
  const deploymentMetadata = {};
  for (const [contractName, key] of Object.entries(CONTRACT_NAMES)) {
    const matches = broadcast.transactions.filter((transaction) => transaction.transactionType === "CREATE" && transaction.contractName === contractName);
    if (matches.length !== 1) fail(`broadcast must contain exactly one named CREATE deployment for ${contractName}; found ${matches.length}`);
    const transaction = matches[0];
    if (!ADDRESS_PATTERN.test(transaction.contractAddress ?? "")) fail(`broadcast has invalid address for ${contractName}`);
    contracts[key] = normalize(transaction.contractAddress);
    const metadata = { constructorArgs: (transaction.arguments ?? []).map(String) };
    const addressReceipts = (broadcast.receipts ?? []).filter((receipt) => ADDRESS_PATTERN.test(receipt.contractAddress ?? "")
      && normalize(receipt.contractAddress) === contracts[key]);
    if (addressReceipts.length > 1) fail(`broadcast contains multiple deployment receipts for ${contractName}`);
    // Foundry broadcasts can reorder transaction hashes in transactions[]; a receipt's
    // contractAddress is authoritative for CREATE metadata. Fall back to hash matching.
    const receipt = addressReceipts[0] ?? (HASH_PATTERN.test(transaction.hash ?? "") ? receipts.get(normalize(transaction.hash)) : undefined);
    const deployer = receipt?.from ?? transaction.transaction?.from;
    if (ADDRESS_PATTERN.test(deployer ?? "")) metadata.deployer = normalize(deployer);
    const transactionHash = receipt?.transactionHash ?? transaction.hash;
    if (HASH_PATTERN.test(transactionHash ?? "")) metadata.transactionHash = normalize(transactionHash);
    const deployedAt = blockNumber(receipt?.blockNumber, `${contractName} receipt blockNumber`);
    if (deployedAt !== undefined) metadata.blockNumber = deployedAt;
    deploymentMetadata[key] = metadata;
  }
  return { contracts, deploymentMetadata };
}

function cast(rpcUrl, args) {
  try {
    return execFileSync("cast", [...args, "--rpc-url", rpcUrl], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    fail(`cast ${args.join(" ")} failed: ${detail}`);
  }
}

function castJson(rpcUrl, args) {
  const output = cast(rpcUrl, [...args, "--json"]);
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(`cast ${args.join(" ")} returned invalid JSON: ${error.message}`);
  }
}

function captureRuntimeHashes(manifest, rpcUrl) {
  return Object.fromEntries(Object.entries(manifest.contracts).map(([key, address]) => {
    const hash = normalize(cast(rpcUrl, ["codehash", address]));
    if (!HASH_PATTERN.test(hash)) fail(`${key} returned invalid runtime bytecode hash: ${hash}`);
    return [key, hash];
  }));
}

function candidateFromBroadcast(options) {
  const chainId = Number(options.chain_id);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) fail("--chain-id must be a positive integer");
  const manifestPath = join(DEPLOYMENTS_DIR, `${chainId}.json`);
  if (!existsSync(manifestPath)) fail(`create ${manifestPath} before extracting a broadcast`);
  const manifest = readJson(manifestPath);
  const extracted = extractNamedDeployments(options.broadcast);
  manifest.schemaVersion = 2;
  manifest.status = "deployed";
  manifest.contracts = extracted.contracts;
  manifest.deploymentMetadata = extracted.deploymentMetadata;
  manifest.rpcUrl = options.rpc_url;
  manifest.runtimeBytecodeHashes = captureRuntimeHashes(manifest, options.rpc_url);
  validateManifest(manifest, manifestPath);
  if (chainId === 31337) {
    for (const key of CONTRACT_KEYS) {
      if (normalize(manifest.contracts[key]) !== normalize(CANONICAL_ANVIL[key])) fail(`broadcast ${key} does not match canonical Anvil address`);
    }
  }
  return { chainId, manifest, manifestPath };
}

function generatedSource(manifests) {
  const data = Object.fromEntries(manifests.map((manifest) => [manifest.chainId, manifest]));
  return `// Generated by scripts/deployment-manifest.mjs. Do not edit by hand.\n` +
    `export const DEPLOYMENTS = ${JSON.stringify(data, null, 2)} as const;\n\n` +
    `export type DeploymentChainId = keyof typeof DEPLOYMENTS;\n` +
    `export type Deployment = (typeof DEPLOYMENTS)[DeploymentChainId];\n` +
    `export type DeploymentContracts = {\n` +
    `  readonly agentRegistry: \`0x\${string}\`;\n` +
    `  readonly reputationHub: \`0x\${string}\`;\n` +
    `  readonly guaranteeEscrow: \`0x\${string}\`;\n` +
    `  readonly schellingVoting: \`0x\${string}\`;\n` +
    `};\n`;
}

function expectAddress(actual, expected, label) {
  if (!ADDRESS_PATTERN.test(actual) || normalize(actual) !== normalize(expected)) fail(`${label}: expected ${expected}, got ${actual}`);
}

function expectUint(actual, expected, label) {
  const token = actual.split(/\s+/)[0];
  try {
    if (BigInt(token) !== BigInt(expected)) fail(`${label}: expected ${expected}, got ${actual}`);
  } catch {
    fail(`${label}: invalid uint result ${actual}`);
  }
}

function validateReceipt(manifest, key, rpcUrl) {
  const metadata = manifest.deploymentMetadata[key];
  if (!metadata.transactionHash) return;
  const receipt = castJson(rpcUrl, ["receipt", metadata.transactionHash]);
  if (receipt.transactionHash) {
    if (normalize(receipt.transactionHash) !== normalize(metadata.transactionHash)) fail(`${key} receipt transaction hash mismatch`);
  }
  if (receipt.contractAddress) expectAddress(receipt.contractAddress, manifest.contracts[key], `${key} receipt contractAddress`);
  if (metadata.deployer && receipt.from) expectAddress(receipt.from, metadata.deployer, `${key} receipt deployer`);
  if (metadata.blockNumber !== undefined) {
    const actual = blockNumber(receipt.blockNumber, `${key} live receipt blockNumber`);
    if (actual !== metadata.blockNumber) fail(`${key} receipt block expected ${metadata.blockNumber}, got ${actual}`);
  }
}

function validateRpc(manifest, rpcUrl) {
  if (manifest.status !== "deployed") fail(`chain ${manifest.chainId} is explicitly undeployed; RPC wiring validation is not possible`);
  const actualChainId = Number(cast(rpcUrl, ["chain-id"]));
  if (actualChainId !== manifest.chainId) fail(`RPC chain id ${actualChainId} does not match manifest ${manifest.chainId}`);
  const c = manifest.contracts;
  for (const [key, address] of Object.entries(c)) {
    const actualHash = normalize(cast(rpcUrl, ["codehash", address]));
    if (actualHash !== normalize(manifest.runtimeBytecodeHashes[key])) {
      fail(`${key} runtime bytecode hash expected ${manifest.runtimeBytecodeHashes[key]}, got ${actualHash}`);
    }
    validateReceipt(manifest, key, rpcUrl);
  }
  expectAddress(cast(rpcUrl, ["call", c.guaranteeEscrow, "registry()(address)"]), c.agentRegistry, "GuaranteeEscrow.registry");
  expectAddress(cast(rpcUrl, ["call", c.guaranteeEscrow, "hub()(address)"]), c.reputationHub, "GuaranteeEscrow.hub");
  expectAddress(cast(rpcUrl, ["call", c.schellingVoting, "escrow()(address)"]), c.guaranteeEscrow, "SchellingVoting.escrow");
  expectAddress(cast(rpcUrl, ["call", c.schellingVoting, "registry()(address)"]), c.agentRegistry, "SchellingVoting.registry");
  expectAddress(cast(rpcUrl, ["call", c.schellingVoting, "hub()(address)"]), c.reputationHub, "SchellingVoting.hub");
  expectAddress(cast(rpcUrl, ["call", c.guaranteeEscrow, "owner()(address)"]), c.schellingVoting, "GuaranteeEscrow.owner");
  if (cast(rpcUrl, ["call", c.reputationHub, "outcomeWriters(address)(bool)", c.guaranteeEscrow]) !== "true") fail("ReputationHub has not authorized GuaranteeEscrow");
  if (cast(rpcUrl, ["call", c.reputationHub, "jurorMetricWriters(address)(bool)", c.schellingVoting]) !== "true") fail("ReputationHub has not authorized SchellingVoting");
  expectUint(cast(rpcUrl, ["call", c.schellingVoting, "caseStake()(uint256)"]), manifest.votingParameters.caseStake, "SchellingVoting.caseStake");
  expectUint(cast(rpcUrl, ["call", c.schellingVoting, "commitWindow()(uint256)"]), manifest.votingParameters.commitWindow, "SchellingVoting.commitWindow");
  expectUint(cast(rpcUrl, ["call", c.schellingVoting, "revealWindow()(uint256)"]), manifest.votingParameters.revealWindow, "SchellingVoting.revealWindow");
  console.log(`validated runtime bytecode, deployment metadata, parameters, and wiring on chain ${manifest.chainId} via ${rpcUrl}`);
}

const options = parseArgs(process.argv.slice(2));
if (options.broadcast) {
  const candidate = candidateFromBroadcast(options);
  validateRpc(candidate.manifest, options.rpc_url);
  writeFileSync(candidate.manifestPath, `${JSON.stringify(candidate.manifest, null, 2)}\n`);
  console.log(`updated ${candidate.manifestPath} from one validated CREATE entry per named contract`);
}
const manifests = loadManifests();
const expected = generatedSource(manifests);

if (options.command === "generate") {
  writeFileSync(GENERATED_MODULE, expected);
  console.log(`generated ${GENERATED_MODULE}`);
} else {
  if (!existsSync(GENERATED_MODULE) || readFileSync(GENERATED_MODULE, "utf8") !== expected) {
    fail("generated frontend deployment module is stale; run: node scripts/deployment-manifest.mjs --write");
  }
  console.log("deployment manifests and generated frontend module are in sync");
}

if (options.rpc_url && !options.broadcast) {
  const chainId = Number(options.chain_id);
  const manifest = manifests.find((item) => item.chainId === chainId);
  if (!manifest) fail(`no manifest for chain ${chainId}`);
  validateRpc(manifest, options.rpc_url);
}
