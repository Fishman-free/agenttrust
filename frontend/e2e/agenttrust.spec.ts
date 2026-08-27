import { expect, test } from "@playwright/test";
import { DEPLOYMENTS } from "../lib/deployments";
import { resetAnvilAndDeploy } from "./anvil";
import { authenticateLocally, connectWallet, createDeliveredTrade, registerAgent, registerAgentVerified, selectAccount, waitForTransaction } from "./helpers";
import { increaseTime, installAnvilProvider } from "./provider";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installAnvilProvider(page);
  await authenticateLocally(page);
});

test("static export serves routes, a direct deep link, and a real 404", async ({ page, request }) => {
  for (const [route, heading] of [["/", "Verifiable trust for AI agents"], ["/agents/", "Agent registration"], ["/trade/", "Guaranteed trade lifecycle"], ["/disputes/", "Disputes and arbitration"], ["/reputation/", "Reputation profiles"]]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: new RegExp(heading) }).first()).toBeVisible();
  }
  const deepLink = await page.goto("/disputes/?tradeId=987654");
  expect(deepLink?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Disputes and arbitration" })).toBeVisible();
  const missing = await request.get("/definitely-not-a-route/");
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("This page could not be found");
});

test("anonymous deep links require authentication and restore their target after SIWE", async ({ page }) => {
  await page.goto("/trade/?tradeId=42");
  await page.getByRole("region", { name: "Authentication status" }).getByRole("button", { name: "Sign out" }).click();
  await page.goto("/disputes/?tradeId=42");
  await expect(page).toHaveURL(/\/login\/\?returnTo=%2Fdisputes%2F%3FtradeId%3D42/);
  await page.getByRole("button", { name: /^(Connect wallet and sign in|Sign in with connected wallet)$/ }).click();
  await expect(page).toHaveURL(/\/disputes\/\?tradeId=42$/);
  await expect(page.getByRole("heading", { name: "Disputes and arbitration" })).toBeVisible();
});

test("locale switch persists, updates html lang, and changes the documentation URL", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Verifiable trust for AI agents" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read usage docs" })).toHaveAttribute("href", /USAGE\.md$/);

  await page.getByRole("combobox", { name: "Language" }).selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "为智能体建立可验证的信任" })).toBeVisible();
  await expect(page.getByRole("link", { name: "阅读使用文档" })).toHaveAttribute("href", /USAGE\.zh-CN\.md$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("agenttrust.locale"))).toBe("zh-CN");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "为智能体建立可验证的信任" })).toBeVisible();
});

test("homepage stays compact, responsive, and accessible to reduced-motion users", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const heroBox = await page.locator(".home-hero").boundingBox();
  const capabilitiesBox = await page.locator(".home-capabilities").boundingBox();
  expect(heroBox?.height).toBeLessThan(700);
  expect(capabilitiesBox?.y).toBeLessThan(850);
  await expect(page.getByRole("link", { name: /Agent identity/ })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Explore agents/ })).toBeVisible();

  const logoBox = await page.getByRole("link", { name: "AgentTrust home" }).boundingBox();
  const badgeBox = await page.locator(".home-network-badge").boundingBox();
  expect(logoBox && badgeBox && logoBox.x + logoBox.width <= badgeBox.x).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("normal trade completes through the UI with three accounts, withdrawals, and reputation", async ({ page }) => {
  await resetAnvilAndDeploy();
  await page.goto("/agents/");
  await connectWallet(page);
  const ids = [
    await registerAgent(page, 0, "NormalBuyer"),
    await registerAgent(page, 1, "NormalSeller"),
    await registerAgentVerified(page, 2, "NormalGuarantor"),
  ];
  // 未验证用户看到风险警示，并可通过 bindPoH 升级为已验证身份
  await selectAccount(page, 0);
  await expect(page.getByText("Proof of Humanity (World ID) is not complete")).toBeVisible();
  await page.getByLabel("Bind nullifier (0x… 64 hex digits; any unused value on testnet)").fill(`0x${(200).toString(16).padStart(64, "0")}`);
  await page.getByRole("button", { name: "Bind PoH (upgrade to verified identity)" }).click();
  await waitForTransaction(page, "Humanity proof bound.");
  await expect(page.getByText(/Human verification:/)).toContainText("Verified (World ID)");
  const tradeId = await createDeliveredTrade(page, ids);
  await selectAccount(page, 0);
  await page.getByRole("button", { name: "Buyer confirms completion" }).click();
  await waitForTransaction(page, "Buyer confirms completion succeeded.");
  await expect(page.getByText(new RegExp(`Trade #${tradeId} · Released`))).toBeVisible();

  await selectAccount(page, 1);
  await expect(page.getByText("pendingWithdrawals:")).toContainText("0.0925 ETH");
  await page.getByRole("button", { name: "Withdraw all balance" }).click();
  await waitForTransaction(page, "Balance withdrawn to the current account.");
  await selectAccount(page, 2);
  await expect(page.getByText("pendingWithdrawals:")).toContainText("0.0825 ETH");
  await page.getByRole("button", { name: "Withdraw all balance" }).click();
  await waitForTransaction(page, "Balance withdrawn to the current account.");

  await page.getByRole("link", { name: "Reputation", exact: true }).click();
  await page.waitForURL(/\/reputation\/?$/);
  await page.getByLabel("Agent ID", { exact: true }).fill(ids[1]);
  await expect(page.getByRole("heading", { name: `Agent #${ids[1]}` })).toBeVisible();
  await expect(page.getByText("Completed trades").locator("..").getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("Reputation score (0–100; new agents start at 50)").locator("..").getByText("100", { exact: true })).toBeVisible();
});

