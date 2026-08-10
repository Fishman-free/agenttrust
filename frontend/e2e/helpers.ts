import { expect, type Page } from "@playwright/test";
import { switchAccount } from "./provider";

const lastTransactionHash = new WeakMap<Page, string>();

export async function connectWallet(page: Page) {
  await page.getByRole("region", { name: "钱包状态" }).getByRole("button", { name: "连接钱包" }).click();
  await expect(page.getByRole("region", { name: "钱包状态" }).getByRole("button", { name: "断开" })).toBeVisible();
}

export async function selectAccount(page: Page, index: number) {
  await page.waitForLoadState("domcontentloaded");
  const address = await switchAccount(page, index);
  const connect = page.getByRole("region", { name: "钱包状态" }).getByRole("button", { name: "连接钱包" });
  if (await connect.isVisible()) await connect.click();
  await expect.poll(async () => (await page.locator(".wallet-value[title]").getAttribute("title"))?.toLowerCase()).toBe(address.toLowerCase());
  return address;
}

export async function waitForTransaction(page: Page, successText: string | RegExp) {
  const status = page.locator(".transaction-status");
  const previous = lastTransactionHash.get(page);
  await expect.poll(async () => {
    const hash = await status.locator("code").textContent().catch(() => null);
    return hash && hash !== previous ? hash : undefined;
  }, { timeout: 30_000 }).toBeTruthy();
  const hash = await status.locator("code").textContent();
  if (hash) lastTransactionHash.set(page, hash);
  await expect(status).toContainText(successText, { timeout: 30_000 });
  await expect(status).toContainText("区块：");
}

export async function registerAgent(page: Page, accountIndex: number, name: string) {
  await selectAccount(page, accountIndex);
  await page.getByLabel("智能体名称（如 DataAgent）").fill(name);
  await page.getByLabel("能力描述（如：链上数据分析服务）").fill(`${name} E2E capability`);
  await page.getByLabel("MCP/A2A 端点（https://…）").fill(`https://localhost/${name.toLowerCase()}`);
  await page.getByRole("button", { name: /^注册（注册费/ }).click();
  await waitForTransaction(page, /注册成功，新 Agent ID：\d+。/);
  const message = await page.locator(".transaction-status").innerText();
  const match = message.match(/Agent ID：(\d+)/);
  if (!match) throw new Error(`Could not parse AgentRegistered ID from UI: ${message}`);
  return match[1];
}

export async function createDeliveredTrade(page: Page, ids: string[]) {
  const [buyerId, sellerId, guarantorId] = ids;
  await page.getByRole("link", { name: "交易", exact: true }).click();
  await page.waitForURL(/\/trade\/?$/);
  await expect(page.getByRole("heading", { name: "担保交易闭环" })).toBeVisible();
  await selectAccount(page, 0);
  await page.getByLabel("买家 Agent ID").fill(buyerId);
  await page.getByLabel("卖家 Agent ID").fill(sellerId);
  await page.getByLabel("交易金额（ETH）").fill("0.1");
  await page.getByLabel("最高保费（ETH）").fill("0.01");
  await expect(page.getByLabel("担保条款预览")).toContainText("可承保是");
  await page.getByRole("button", { name: "创建交易" }).click();
  await waitForTransaction(page, /交易创建成功/);
  const tradeId = await page.getByLabel("Trade ID").inputValue();
  if (!/^\d+$/.test(tradeId)) throw new Error(`UI did not load event-generated Trade ID: ${tradeId}`);

  await selectAccount(page, 1);
  await page.getByRole("button", { name: "卖家接受交易" }).click();
  await waitForTransaction(page, "卖家接受交易成功。");
  await selectAccount(page, 0);
  await page.getByRole("button", { name: /买家托管/ }).click();
  await waitForTransaction(page, "买家托管 0.1 ETH成功。");
  await selectAccount(page, 2);
  await page.getByLabel("担保 Agent ID").fill(guarantorId);
  await page.getByLabel("覆盖率（%）").fill("75");
  await page.getByLabel("保费（ETH）", { exact: true }).fill("0.0075");
  await expect(page.getByText("requiredStake 链上精确值：")).toContainText("0.075 ETH");
  await page.getByRole("button", { name: /提供担保并质押 0\.075 ETH/ }).click();
  await waitForTransaction(page, "担保报价已确认。");
  await selectAccount(page, 1);
  await page.getByRole("button", { name: "卖家接受担保" }).click();
  await waitForTransaction(page, "卖家接受担保成功。");
  await page.getByRole("button", { name: "卖家确认交付" }).click();
  await waitForTransaction(page, "卖家确认交付成功。");
  return tradeId;
}
