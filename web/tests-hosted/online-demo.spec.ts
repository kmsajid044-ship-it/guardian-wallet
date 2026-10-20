import { expect, test, type Page } from "@playwright/test";

/*
 * Hosted online demo, end to end against a running container (HOSTED_URL): real chain, real
 * transactions, every visitor acting as the demo owner. Run with:
 *   HOSTED_URL=https://<space>.hf.space pnpm --filter web exec playwright test -c playwright.hosted.config.ts
 * The chain label is read from the page, so the same spec checks a FISCO BCOS or an Anvil container.
 */
const fisco = process.env.HOSTED_BACKEND !== "evm-local";
const chainLabel = fisco ? "FISCO BCOS · online demo" : "private EVM development chain (Anvil)";

async function ask(page: Page, text: string, chip = false) {
  if (chip) await page.getByRole("button", { name: text, exact: true }).click();
  else { await page.getByLabel("What should your AI do?").fill(text); await page.getByLabel("What should your AI do?").press("Enter"); }
  await expect(page.getByTestId("chat-result")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({ timeout: 90_000 });
}

test.describe.configure({ mode: "serial" });

test("banner, chain pill, and CNY disclaimer on every page", async ({ page }) => {
  for (const route of ["/#/", "/#/activity", "/#/controls", "/#/security/attack-lab"]) {
    await page.goto(route);
    await expect(page.getByTestId("online-demo-text")).toHaveText(fisco
      ? "Online demo: a 4-node FISCO BCOS network running inside this container, operated by the team. Fresh chain on every restart. Recorded execution evidence is in the GitHub repo."
      : /private EVM development chain \(Anvil\)/, { timeout: 60_000 });
    await expect(page.getByTestId("online-demo-disclaimer")).toHaveText("Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.");
    await expect(page.getByTestId("demo-reset")).toBeVisible();
  }
  await expect(page.getByTestId("chain-badge")).toHaveText(new RegExp(`^${chainLabel.replace(/[()]/g, "\\$&")} · ${fisco ? 1337 : 31337} · #\\d+$`));
});

test("pay $50 and verify the receipt on the node", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByTestId("balance-card").first()).toBeVisible({ timeout: 60_000 });
  await ask(page, "Pay Ana $50", true);
  await expect(page.getByTestId("chat-summary")).toHaveText("Paid $50.00 to Ana");
  await page.getByTestId("view-proof").click();
  await page.getByTestId("proof-verify").click();
  await expect(page.getByTestId("proof-receipt")).toContainText("Receipt success · block", { timeout: 60_000 });
});

test("$250 waits for the owner and is paid after Approve", async ({ page }) => {
  await page.goto("/#/");
  await ask(page, "Pay Ana $250", true);
  await expect(page.getByTestId("chat-summary")).toHaveText("Needs your OK: $250.00 to Ana. It's above your $200 limit.");
  await page.getByTestId("receipt-approve").click();
  await expect(page.getByTestId("chat-summary")).toHaveText("Paid $250.00 to Ana", { timeout: 90_000 });
});

test("$600 is blocked by the per-payment limit", async ({ page }) => {
  await page.goto("/#/");
  await ask(page, "Send Ana $600");
  await expect(page.getByTestId("chat-summary")).toHaveText("Blocked: $600.00 is above your $500 limit.");
});

test("pause and resume as the demo owner", async ({ page }) => {
  await page.goto("/#/");
  await page.getByTestId("kill-switch").click();
  await page.getByRole("dialog", { name: "Pause AI?" }).getByRole("button", { name: "Pause AI" }).click();
  await expect(page.getByTestId("paused-banner")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("banner-resume").click();
  await expect(page.getByTestId("paused-banner")).toHaveCount(0, { timeout: 90_000 });
});

test("run all attacks: every one is blocked", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/#/security/attack-lab");
  await page.getByTestId("run-all-attacks").click();
  await expect(page.getByTestId("attack-summary")).toContainText(/(\d+) of \1 attacks blocked/, { timeout: 540_000 });
});

test("reset demo returns to a fresh deployment", async ({ page }) => {
  test.setTimeout(360_000);
  await page.goto("/#/");
  const before = await (await page.request.get("/fisco.json")).json() as { guardianWallet: string };
  await page.getByTestId("demo-reset").click();
  await expect(page.getByTestId("toast").first()).toContainText("Demo reset", { timeout: 300_000 });
  const after = await (await page.request.get("/fisco.json")).json() as { guardianWallet: string };
  expect(after.guardianWallet).not.toBe(before.guardianWallet);
  await expect(page.getByTestId("balance-amount").first()).toHaveText("$5,000.00", { timeout: 60_000 });
});