test("disputed trade uses exact bond and six pre-registered identities through commit, reveal, settle, claim, withdraw, and metrics", async ({ page }) => {
  await resetAnvilAndDeploy();
  await page.goto("/agents/");
  await connectWallet(page);
  const ids: string[] = [];
  for (let index = 0; index < 8; index++) {
    ids.push(index < 2
      ? await registerAgent(page, index, `DisputeIdentity${index}`)
      : await registerAgentVerified(page, index, `DisputeIdentity${index}`));
  }
  const tradeId = await createDeliveredTrade(page, ids);

  await selectAccount(page, 0);
  await page.getByRole("link", { name: new RegExp(`Go to disputes.*Trade #${tradeId}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/disputes/?\\?tradeId=${tradeId}$`));
  await selectAccount(page, 0);
  await expect(page.getByLabel("Trade ID")).toHaveValue(tradeId);
  await expect(page.getByText("Exact dispute bond").locator("..")).toContainText("0.002 ETH");
  await page.getByRole("button", { name: "Pay exact bond and dispute" }).click();
  await waitForTransaction(page, "Dispute confirmed.");

  // 举证窗口：买方提交证据（裸摘要），卖方先标记"No evidence"，再提交自己的证据
  await page.getByLabel("Evidence CID or digest (0x…)").fill(`0x${"ab".repeat(32)}`);
  await page.getByLabel("Evidence summary").fill("E2E: delivery artifact missing");
  await page.getByRole("button", { name: "Submit evidence" }).click();
  await waitForTransaction(page, "Evidence submitted.");
  await expect(page.getByText("Buyer evidence", { exact: false }).locator("..")).toContainText("Submissions: 1");
  await expect(page.getByText("Seller evidence", { exact: false }).locator("..")).toContainText("No evidence");

  await selectAccount(page, 1);
  await page.getByLabel("Evidence CID or digest (0x…)").fill(`0x${"cd".repeat(32)}`);
  await page.getByLabel("Evidence summary").fill("E2E: on-time delivery record");
  await page.getByRole("button", { name: "Submit evidence" }).click();
  await waitForTransaction(page, "Evidence submitted.");
  await expect(page.getByText("Seller evidence", { exact: false }).locator("..")).toContainText("Submissions: 1");

  // 举证窗口（1 天）结束后方可开案
  await increaseTime(page, 86_401);
  await page.getByRole("button", { name: "openCase (callable by anyone)" }).click();
  await waitForTransaction(page, "Case opened and loaded automatically.");
  const caseId = await page.getByLabel("Case ID").inputValue();
  expect(caseId).toMatch(/^\d+$/);
  await expect(page.getByText("Trade case").locator("..")).toContainText(`Case #${caseId}`);
  await expect(page.getByText("Eligible Agent snapshot count").locator("..")).toContainText("8");
  await expect(page.getByText("Current immutable caseStake").locator("..")).toContainText("0.1 ETH");

  for (const [index, side] of [[3, "Buyer"], [4, "Buyer"]] as const) {
    await selectAccount(page, index);
    await page.getByRole("radio", { name: side }).check();
    await page.getByRole("button", { name: "Generate secret and submit commitment" }).click();
    await waitForTransaction(page, "Commitment confirmed; local secret marked committed.");
  }
  await expect(page.getByText("Committed", { exact: true }).first().locator("..")).toContainText("2");

  await increaseTime(page, 86_401);
  await expect(page.getByRole("button", { name: "Draw random jury" })).toBeEnabled();
  await page.getByRole("button", { name: "Draw random jury" }).click();
  await waitForTransaction(page, "Random jury drawn.");
  await expect(page.getByText("Randomly invited", { exact: true }).first().locator("..")).toContainText("3");

  for (const [index, side] of [[5, "Seller"], [6, "Buyer"], [7, "Buyer"]] as const) {
    await selectAccount(page, index);
    await expect(page.getByRole("button", { name: "Generate secret and submit commitment" })).toBeEnabled();
    await page.getByRole("radio", { name: side }).check();
    await page.getByRole("button", { name: "Generate secret and submit commitment" }).click();
    await waitForTransaction(page, "Commitment confirmed; local secret marked committed.");
  }
  await expect(page.getByText("Committed", { exact: true }).first().locator("..")).toContainText("5");

  await increaseTime(page, 86_401);
  await expect(page.getByText("Phase", { exact: true }).first().locator("..")).toContainText("Reveal");
  for (const index of [3, 4, 5, 6, 7]) {
    await selectAccount(page, index);
    await page.getByRole("button", { name: "Reveal with saved secret" }).click();
    await waitForTransaction(page, "Reveal confirmed; local secret marked revealed.");
  }
  await expect(page.getByText("Buyer votes", { exact: true }).locator("..")).toContainText("4");
  await expect(page.getByText("Seller votes", { exact: true }).locator("..")).toContainText("1");
  await increaseTime(page, 86_401);
  await expect(page.getByText("Phase", { exact: true }).first().locator("..")).toContainText("Awaiting settlement");
  await page.getByRole("button", { name: "Settle case" }).click();
  await waitForTransaction(page, "Case settled.");
  await expect(page.getByText("Effective ruling", { exact: true }).locator("..")).toContainText("Yes");
  await expect(page.getByText("Winning side", { exact: true }).locator("..")).toContainText("Buyer");

  await selectAccount(page, 5);
  await expect(page.getByText("Current account jurorStatus:").locator("..")).toContainText("side=Seller");
  const minorityClaim = page.getByRole("button", { name: "Claim" });
  await expect(minorityClaim).toBeDisabled();
  await expect(minorityClaim.locator("..")).toContainText("For an effective case, only winners or revealed abstentions can claim; losers and non-revealers are slashed.");
  const rejectedClaim = await page.evaluate(async ({ address, data }) => {
    const provider = (window as unknown as { ethereum: { request(request: unknown): Promise<unknown> } }).ethereum;
    try {
      const hash = await provider.request({ method: "eth_sendTransaction", params: [{ to: address, data }] }) as string;
      for (let attempt = 0; attempt < 50; attempt++) {
        const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }) as { status?: string } | null;
        if (receipt) return { rejected: receipt.status === "0x0", message: `receipt status ${receipt.status}` };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { rejected: false, message: "timed out waiting for rejected claim receipt" };
    } catch (error) {
      return { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
  }, {
    address: DEPLOYMENTS[31337].contracts.schellingVoting,
    // claim(uint256) selector followed by one ABI-encoded uint256 argument.
    data: `0x379607f5${BigInt(caseId).toString(16).padStart(64, "0")}`,
  });
  expect(rejectedClaim.rejected).toBe(true);
  expect(rejectedClaim.message).toMatch(/receipt status 0x0|revert|slashed/i);
  await expect(page.getByText(/^Pending withdrawal:/)).toContainText("0 ETH");

  for (const index of [3, 4, 6, 7]) {
    await selectAccount(page, index);
    await page.getByRole("button", { name: "Claim" }).click();
    await waitForTransaction(page, "Claim credited to pending withdrawals.");
    await expect(page.getByText(/^Pending withdrawal:/)).toContainText("0.125 ETH");
    await page.getByRole("button", { name: "Withdraw to current account" }).click();
    await waitForTransaction(page, "Balance withdrawn.");
  }
  for (const index of [3, 4, 5, 6, 7]) {
    await selectAccount(page, index);
    await page.getByRole("button", { name: "Finalize my juror metrics" }).click();
    await waitForTransaction(page, "Juror metrics finalized.");
  }

  await page.getByRole("link", { name: "Trade", exact: true }).click();
  await page.waitForURL(/\/trade\/?$/);
  await selectAccount(page, 0);
  await page.getByLabel("Trade ID").fill(tradeId);
  await expect(page.locator('[aria-current="step"]')).toContainText("RESOLVED");
  await expect(page.getByText(new RegExp(`Trade #${tradeId} · Resolved`))).toBeVisible();
  await expect(page.getByText("pendingWithdrawals:")).toContainText("0.177 ETH");
  await page.getByRole("button", { name: "Withdraw all balance" }).click();
  await waitForTransaction(page, "Balance withdrawn to the current account.");

  await page.getByRole("link", { name: "Reputation", exact: true }).click();
  await page.waitForURL(/\/reputation\/?$/);
  await page.getByLabel("Agent ID", { exact: true }).fill(ids[1]);
  await expect(page.getByText("Disputes lost").locator("..").getByText("1", { exact: true })).toBeVisible();
  await page.getByLabel("Agent ID", { exact: true }).fill(ids[3]);
  await expect(page.getByText("Finalized cases").locator("..").getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("Revealed votes").locator("..").getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("Consensus alignment", { exact: true }).locator("..")).toContainText("100.0%");
});
