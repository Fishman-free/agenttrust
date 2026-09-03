import { expect, type Page } from "@playwright/test";
import { switchAccount } from "./provider";

const lastTransactionHash = new WeakMap<Page, string>();

/** 钱包选择页：每次连接都必须先出现，然后在其中选定 E2E 模拟的 MetaMask。 */
export async function pickMetaMask(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /MetaMask/ }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

export async function authenticateLocally(page: Page) {
  await page.goto("/login/");
  await page.getByRole("button", { name: "Connect wallet and sign in" }).click();
  await pickMetaMask(page);
  await expect(page).toHaveURL(/\/agents\/?$/);
  await expect(page.getByRole("region", { name: "Authentication status" })).toBeVisible();
}

/** 从账户触发器读取完整地址（title 属性承载完整地址，供守护人字段复用）。 */
async function currentAccount(page: Page) {
  return (await page.locator(".account-trigger[title]").getAttribute("title"))?.toLowerCase();
}

export async function connectWallet(page: Page) {
  // 登录流程已连接钱包时（序列化 beforeEach 后常见），直接确认账户入口存在即可。
  // 未连接时：点页首「Connect wallet」（页面主体若还有同名按钮，取页首那个）→ 选择页 → MetaMask。
  const connect = page.getByRole("button", { name: "Connect wallet", exact: true }).first();
  if (await connect.isVisible()) {
    await connect.click();
    await pickMetaMask(page);
  }
  await expect(page.getByRole("button", { name: "Open account menu" })).toBeVisible();
}

