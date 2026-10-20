import { expect, test } from "@playwright/test";
import { startLiveAgent, useLiveAgent, type LiveAgent } from "./live-agent";

// Real agent on a fresh local Anvil chain: pending items are created by the pipeline and decided
// with real owner transactions. Success appears only after the chain confirms.
let agent: LiveAgent;
test.describe.configure({ mode: "serial", timeout: 120_000 });
test.beforeAll(async () => { agent = await startLiveAgent(); });
test.afterAll(async () => { await agent?.stop(); });

async function blockHeight(request: import("@playwright/test").APIRequestContext): Promise<bigint> {
  const response = await request.post(agent.rpcUrl, { data: { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] } });
  return BigInt((await response.json() as { result: string }).result);
}

test("approves and declines real pending items from Home", async ({ page, request }) => {
  await useLiveAgent(page, agent);
  await page.goto("/#/");
  await expect(page.getByTestId("chain-badge")).toHaveText(/^Local Anvil \(dev fallback\) · 31337 · #\d+$/);
  for (const amount of ["250", "260"]) {
    await page.getByLabel("What should your AI do?").fill(`Pay Ana $${amount}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByTestId("chat-summary")).toHaveText(`Needs your OK: $${amount}.00 to Ana. It's above your $200 limit.`, { timeout: 30_000 });
  }

  const first = page.getByTestId("pending-1");
  await expect(first.getByTestId("pending-sentence")).toHaveText("$250.00 to Ana");
  await expect(first.getByTestId("pending-why")).toContainText("It's above your $200 limit.");
  await page.getByTestId("tech-switch").click();
  await expect(first.getByTestId("pending-amount")).toHaveText("250");
  await expect(first.getByTestId("pending-operation")).toHaveText("requestApproval");
  await expect(first.getByTestId("pending-recipient")).toHaveText("ana");
  await expect(first.getByTestId("pending-reasoning")).toHaveText("Pay contact ana");
  await expect(first.getByTestId("pending-risk")).toHaveText(/^\d+\/100$/);
  await expect(first.getByTestId("pending-rules")).toContainText("APPROVAL_THRESHOLD");

  const before = await blockHeight(request);
  await first.getByTestId("reject-1").click();
  await expect(page.getByTestId("confirmed-1")).toHaveText(/^Request #1 declined · confirmed on chain in block \d+$/, { timeout: 30_000 });
  const declinedBlock = BigInt((await page.getByTestId("confirmed-1").innerText()).match(/block (\d+)/)![1]!);
  expect(declinedBlock).toBeGreaterThan(before);
  await expect(page.getByTestId("pending-1")).toHaveCount(0, { timeout: 15_000 });

  await page.getByTestId("approve-2").click();
  await expect(page.getByTestId("confirmed-2")).toHaveText(/^Request #2 approved and paid · confirmed on chain in block \d+$/, { timeout: 30_000 });
  await expect(page.getByTestId("pending-2")).toHaveCount(0, { timeout: 15_000 });
});
