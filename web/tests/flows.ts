import { expect, type Page } from "@playwright/test";

/*
 * The main owner flows against the running demo on the local FISCO BCOS network, shared by the
 * opt-in walkthroughs (console-pages.spec.ts headless, glass-walkthrough.spec.ts with effects on).
 * They move demo units: $50 paid, $250 approved; the $600 payment is refused by the contract.
 * `shot` is called at each point worth a screenshot.
 */
export type Shot = (page: Page, name: string) => Promise<void>;

async function ask(page: Page, text: string, chip = false) {
  if (chip) await page.getByRole("button", { name: text, exact: true }).click();
  else { await page.getByLabel("What should your AI do?").fill(text); await page.getByLabel("What should your AI do?").press("Enter"); }
  await expect(page.getByTestId("chat-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({ timeout: 60_000 });
}

export async function mainFlows(page: Page, shot: Shot) {
  await page.goto("/#/");
  await expect(page.getByTestId("chain-badge")).toHaveText(/^FISCO BCOS · 1337 · #\d+$/, { timeout: 30_000 });
  await expect(page.getByTestId("balance-card").first()).toBeVisible();

  // 1. Pay $50, then View proof and verify it on the node.
  await ask(page, "Pay Ana $50", true);
  await expect(page.getByTestId("chat-summary")).toHaveText("Paid $50.00 to Ana");
  await page.getByTestId("view-proof").click();
  await page.getByTestId("proof-verify").click();
  await expect(page.getByTestId("proof-receipt")).toContainText("Receipt success · block", { timeout: 30_000 });
  await shot(page, "home-done");

  // 2. $250 waits for your OK; approve it right on the receipt.
  await ask(page, "Pay Ana $250", true);
  await expect(page.getByTestId("chat-summary")).toHaveText("Needs your OK: $250.00 to Ana. It's above your $200 limit.");
  await expect(page.getByText("Waiting for your OK")).toBeVisible();
  await shot(page, "home-approval");
  await page.getByTestId("receipt-approve").click();
  await expect(page.getByTestId("chat-summary")).toHaveText("Paid $250.00 to Ana", { timeout: 60_000 });
  await expect(page.getByTestId("toast").first()).toContainText("Approved and paid.");

  // 3. $600 is refused by the per-payment limit.
  await ask(page, "Send Ana $600");
  await expect(page.getByTestId("chat-summary")).toHaveText("Blocked: $600.00 is above your $500 limit.");
  await shot(page, "home-blocked");

  // 4. "Pay someone": the AI asks who, with the contacts as chips.
  await ask(page, "Pay someone");
  await expect(page.getByTestId("chat-summary")).toHaveText("Who should I pay?");
  await shot(page, "home-question");
  await page.getByTestId("ask-contact-ana").click();
  await expect(page.getByTestId("chat-summary")).toContainText("Ana", { timeout: 60_000 });

  // 5. Pause (with confirmation) and resume.
  await page.getByTestId("kill-switch").click();
  await page.getByRole("dialog", { name: "Pause AI?" }).getByRole("button", { name: "Pause AI" }).click();
  await expect(page.getByTestId("paused-banner")).toBeVisible({ timeout: 60_000 });
  await shot(page, "paused");
  await page.getByTestId("banner-resume").click();
  await expect(page.getByTestId("paused-banner")).toHaveCount(0, { timeout: 60_000 });

  // 6. Activity and Controls.
  await page.goto("/#/activity");
  await page.locator("[data-testid^='why-toggle-']").first().click();
  await shot(page, "activity");
  await page.goto("/#/controls");
  await expect(page.getByLabel("Most per payment")).toBeVisible();
  await shot(page, "controls");

  // 7. One attack in Security.
  await page.goto("/#/security/attack-lab");
  await page.getByTestId("run-A1").click();
  await expect(page.getByTestId("attack-A1")).toContainText("Stopped by the AI firewall", { timeout: 120_000 });
  await shot(page, "security-attack-lab");

  // 8. Verify one exported hash against the node.
  await page.goto("/#/security/evidence");
  await page.getByRole("tab", { name: /Refused on-chain/ }).click();
  const refusal = page.getByTestId("group-refusals").locator("[data-testid^='tx-0x']").first();
  await refusal.getByTestId("tx-verify").click();
  await expect(refusal.getByTestId("tx-verify-result")).toContainText("Match", { timeout: 30_000 });
  await shot(page, "security-evidence");
  await page.goto("/#/security/evaluation");
  await expect(page.getByTestId("eval-verdict")).toBeVisible();
  await shot(page, "security-evaluation");

  // 9. Technical details on, then off again; and the first-visit tour.
  await page.goto("/#/");
  await page.getByTestId("tech-switch").click();
  await shot(page, "home-technical");
  await page.getByTestId("tech-switch").click();
  await page.evaluate(() => localStorage.removeItem("guardian-tour-done"));
  await page.reload();
  await expect(page.getByTestId("tour")).toContainText("Tell your AI what to do", { timeout: 30_000 });
  await shot(page, "tour");
  await page.getByTestId("tour").getByRole("button", { name: "Skip" }).click();
  await expect(page.getByTestId("tour")).toHaveCount(0);
}
