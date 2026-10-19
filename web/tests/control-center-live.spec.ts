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

test("approves and rejects real pending items from the Control Center", async ({ page, request }) => {
  await useLiveAgent(page, agent);
  await page.goto("/#/agent");
  await expect(page.getByTestId("chain-badge")).toHaveText(/^Local Anvil \(dev fallback\) · 31337 · #\d+$/);
  for (const amount of ["250", "260"]) {
    await page.getByLabel("Message the agent").fill(`Pay Ana ${amount} USD`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByTestId("chat-result")).toContainText("Needs your approval", { timeout: 30_000 });
  }

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Control Center" }).click();
  const first = page.getByTestId("pending-1");
  await expect(first.getByTestId("pending-why")).toHaveText("It is above your 200 USD approval limit.");
  await first.getByText("Details", { exact: true }).click();
  await expect(first.getByTestId("pending-amount")).toHaveText("250");
  await expect(first.getByTestId("pending-operation")).toHaveText("requestApproval");
  await expect(first.getByTestId("pending-recipient")).toHaveText("ana");
  await expect(first.getByTestId("pending-reasoning")).toHaveText("Pay contact ana");
  await expect(first.getByTestId("pending-risk")).toHaveText(/^\d+\/100$/);
  await expect(first.getByTestId("pending-rules")).toContainText("APPROVAL_THRESHOLD");

  const before = await blockHeight(request);
  await first.getByTestId("reject-1").click();
  await expect(page.getByTestId("confirmed-1")).toHaveText(/^Pending #1 rejected · confirmed on chain in block \d+ · 0x/, { timeout: 30_000 });
  const rejectedBlock = BigInt((await page.getByTestId("confirmed-1").innerText()).match(/block (\d+)/)![1]!);
  expect(rejectedBlock).toBeGreaterThan(before);
  await expect(page.getByTestId("pending-1")).toHaveCount(0, { timeout: 15_000 });

  await page.getByTestId("approve-2").click();
  await expect(page.getByTestId("confirmed-2")).toHaveText(/^Pending #2 approved and paid · confirmed on chain in block \d+ · 0x/, { timeout: 30_000 });
  await expect(page.getByTestId("approval-inbox")).toContainText("No approvals waiting", { timeout: 15_000 });
});
