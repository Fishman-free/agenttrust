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

  await page.getByRole("button", { name: "连接钱包" }).click();
  await metamask.connectToDapp();

  await expect(page.getByText("当前责任主体：")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.ethereum?.request({ method: "eth_chainId" })))
    .toBe("0x7a69");

  const uniqueName = `SynpressSmoke-${Date.now()}`;
  await page.getByLabel("智能体名称（如 DataAgent）").fill(uniqueName);
  await page.getByLabel("能力描述（如：链上数据分析服务）").fill("Disposable local MetaMask smoke");
  await page.getByLabel("MCP/A2A 端点（https://…）").fill("http://127.0.0.1:9999/smoke");

  await page.getByRole("button", { name: /^注册（注册费/ }).click();
  await metamask.confirmTransaction();

  await expect(page.getByText(/注册成功，新 Agent ID：/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(uniqueName)).toBeVisible();
});

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string }): Promise<unknown>;
    };
  }
}
