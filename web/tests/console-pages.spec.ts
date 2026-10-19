import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Walkthrough of the running demo (./scripts/demo.sh) on the local FISCO BCOS network: the main
// flows once, then a 1920×1080 screenshot of every page. Opt-in, because it moves demo units on the
// demo chain:  E2E_CONSOLE_URL=http://localhost:3000 pnpm --filter web exec playwright test console-pages
const CONSOLE = process.env.E2E_CONSOLE_URL;
const directory = resolve(process.cwd(), "../docs/screenshots");

test.use({ viewport: { width: 1920, height: 1080 }, ...(CONSOLE ? { baseURL: CONSOLE } : {}) });
test.describe.configure({ mode: "serial", timeout: 300_000 });

async function shot(page: Page, name: string, { keepToasts = false } = {}) {
  mkdirSync(directory, { recursive: true });
  // Toasts from an earlier step can still be on screen; hide them unless they are the subject.
  const hidden = keepToasts ? undefined : await page.addStyleTag({ content: "[data-testid=toast] { display: none !important; }" });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(directory, `${name}.png`) });
  await hidden?.evaluate((element) => element.remove());
}

async function ask(page: Page, example: string) {
  await page.getByRole("button", { name: example, exact: true }).click();
  await expect(page.getByTestId("chat-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({ timeout: 60_000 });
}

test("runs the main flows on FISCO BCOS and captures every page", async ({ page }) => {
  test.skip(!CONSOLE, "Set E2E_CONSOLE_URL to the running console, e.g. http://localhost:3000");
  await page.goto("/#/agent");
  await expect(page.getByTestId("chain-badge")).toHaveText(/^FISCO BCOS · chain 1337 · block #\d+$/, { timeout: 30_000 });

  // 1. Pay 50 USD, then verify its receipt.
  await ask(page, "Pay Ana 50 USD");
  await expect(page.getByTestId("chat-summary")).toHaveText("Done. Paid 50 USD to Ana.");
  await page.getByText("Details: why, checks, and proof").click();
  await page.getByTestId("proof-verify").click();
  await expect(page.getByTestId("proof-receipt")).toContainText("Receipt success · block", { timeout: 30_000 });

  // 2. The two-step plan with an approval cap.
  await ask(page, "Pay Ana 50 USD, then move 200 CNY to savings, and ask me before anything above 300 USD");
  await expect(page.getByTestId("chat-summary")).toContainText("Plan ready: 2 steps, 2 checked");
  await page.getByTestId("plan-run").click();
  await expect(page.getByTestId("chat-summary")).toHaveText("Done. All 2 steps ran.", { timeout: 60_000 });
  await page.getByTestId("plan-step-S1").getByTestId("step-verify").click();
  await expect(page.getByTestId("plan-step-S1").getByTestId("step-receipt")).toContainText("Receipt success", { timeout: 30_000 });
  await shot(page, "ai-agent");

  // 3. A 600 USD payment is blocked by the per-payment limit.
  await ask(page, "Send Ana 600 USD");
  await expect(page.getByTestId("chat-summary")).toHaveText("Blocked: above your 500 USD per-payment limit.");
  await shot(page, "ai-agent-blocked");

  // 4. A 250 USD payment waits for approval; approve it after reviewing the card.
  await ask(page, "Pay Ana 250 USD");
  await expect(page.getByTestId("chat-summary")).toHaveText("Waiting for your approval because it is above your 200 USD approval limit.");
  await page.goto("/#/");
  await expect(page.getByTestId("glance-pending")).not.toContainText(/^0/);
  await shot(page, "home");
  await page.goto("/#/control");
  const card = page.locator("[data-testid^='pending-']").filter({ has: page.getByTestId("pending-why") }).first();
  await expect(card.getByTestId("pending-why")).toHaveText("It is above your 200 USD approval limit.");
  await shot(page, "control-center");
  const id = (await card.getAttribute("data-testid"))!.replace("pending-", "");
  await card.getByTestId(`approve-${id}`).click();
  await expect(page.getByTestId("toast")).toContainText("Approved and paid.", { timeout: 60_000 });
  await expect(page.getByTestId(`confirmed-${id}`)).toContainText("approved and paid · confirmed on chain");

  // 5. Pause (with confirmation) and resume.
  await page.getByTestId("kill-switch").click();
  await page.getByRole("dialog", { name: "Pause all AI payments?" }).getByRole("button", { name: "Pause everything" }).click();
  await expect(page.getByTestId("paused-banner")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("toast").filter({ hasText: "All AI payments are paused" })).toBeVisible();
  await shot(page, "paused", { keepToasts: true });
  await page.getByTestId("banner-resume").click();
  await expect(page.getByTestId("paused-banner")).toHaveCount(0, { timeout: 60_000 });

  await page.goto("/#/wallet");
  await expect(page.getByTestId("balance-card").first()).toBeVisible();
  await shot(page, "wallet");

  // 6. One attack, run on a fresh deployment.
  await page.goto("/#/attack-lab");
  await page.getByTestId("run-A1").click();
  await expect(page.getByTestId("attack-A1")).toContainText("Stopped by the AI firewall", { timeout: 120_000 });
  await shot(page, "attack-lab");

  // 7. Verify one exported hash against the node.
  await page.goto("/#/evidence");
  await page.getByRole("tab", { name: /Refused on-chain/ }).click();
  const refusal = page.getByTestId("group-refusals").locator("[data-testid^='tx-0x']").first();
  await refusal.getByTestId("tx-verify").click();
  await expect(refusal.getByTestId("tx-verify-result")).toContainText("Match", { timeout: 30_000 });
  await shot(page, "evidence-inspector");

  await page.goto("/#/evaluation");
  await expect(page.getByTestId("eval-verdict")).toBeVisible();
  await shot(page, "evaluation");
});
