import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const transactionHash = `0x${"a".repeat(64)}`;
const state = { paused: false, usdBalance: "5000", bdtBalance: "500000", usdSavings: "300", bdtSavings: "0", spentToday: "100", remainingDaily: "900", perTxLimit: "500", dailyLimit: "1000", approvalThreshold: "200", recipientCooldown: "600", pendingExpiry: "86400", opsPerCallLimit: "0.1", opsDailyLimit: "5" };
const pending = [{ id: "1", recipientContactId: "ana", amount: "200", currency: "USD", status: "PENDING", expiresAt: "1792200000" }];
const proofHash = `0x${"b".repeat(64)}`;
const attacks = Array.from({ length: 11 }, (_, index) => ({ id: `A${index + 1}`, title: `Safety scenario ${index + 1}`, description: "Synthetic adversarial scenario", status: "READY", directProofRequired: [2, 3, 6, 7, 8, 9, 10].includes(index + 1) }));

async function mockApi(page: Page) {
  await page.route("http://127.0.0.1:8787/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/state") return route.fulfill({ json: state });
    if (url.pathname === "/pending") return route.fulfill({ json: pending });
    if (url.pathname === "/contacts") return route.fulfill({ json: [{ id: "ana", address: "0x1000000000000000000000000000000000000001", label: "Ana · synthetic contact", allowed: true, activeAfter: "0" }] });
    if (url.pathname === "/audit") return route.fulfill({ json: [{ id: 1, timestamp: "2026-10-16T08:00:00.000Z", kind: "pipeline_result", hash: "f".repeat(64), data: { decision: { outcome: "EXECUTED", transactionHash, blockNumber: "42" } } }] });
    if (url.pathname === "/attack-lab") return route.fulfill({ json: attacks });
    if (url.pathname === "/attack-lab/run-all") return route.fulfill({ json: attacks.map(item => ({ ...item, status: "BLOCKED", backend: "fisco", blockedBy: "on-chain contract", reason: "Safety rule enforced", transactionHash, blockNumber: "46", onChain: true, directProof: { transactionHash: proofHash, blockNumber: "47", status: "reverted", detail: "Agent key call refused" }, steps: [{ layer: "on-chain contract", outcome: "REVERTED", detail: "Refused", transactionHash: proofHash, blockNumber: "47" }] })) });
    if (/^\/attack-lab\/run\/A\d+$/.test(url.pathname)) return route.fulfill({ json: { ...attacks.find(item => url.pathname.split("/").pop() === item.id), status: "BLOCKED", backend: "fisco", blockedBy: "firewall", reason: "Unsafe instruction refused", onChain: false, steps: [{ layer: "firewall", outcome: "BLOCKED", detail: "INSTRUCTION_INJECTION" }] } });
    if (url.pathname === "/chat") return route.fulfill({ json: { route: "EXECUTED", tier: "T1", explanation: "Executed payment after policy, simulation, and risk checks.", transactionHash, blockNumber: "42", proposal: { kind: "pay", amount: "100", currency: "USD", recipientContactId: "ana" }, risk: { score: 10, factors: [] } } });
    if (url.pathname === "/owner/pending/1/approve") { pending.splice(0); return route.fulfill({ json: { transactionHash, blockNumber: "43", status: "success" } }); }
    if (url.pathname === "/owner/pause") { state.paused = true; return route.fulfill({ json: { transactionHash, blockNumber: "44", status: "success" } }); }
    if (url.pathname === "/owner/unpause") { state.paused = false; return route.fulfill({ json: { transactionHash, blockNumber: "45", status: "success" } }); }
    if (url.pathname.startsWith("/receipt/")) return route.fulfill({ json: { transactionHash, blockNumber: "42", status: "success" } });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
}

test.beforeEach(async ({ page }) => { state.paused = false; pending.splice(0, pending.length, { id: "1", recipientContactId: "ana", amount: "200", currency: "USD", status: "PENDING", expiresAt: "1792200000" }); await mockApi(page); await page.goto("/"); });

test("chat executes a T1 payment and shows the plan", async ({ page }) => {
  await page.getByLabel("Message the agent").fill("Pay Ana 100 USD");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-result")).toContainText("EXECUTED");
  await expect(page.getByTestId("chat-result")).toContainText("T1");
  await expect(page.getByText("Execution complete")).toBeVisible();
});

test("owner approves a T2 inbox item", async ({ page }) => {
  await expect(page.getByTestId("approval-inbox")).toContainText("200 USD");
  await page.getByTestId("approve-1").click();
  await expect(page.getByTestId("approval-inbox")).toContainText("No items need your approval");
});

test("kill switch pauses and resumes the agent", async ({ page }) => {
  await page.getByTestId("kill-switch").click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(page.getByTestId("kill-switch")).toContainText("Resume agent");
  await page.getByTestId("kill-switch").click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
});

test("captures light and dark owner-console screenshots", async ({ page }) => {
  const directory = resolve(process.cwd(), "../docs/screenshots");
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, "owner-console-light.png"), fullPage: true });
  await page.getByLabel("Toggle color mode").click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(directory, "owner-console-dark.png"), fullPage: true });
});

test("runs every Attack Lab scenario and shows evidence", async ({ page }) => {
  await page.goto("/#/attack-lab");
  await expect(page.getByTestId("attack-grid").locator("article")).toHaveCount(11);
  await page.getByTestId("run-A1").click();
  await expect(page.getByTestId("attack-A1")).toContainText("firewall");
  await expect(page.getByTestId("attack-summary")).toContainText("1 of 1 scenarios blocked");
  await page.getByTestId("run-all-attacks").click();
  await expect(page.getByTestId("attack-summary")).toContainText("11 of 11 scenarios blocked");
  await expect(page.getByTestId("attack-grid")).toContainText(transactionHash);
  await expect(page.getByTestId("attack-A9")).toContainText(proofHash);
  await expect(page.getByTestId("attack-A9")).toContainText("Sent straight to contract");
});
