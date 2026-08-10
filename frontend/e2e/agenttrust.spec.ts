import { expect, test } from "@playwright/test";
import { DEPLOYMENTS } from "../lib/deployments";
import { resetAnvilAndDeploy } from "./anvil";
import { connectWallet, createDeliveredTrade, registerAgent, selectAccount, waitForTransaction } from "./helpers";
import { increaseTime, installAnvilProvider } from "./provider";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installAnvilProvider(page);
});

test("static export serves routes, a direct deep link, and a real 404", async ({ page, request }) => {
  for (const [route, heading] of [["/", "为智能体建立"], ["/agents/", "智能体注册"], ["/trade/", "担保交易闭环"], ["/disputes/", "争议与裁决"], ["/reputation/", "信誉档案"]]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: new RegExp(heading) }).first()).toBeVisible();
  }
  const deepLink = await page.goto("/disputes/?tradeId=987654");
  expect(deepLink?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "争议与裁决" })).toBeVisible();
  const missing = await request.get("/definitely-not-a-route/");
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("This page could not be found");
});

test("normal trade completes through the UI with three accounts, withdrawals, and reputation", async ({ page }) => {
  await resetAnvilAndDeploy();
  await page.goto("/agents/");
  await connectWallet(page);
  const ids = [
    await registerAgent(page, 0, "NormalBuyer"),
    await registerAgent(page, 1, "NormalSeller"),
    await registerAgent(page, 2, "NormalGuarantor"),
  ];
  const tradeId = await createDeliveredTrade(page, ids);
  await selectAccount(page, 0);
  await page.getByRole("button", { name: "买家确认完成" }).click();
  await waitForTransaction(page, "买家确认完成成功。");
  await expect(page.getByText(new RegExp(`Trade #${tradeId} · 已放款`))).toBeVisible();

  await selectAccount(page, 1);
  await expect(page.getByText("pendingWithdrawals：")).toContainText("0.0925 ETH");
  await page.getByRole("button", { name: "提取全部余额" }).click();
  await waitForTransaction(page, "余额已提取到当前账户。");
  await selectAccount(page, 2);
  await expect(page.getByText("pendingWithdrawals：")).toContainText("0.0825 ETH");
  await page.getByRole("button", { name: "提取全部余额" }).click();
  await waitForTransaction(page, "余额已提取到当前账户。");

  await page.getByRole("link", { name: "信誉", exact: true }).click();
  await page.waitForURL(/\/reputation\/?$/);
  await page.getByLabel("Agent ID", { exact: true }).fill(ids[1]);
  await expect(page.getByRole("heading", { name: `Agent #${ids[1]}` })).toBeVisible();
  await expect(page.getByText("完成交易").locator("..").getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("信誉分（0-100，新智能体默认 50）").locator("..").getByText("100", { exact: true })).toBeVisible();
});

