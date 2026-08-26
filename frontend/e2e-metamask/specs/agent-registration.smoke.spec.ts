import { expect } from "@playwright/test";
import { testWithSynpress } from "@synthetixio/synpress";
import { metaMaskFixtures } from "@synthetixio/synpress/playwright";
import walletSetup, { ANVIL_NETWORK } from "../wallet-setup/anvil.setup";

const test = testWithSynpress(metaMaskFixtures(walletSetup));

test("connects MetaMask on Anvil and registers one local agent", async ({
  page,
  metamask,
  extensionId,
}) => {
  expect(extensionId).toBeTruthy();

  await metamask.switchNetwork(ANVIL_NETWORK.name);
  await page.goto("/agents");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await metamask.connectToDapp();

  await expect(page.getByText("Current responsible subject:")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.ethereum?.request({ method: "eth_chainId" })))
    .toBe("0x7a69");

  const uniqueName = `SynpressSmoke-${Date.now()}`;
  await page.getByLabel("Agent name (e.g. DataAgent)").fill(uniqueName);
  await page.getByLabel("Capability description (e.g. on-chain data analysis)").fill("Disposable local MetaMask smoke");
  await page.getByLabel("MCP/A2A endpoint (https://…)").fill("http://127.0.0.1:9999/smoke");
  await page.getByLabel("Guardian 1 (required)").fill("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  await page.getByLabel("Guardian 2 (required)").fill("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");

  await page.getByRole("button", { name: /^Register \(deposit/ }).click();
  await metamask.confirmTransaction();

  await expect(page.getByText(/Registration succeeded\. New Agent ID:/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(uniqueName)).toBeVisible();
});

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string }): Promise<unknown>;
    };
  }
}
