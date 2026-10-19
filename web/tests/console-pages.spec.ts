import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startLiveAgent, useLiveAgent, type LiveAgent } from "./live-agent";

// Screenshots of every console page from the real agent connected to the local FISCO BCOS network
// (./scripts/chain-up.sh), with a throwaway audit log. The one pending item created here is
// rejected again, so no demo units move. Skipped when the network is not running.
const POSITIONING = "Guardian Wallet: a trust and control layer for autonomous AI finance. Let AI handle your financial tasks, without giving up control of your money.";
const directory = resolve(process.cwd(), "../docs/screenshots");
let agent: LiveAgent | undefined;
let fiscoUp = false;

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.beforeAll(async ({ request }) => {
  const node = await request.post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }, failOnStatusCode: false }).catch(() => undefined);
  fiscoUp = Boolean(node?.ok());
  if (fiscoUp) agent = await startLiveAgent("fisco");
});
test.afterAll(async () => { await agent?.stop(); });

async function shot(page: Page, name: string) {
  mkdirSync(directory, { recursive: true });
  await page.addStyleTag({ content: "header { position: static !important; }" });
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
}

test("captures every console page on FISCO BCOS", async ({ page }) => {
  test.skip(!fiscoUp, "Local FISCO BCOS network is not running; start it with ./scripts/chain-up.sh");
  await useLiveAgent(page, agent!);
  await page.goto("/");
  await expect(page.getByTestId("chain-badge")).toHaveText(/^FISCO BCOS · chain 1337 · block \d+$/, { timeout: 15_000 });
  await expect(page.getByTestId("positioning")).toHaveText(POSITIONING);
  await page.getByLabel("Message the agent").fill("Pay Ana 250 USD");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-result")).toContainText("NEEDS APPROVAL", { timeout: 60_000 });
  await shot(page, "ai-agent");

  await page.goto("/#/wallet");
  await expect(page.getByTestId("balance-card").first().getByTestId("demo-balance")).toHaveText("DEMO BALANCE");
  await shot(page, "wallet");

  await page.goto("/#/control");
  const card = page.locator("[data-testid^='pending-']").filter({ has: page.getByTestId("pending-reasoning") }).filter({ hasText: "Pay contact ana" }).first();
  await expect(card.getByTestId("pending-amount")).toHaveText("250");
  await shot(page, "control-center");
  // Leave the demo wallet as it was: reject the item created above, confirmed on chain.
  const id = (await card.getAttribute("data-testid"))!.replace("pending-", "");
  await card.getByTestId(`reject-${id}`).click();
  await expect(page.getByTestId(`confirmed-${id}`)).toContainText("rejected · confirmed on chain", { timeout: 60_000 });

  await page.goto("/#/attack-lab");
  await expect(page.getByRole("heading", { name: "Attack Lab" })).toBeVisible();
  await shot(page, "attack-lab");

  await page.goto("/#/evidence");
  const refusal = page.getByTestId("group-refusals").locator("[data-testid^='tx-0x']").first();
  await refusal.getByTestId("tx-verify").click();
  await expect(refusal.getByTestId("tx-verify-result")).toContainText("Match", { timeout: 30_000 });
  await shot(page, "evidence-inspector");

  await page.goto("/#/evaluation");
  await expect(page.getByTestId("eval-verdict")).toBeVisible();
  await shot(page, "evaluation");
});
