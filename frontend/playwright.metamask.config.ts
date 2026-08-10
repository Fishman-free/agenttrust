import path from "node:path";
import { defineConfig } from "@playwright/test";

const frontendRoot = __dirname;
const smokeRoot = path.join(frontendRoot, "e2e-metamask");

export default defineConfig({
  testDir: path.join(smokeRoot, "specs"),
  outputDir: path.join(smokeRoot, ".artifacts", "test-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(smokeRoot, ".artifacts", "report"), open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    cwd: frontendRoot,
    env: { ...process.env, NEXT_PUBLIC_CHAIN: "anvil" },
    url: "http://127.0.0.1:3000/agents",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
