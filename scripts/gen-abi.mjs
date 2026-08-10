#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = join(ROOT, "frontend", "lib", "abi.ts");
const CONTRACTS = [
  ["AgentRegistry", "agentRegistryAbi"],
  ["ReputationHub", "reputationHubAbi"],
  ["GuaranteeEscrow", "guaranteeEscrowAbi"],
  ["SchellingVoting", "schellingVotingAbi"],
];
const TYPE_ORDER = new Map([
  ["constructor", 0],
  ["receive", 1],
  ["fallback", 2],
  ["function", 3],
  ["event", 4],
  ["error", 5],
]);

function fail(message) {
  console.error(`gen-abi: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length === 0) return { check: false };
  if (argv.length === 1 && argv[0] === "--check") return { check: true };
  fail("usage: node scripts/gen-abi.mjs [--check]");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalType(parameter) {
  if (!parameter.type.startsWith("tuple")) return parameter.type;
  const suffix = parameter.type.slice("tuple".length);
  return `(${parameter.components.map(canonicalType).join(",")})${suffix}`;
}

function entrySignature(entry) {
  const name = entry.name ?? entry.type;
  return `${name}(${(entry.inputs ?? []).map(canonicalType).join(",")})`;
}

function validateParameter(parameter, label, { eventInput = false } = {}) {
  if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) fail(`${label} must be an object`);
  if (typeof parameter.name !== "string") fail(`${label}.name must be a string`);
  if (typeof parameter.type !== "string" || parameter.type.length === 0) fail(`${label}.type must be a non-empty string`);
  if (parameter.internalType !== undefined && typeof parameter.internalType !== "string") fail(`${label}.internalType must be a string`);
  const isTuple = parameter.type.startsWith("tuple");
  if (isTuple && (!Array.isArray(parameter.components) || parameter.components.length === 0)) fail(`${label}.components must describe the tuple`);
  if (!isTuple && parameter.components !== undefined) fail(`${label}.components is only valid for tuple types`);
  parameter.components?.forEach((component, index) => validateParameter(component, `${label}.components[${index}]`));
  if (eventInput && typeof parameter.indexed !== "boolean") fail(`${label}.indexed must be a boolean`);
  if (!eventInput && parameter.indexed !== undefined) fail(`${label}.indexed is only valid for event inputs`);
}

function validateArtifact(artifact, artifactPath, contractName) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) fail(`${artifactPath}: artifact must be an object`);
  const target = artifact.metadata?.settings?.compilationTarget;
  if (!target || typeof target !== "object" || target[`src/${contractName}.sol`] !== contractName || Object.keys(target).length !== 1) {
    fail(`${artifactPath}: compilation target must be src/${contractName}.sol:${contractName}`);
  }
  if (!Array.isArray(artifact.abi) || artifact.abi.length === 0) fail(`${artifactPath}: abi must be a non-empty array`);
  artifact.abi.forEach((entry, index) => {
    const label = `${artifactPath}: abi[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${label} must be an object`);
    if (!TYPE_ORDER.has(entry.type)) fail(`${label}.type is unsupported: ${entry.type}`);
    if (["function", "event", "error"].includes(entry.type) && (typeof entry.name !== "string" || !entry.name)) fail(`${label}.name is required`);
    if (!Array.isArray(entry.inputs)) fail(`${label}.inputs must be an array`);
    entry.inputs.forEach((parameter, parameterIndex) => validateParameter(parameter, `${label}.inputs[${parameterIndex}]`, { eventInput: entry.type === "event" }));
    if (entry.type === "function") {
      if (!Array.isArray(entry.outputs)) fail(`${label}.outputs must be an array`);
      entry.outputs.forEach((parameter, parameterIndex) => validateParameter(parameter, `${label}.outputs[${parameterIndex}]`));
    }
    if (["function", "constructor", "fallback", "receive"].includes(entry.type) && typeof entry.stateMutability !== "string") fail(`${label}.stateMutability is required`);
    if (entry.type === "event" && typeof entry.anonymous !== "boolean") fail(`${label}.anonymous must be a boolean`);
  });
}

function normalizeParameter(parameter, eventInput = false) {
  const normalized = { name: parameter.name, type: parameter.type };
  if (parameter.internalType !== undefined) normalized.internalType = parameter.internalType;
  if (parameter.components !== undefined) normalized.components = parameter.components.map((component) => normalizeParameter(component));
  if (eventInput) normalized.indexed = parameter.indexed;
  return normalized;
}

function normalizeEntry(entry) {
  const normalized = { type: entry.type };
  if (entry.name !== undefined) normalized.name = entry.name;
  normalized.inputs = entry.inputs.map((parameter) => normalizeParameter(parameter, entry.type === "event"));
  if (entry.outputs !== undefined) normalized.outputs = entry.outputs.map((parameter) => normalizeParameter(parameter));
  if (entry.stateMutability !== undefined) normalized.stateMutability = entry.stateMutability;
  if (entry.anonymous !== undefined) normalized.anonymous = entry.anonymous;
  return normalized;
}

function readAbi(contractName) {
  const artifactPath = join(ROOT, "contracts", "out", `${contractName}.sol`, `${contractName}.json`);
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (error) {
    fail(`${artifactPath}: ${error.message}`);
  }
  validateArtifact(artifact, artifactPath, contractName);
  return artifact.abi.map(normalizeEntry).sort((left, right) => {
    const typeOrder = TYPE_ORDER.get(left.type) - TYPE_ORDER.get(right.type);
    return typeOrder || compareText(entrySignature(left), entrySignature(right)) || compareText(JSON.stringify(left), JSON.stringify(right));
  });
}

function generateSource() {
  const header = "// Generated by scripts/gen-abi.mjs from Foundry artifacts. Do not edit by hand.\n\n";
  return header + CONTRACTS.map(([contractName, exportName]) =>
    `export const ${exportName} = ${JSON.stringify(readAbi(contractName), null, 2)} as const;\n`,
  ).join("\n").replace(/\r\n?/g, "\n");
}

const options = parseArgs(process.argv.slice(2));
const expected = generateSource();
if (options.check) {
  if (!existsSync(OUTPUT_PATH) || readFileSync(OUTPUT_PATH, "utf8") !== expected) {
    fail("frontend/lib/abi.ts is stale; run: node scripts/gen-abi.mjs");
  }
  console.log("frontend ABI module is in sync with validated Foundry artifacts");
} else {
  writeFileSync(OUTPUT_PATH, expected, { encoding: "utf8" });
  console.log(`generated ${OUTPUT_PATH}`);
}
