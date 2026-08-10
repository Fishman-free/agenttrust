import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const RPC_URL = "http://127.0.0.1:8545";
export const CHAIN_ID = 31337;
export const FRONTEND_DIR = path.resolve(__dirname, "..");
export const ROOT_DIR = path.resolve(FRONTEND_DIR, "..");
export const CONTRACTS_DIR = path.join(ROOT_DIR, "contracts");
const STATE_DIR = path.join(FRONTEND_DIR, "test-results", ".anvil-e2e");
const PID_FILE = path.join(STATE_DIR, "pid");
const LOG_FILE = path.join(STATE_DIR, "anvil.log");
function findOnPath(binary: string) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory.replace(/^"|"$/g, ""), binary);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveFoundryBinary(envName: "ANVIL_BIN" | "FORGE_BIN", command: "anvil" | "forge") {
  const override = process.env[envName]?.trim();
  if (override) return override;
  const binary = process.platform === "win32" ? `${command}.exe` : command;
  const fromPath = findOnPath(binary);
  if (fromPath) return fromPath;
  if (process.platform === "win32" && process.env.USERPROFILE) {
    const foundryFallback = path.join(process.env.USERPROFILE, ".foundry", "bin", binary);
    if (existsSync(foundryFallback)) return foundryFallback;
  }
  return binary;
}

const ANVIL = resolveFoundryBinary("ANVIL_BIN", "anvil");
const FORGE = resolveFoundryBinary("FORGE_BIN", "forge");
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export async function rpc(method: string, params: unknown[] = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json() as { result?: unknown; error?: { message: string } };
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
  return payload.result;
}

async function waitForRpc(process: ChildProcess) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Anvil exited with code ${process.exitCode}`);
    try {
      if (await rpc("eth_chainId") === "0x7a69") return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for localhost Anvil on port 8545");
}

export async function startAnvil() {
  if (path.isAbsolute(ANVIL) && !existsSync(ANVIL)) throw new Error(`Anvil binary was not found at ${ANVIL}`);
  if (path.isAbsolute(FORGE) && !existsSync(FORGE)) throw new Error(`Forge binary was not found at ${FORGE}`);
  try {
    await rpc("eth_chainId");
    throw new Error("Port 8545 is already serving JSON-RPC; refusing to reuse or terminate an unrelated process");
  } catch (error) {
    if (error instanceof Error && error.message.includes("already serving")) throw error;
  }
  mkdirSync(STATE_DIR, { recursive: true });
  const log = openSync(LOG_FILE, "w");
  const child = spawn(ANVIL, ["--host", "127.0.0.1", "--port", "8545", "--chain-id", String(CHAIN_ID), "--silent"], {
    cwd: CONTRACTS_DIR,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  closeSync(log);
  writeFileSync(PID_FILE, String(child.pid));
  await waitForRpc(child);
}

export function deployContracts() {
  execFileSync(FORGE, ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", RPC_URL, "--broadcast", "--non-interactive"], {
    cwd: CONTRACTS_DIR,
    env: { ...process.env, PRIVATE_KEY: DEPLOYER_KEY },
    stdio: "pipe",
    timeout: 120_000,
  });
}

export async function resetAnvilAndDeploy() {
  await rpc("anvil_reset");
  deployContracts();
  const manifest = JSON.parse(readFileSync(path.join(ROOT_DIR, "deployments", "31337.json"), "utf8")) as { contracts: Record<string, string> };
  for (const [name, address] of Object.entries(manifest.contracts)) {
    const code = await rpc("eth_getCode", [address, "latest"]);
    if (code === "0x") throw new Error(`Deployment mismatch: ${name} has no code at manifest address ${address}`);
  }
}

export function stopAnvil() {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  if (Number.isInteger(pid)) {
    try { process.kill(pid); } catch {}
  }
  rmSync(PID_FILE, { force: true });
}
