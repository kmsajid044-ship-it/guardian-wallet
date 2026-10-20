import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { startLiveAgent, useLiveAgent, type LiveAgent } from "./live-agent";

// End to end against the real agent API on a fresh local Anvil chain: nothing here is mocked.
// The page keeps its usual agent URL; the browser's requests are redirected to the live server.
const TARGET = "Pay Ana 50 USD, then move 200 CNY to savings, and ask me before anything above 300 USD.";
const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";

let agent: LiveAgent;
let rpcUrl = "";

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.beforeAll(async () => { agent = await startLiveAgent(); rpcUrl = agent.rpcUrl; });
test.afterAll(async () => { await agent?.stop(); });

test("runs the pay, save, and approval-cap request as a plan with real receipts", async ({ page, request }) => {
  await useLiveAgent(page, agent);
  await page.goto("/#/");
  await page.getByTestId("tech-switch").click();
  await page.getByLabel("What should your AI do?").fill(TARGET);
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const plan = page.getByTestId("plan-view");
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await expect(plan.getByTestId("plan-status")).toHaveText("Ready to run");
  await expect(plan.getByTestId("plan-status-code")).toHaveText("DRAFT");
  await expect(plan.getByTestId("plan-cap")).toHaveText("Ask the owner before anything above 300 USD");
  const first = page.getByTestId("plan-step-S1");
  const second = page.getByTestId("plan-step-S2");
  for (const [step, operation, recipient, amount, currency] of [[first, "pay", "ana", "50", "USD"], [second, "saveToSavings", "Own savings", "200", "CNY"]] as const) {
    await expect(step.getByTestId("step-state")).toHaveText("Checked");
    await expect(step.getByTestId("step-state-code")).toHaveText("VALIDATED");
    await expect(step.getByTestId("step-operation")).toHaveText(operation);
    await expect(step.getByTestId("step-recipient")).toHaveText(recipient);
    await expect(step.getByTestId("step-amount")).toHaveText(amount);
    await expect(step.getByTestId("step-currency")).toHaveText(currency);
    await expect(step.getByTestId("step-tier")).toHaveText("AI can do alone");
    await expect(step.getByTestId("step-tier-code")).toHaveText("T1");
    await expect(step.getByTestId("step-risk")).toHaveText(/^\d+\/100$/);
    // Validation signs nothing, so no transaction is shown yet.
    await expect(step.getByTestId("step-tx")).toHaveCount(0);
  }
  await expect(plan.getByTestId("currency-disclaimer")).toHaveText(CNY_DISCLAIMER);

  await page.getByTestId("plan-run").click();
  await expect(plan.getByTestId("plan-status")).toHaveText("Done", { timeout: 60_000 });
  await expect(plan.getByTestId("plan-status-code")).toHaveText("COMPLETED");
  await expect(page.getByTestId("chat-summary")).toHaveText("Done: all 2 steps.");
  for (const step of [first, second]) {
    await expect(step.getByTestId("step-state")).toHaveText("Done");
    await expect(step.getByTestId("step-state-code")).toHaveText("EXECUTED");
    await expect(step.getByTestId("step-block")).toHaveText(/^\d+$/);
    // The hash on screen is a real transaction: the node returns its receipt in the same block.
    const hash = await step.getByTestId("step-tx").getAttribute("title");
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    const node = await request.post(rpcUrl, { data: { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] } });
    const receipt = (await node.json() as { result: { status: string; blockNumber: string } | null }).result;
    expect(receipt?.status).toBe("0x1");
    const block = await step.getByTestId("step-block").textContent();
    expect(BigInt(receipt!.blockNumber).toString()).toBe(block);
    await step.getByTestId("step-verify").click();
    await expect(step.getByTestId("step-receipt")).toHaveText(`Receipt success · block ${block}`);
  }

  const directory = resolve(process.cwd(), "../docs/screenshots");
  mkdirSync(directory, { recursive: true });
  // The sticky header would cover the top of the card in an element capture.
  await page.addStyleTag({ content: "header { position: static !important; }" });
  await page.locator("section.card", { has: plan }).screenshot({ path: resolve(directory, "plan-view.png") });
});