export async function selectAccount(page: Page, index: number) {
  await page.waitForLoadState("domcontentloaded");
  const address = await switchAccount(page, index);
  const connect = page.getByRole("button", { name: "Connect wallet", exact: true }).first();
  if (await connect.isVisible()) {
    await connect.click();
    await pickMetaMask(page);
  }
  await expect.poll(async () => await currentAccount(page), { timeout: 15_000 }).toBe(address.toLowerCase());
  if (await page.locator(".binding-card").isVisible()) {
    await page.getByRole("region", { name: "Authentication status" }).getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login\//);
    await page.getByRole("button", { name: "Connect wallet and sign in" }).click();
    await pickMetaMask(page);
    await expect(page).not.toHaveURL(/\/login\//);
    await expect(page.getByRole("button", { name: "Open account menu" })).toBeVisible();
    await expect.poll(async () => await currentAccount(page)).toBe(address.toLowerCase());
    await expect(page.locator(".binding-card")).toBeHidden();
  }
  return address;
}

export async function waitForTransaction(page: Page, successText: string | RegExp) {
  const status = page.locator(".transaction-status");
  const previous = lastTransactionHash.get(page);
  await expect.poll(async () => {
    // 页面可能同时存在多个状态组件（注册 + 身份操作），取所有哈希并接受任一新哈希。
    const hashes = await status.locator("code").allTextContents().catch(() => []);
    return hashes.find((hash) => hash !== previous);
  }, { timeout: 30_000 }).toBeTruthy();
  const hashes = await status.locator("code").allTextContents();
  const hash = hashes.find((value) => value !== previous);
  if (hash) lastTransactionHash.set(page, hash);
  // 收窄到包含该新哈希的状态组件，避免多个状态组件触发 strict mode。
  const target = status.filter({ hasText: hash ?? "\u0000" });
  await expect(target).toContainText(successText, { timeout: 30_000 });
  await expect(target).toContainText("Block:");
}

export async function registerAgent(page: Page, accountIndex: number, name: string) {
  await fillRegistrationForm(page, accountIndex, name);
  await page.getByRole("button", { name: /^Register \(lock .* ETH; conditional return\)/ }).click();
  return await readRegisteredAgentId(page);
}

export async function registerAgentVerified(page: Page, accountIndex: number, name: string) {
  await fillRegistrationForm(page, accountIndex, name);
  await page.getByText("Labs", { exact: false }).first().click();
  await page.getByRole("checkbox", { name: /Register with World ID Proof of Humanity/ }).check();
  await page
    .getByLabel("World ID nullifier (0x… 64 digits)")
    .fill(`0x${(accountIndex + 100).toString(16).padStart(64, "0")}`);
  await page.getByRole("button", { name: /^Register \(lock .* ETH; conditional return\)/ }).click();
  return await readRegisteredAgentId(page);
}

async function fillRegistrationForm(page: Page, accountIndex: number, name: string) {
  await selectAccount(page, 8);
  const guardianA = (await page.locator(".account-trigger[title]").getAttribute("title"))!;
  await selectAccount(page, 9);
  const guardianB = (await page.locator(".account-trigger[title]").getAttribute("title"))!;
  await selectAccount(page, accountIndex);
  await page.getByLabel("Agent name (e.g. DataAgent)").fill(name);
  await page.getByLabel("Capability description (e.g. on-chain data analysis)").fill(`${name} E2E capability`);
  // 端点注册后永久不可改，前端会拒绝 localhost / 内网地址，E2E 必须用合法的公网 https 形式。
  await page.getByLabel("MCP/A2A endpoint (https://…)").fill(`https://${name.toLowerCase()}.example.com/mcp`);
  await page.getByLabel("Guardian 1 (required)").fill(guardianA);
  await page.getByLabel("Guardian 2 (required)").fill(guardianB);
}

async function readRegisteredAgentId(page: Page) {
  await waitForTransaction(page, /Registration succeeded. New Agent ID: \d+\./);
  const message = await page.locator(".transaction-status").innerText();
  const match = message.match(/Agent ID: (\d+)/);
  if (!match) throw new Error(`Could not parse AgentRegistered ID from UI: ${message}`);
  return match[1];
}

export async function createDeliveredTrade(page: Page, ids: string[]) {
  const [buyerId, sellerId, guarantorId] = ids;
  await page.getByRole("link", { name: "Trade", exact: true }).click();
  await page.waitForURL(/\/trade\/?$/);
  await expect(page.getByRole("heading", { name: "Guaranteed trade lifecycle" })).toBeVisible();
  await selectAccount(page, 0);
  await page.getByLabel("Buyer Agent ID").fill(buyerId);
  await page.getByLabel("Seller Agent ID").fill(sellerId);
  await page.getByLabel("Trade amount (ETH)").fill("0.1");
  await page.getByLabel("Maximum premium (ETH)").fill("0.01");
  await expect(page.getByLabel("Guarantee terms preview")).toContainText("InsurableYes");
  await page.getByRole("button", { name: "Create trade" }).click();
  await waitForTransaction(page, /Trade created/);
  const tradeId = await page.getByLabel("Trade ID").inputValue();
  if (!/^\d+$/.test(tradeId)) throw new Error(`UI did not load event-generated Trade ID: ${tradeId}`);

  await selectAccount(page, 1);
  await page.getByRole("button", { name: "Seller accepts trade" }).click();
  await waitForTransaction(page, "Seller accepts trade succeeded.");
  await selectAccount(page, 0);
  await page.getByRole("button", { name: /Buyer escrows/ }).click();
  await waitForTransaction(page, "Buyer escrows 0.1 ETH succeeded.");
  await selectAccount(page, 2);
  await page.getByLabel("Guarantor Agent ID").fill(guarantorId);
  await page.getByLabel("Coverage (%)").fill("75");
  await page.getByLabel("Premium (ETH)", { exact: true }).fill("0.0075");
  await expect(page.getByText("requiredStake exact on-chain value:")).toContainText("0.075 ETH");
  await page.getByRole("button", { name: /Offer guarantee and stake 0.075 ETH/ }).click();
  await waitForTransaction(page, "Guarantee quote confirmed.");
  await expect(page.getByText(/Remaining guarantee capacity for current account:/)).toContainText("4.925 ETH");
  await selectAccount(page, 1);
  await page.getByRole("button", { name: "Seller accepts guarantee" }).click();
  await waitForTransaction(page, "Seller accepts guarantee succeeded.");
  await page.getByRole("button", { name: "Seller marks delivered" }).click();
  await waitForTransaction(page, "Seller marks delivered succeeded.");
  return tradeId;
}