test("disputed trade uses exact bond and six pre-registered identities through commit, reveal, settle, claim, withdraw, and metrics", async ({ page }) => {
  await resetAnvilAndDeploy();
  await page.goto("/agents/");
  await connectWallet(page);
  const ids: string[] = [];
  for (let index = 0; index < 6; index++) ids.push(await registerAgent(page, index, `DisputeIdentity${index}`));
  const tradeId = await createDeliveredTrade(page, ids);

  await selectAccount(page, 0);
  await page.getByRole("link", { name: new RegExp(`前往争议页.*Trade #${tradeId}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/disputes/?\\?tradeId=${tradeId}$`));
  await selectAccount(page, 0);
  await expect(page.getByLabel("Trade ID")).toHaveValue(tradeId);
  await expect(page.getByText("精确争议保证金").locator("..")).toContainText("0.002 ETH");
  await page.getByRole("button", { name: "支付精确保证金并发起争议" }).click();
  await waitForTransaction(page, "争议已确认。");
  await page.getByRole("button", { name: "openCase（任何人可调用）" }).click();
  await waitForTransaction(page, "案件已开设并自动载入。");
  const caseId = await page.getByLabel("Case ID").inputValue();
  expect(caseId).toMatch(/^\d+$/);
  await expect(page.getByText("交易案件").locator("..")).toContainText(`Case #${caseId}`);
  await expect(page.getByText("资格快照 Agent 数").locator("..")).toContainText("6");
  await expect(page.getByText("当前不可变 caseStake").locator("..")).toContainText("0.1 ETH");

  for (const [index, side] of [[3, "买家"], [4, "买家"], [5, "卖家"]] as const) {
    await selectAccount(page, index);
    await page.getByRole("radio", { name: side }).check();
    await page.getByRole("button", { name: "生成秘密并提交承诺" }).click();
    await waitForTransaction(page, "承诺已确认，本地秘密已标记为 committed。");
  }
  await expect(page.getByText("已提交", { exact: true }).first().locator("..")).toContainText("3");
  await increaseTime(page, 86_401);
  await expect(page.getByText("阶段", { exact: true }).first().locator("..")).toContainText("揭示");
  for (const index of [3, 4, 5]) {
    await selectAccount(page, index);
    await page.getByRole("button", { name: "用已保存秘密揭示" }).click();
    await waitForTransaction(page, "揭示已确认，本地秘密已标记为 revealed。");
  }
  await expect(page.getByText("买家票", { exact: true }).locator("..")).toContainText("2");
  await expect(page.getByText("卖家票", { exact: true }).locator("..")).toContainText("1");
  await increaseTime(page, 86_401);
  await expect(page.getByText("阶段", { exact: true }).first().locator("..")).toContainText("待结算");
  await page.getByRole("button", { name: "结算案件" }).click();
  await waitForTransaction(page, "案件已结算。");
  await expect(page.getByText("有效裁决", { exact: true }).locator("..")).toContainText("是");
  await expect(page.getByText("胜方", { exact: true }).locator("..")).toContainText("买家");

  await selectAccount(page, 5);
  await expect(page.getByText("当前账户 jurorStatus：").locator("..")).toContainText("side=卖家");
  const minorityClaim = page.getByRole("button", { name: "统一领取 claim" });
  await expect(minorityClaim).toBeDisabled();
  await expect(minorityClaim.locator("..")).toContainText("有效案件仅胜方或已揭示的弃权票可领取；败方和未揭示者会被罚没。");
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
  expect(rejectedClaim.message).toMatch(/receipt status 0x0|revert|罚没/i);
  await expect(page.getByText("待提取余额：")).toContainText("0 ETH");

  for (const index of [3, 4]) {
    await selectAccount(page, index);
    await page.getByRole("button", { name: "统一领取 claim" }).click();
    await waitForTransaction(page, "领取已记入待提取余额。");
    await expect(page.getByText("待提取余额：")).toContainText("0.15 ETH");
    await page.getByRole("button", { name: "提取到当前账户" }).click();
    await waitForTransaction(page, "余额已提取。");
  }
  for (const index of [3, 4, 5]) {
    await selectAccount(page, index);
    await page.getByRole("button", { name: "固化我的陪审员指标" }).click();
    await waitForTransaction(page, "陪审员指标已固化。");
  }

  await page.getByRole("link", { name: "交易", exact: true }).click();
  await page.waitForURL(/\/trade\/?$/);
  await selectAccount(page, 0);
  await page.getByLabel("Trade ID").fill(tradeId);
  await expect(page.locator('[aria-current="step"]')).toContainText("RESOLVED");
  await expect(page.getByText(new RegExp(`Trade #${tradeId} · 已裁决`))).toBeVisible();
  await expect(page.getByText("pendingWithdrawals：")).toContainText("0.177 ETH");
  await page.getByRole("button", { name: "提取全部余额" }).click();
  await waitForTransaction(page, "余额已提取到当前账户。");

  await page.getByRole("link", { name: "信誉", exact: true }).click();
  await page.waitForURL(/\/reputation\/?$/);
  await page.getByLabel("Agent ID", { exact: true }).fill(ids[1]);
  await expect(page.getByText("争议败诉").locator("..").getByText("1", { exact: true })).toBeVisible();
  await page.getByLabel("Agent ID", { exact: true }).fill(ids[3]);
  await expect(page.getByText("已结案样本").locator("..").getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("已揭示投票").locator("..").getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("共识一致率").locator("..")).toContainText("100.0%");
});
