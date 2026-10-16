import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const transactionHash = `0x${"a".repeat(64)}`;
const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";
const state = { paused: false, balances: [{ code: "USD", name: "US dollar (demo units)", available: "5000", savings: "300" }, { code: "CNY", name: "Chinese yuan (demo units)", available: "35000", savings: "0", disclaimer: CNY_DISCLAIMER }], spentToday: "100", remainingDaily: "900", perTxLimit: "500", dailyLimit: "1000", approvalThreshold: "200", recipientCooldown: "600", pendingExpiry: "86400", opsPerCallLimit: "0.1", opsDailyLimit: "5" };
const pending = [{ id: "1", recipientContactId: "ana", amount: "200", currency: "USD", status: "PENDING", expiresAt: "1792200000" }];
const metric = (value: number, numerator: number, denominator: number, target?: string, pass?: boolean) => ({ value, numerator, denominator, unit: "ratio", ...(target ? { target, pass } : {}) });
const valueResponse = {
  eval: {
    generatedAt: "2026-10-16T09:00:00.000Z", backend: "fisco", chainId: 1337, commit: "abc1234", llm: { requested: "mock", effective: "mock" }, scenarioCount: 40, targetsMet: true,
    bySuite: { normal: { total: 12, succeeded: 12 }, clarification: { total: 9, succeeded: 9 }, attack: { total: 8, succeeded: 8 }, "attack-lab": { total: 11, succeeded: 11 } },
    metrics: {
      taskSuccess: metric(1, 40, 40, "≥ 90%", true), unsafeActionRate: metric(0, 0, 40, "0%", true), attackBlockRate: metric(1, 19, 19, "100%", true),
      clarificationAccuracy: metric(1, 9, 9), falseClarificationRate: metric(0, 0, 12),
      averageLatencyMs: { value: 210, denominator: 31, unit: "ms" }, p95LatencyMs: { value: 622, denominator: 31, unit: "ms" },
      estimatedMinutesSaved: { value: 41.9, denominator: 12, unit: "minutes" }, estimatedMinutesSavedPerTask: { value: 3.49, denominator: 12, unit: "minutes" },
    },
    scenarios: [{ id: "N01", suite: "normal", title: "Small USD payment", success: true, unsafe: false, latencyMs: 300, minutesSaved: 2.99 }],
  },
  live: { decisions: 7, routes: { EXECUTED: 3, NEEDS_APPROVAL: 1, BLOCKED: 2, ANSWER_ONLY: 1, SCHEDULE_READY: 0 }, ownerApprovals: 1, pauses: 1, currencies: [{ code: "USD", name: "US dollar (demo units)" }, { code: "CNY", name: "Chinese yuan (demo units)", disclaimer: CNY_DISCLAIMER }], movedOut: { USD: "150", CNY: "0" }, savedToSavings: { USD: "50", CNY: "0" }, blockedValue: { USD: "600", CNY: "0" }, attackLab: { runs: 11, blocked: 11 }, estimatedMinutesSaved: 12.5, lastActivity: "2026-10-16T09:30:00.000Z" },
};
const proofHash = `0x${"b".repeat(64)}`;
const attacks = Array.from({ length: 11 }, (_, index) => ({ id: `A${index + 1}`, title: `Safety scenario ${index + 1}`, description: "Synthetic adversarial scenario", status: "READY", directProofRequired: [2, 3, 6, 7, 8, 9, 10].includes(index + 1) }));

const ownerSession = "synthetic-owner-session-token-for-e2e-only";
const ownerHeaderSeen: string[] = [];

async function mockApi(page: Page) {
  await page.route("**/__owner-session", route => route.fulfill({ json: { token: ownerSession }, headers: { "cache-control": "no-store" } }));
  await page.route("http://127.0.0.1:8787/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/owner/") && route.request().method() !== "OPTIONS") {
      const supplied = await route.request().headerValue("x-owner-session");
      if (supplied !== ownerSession) return route.fulfill({ status: 401, json: { error: "OWNER_SESSION_REQUIRED" } });
      ownerHeaderSeen.push(url.pathname);
    }
    if (url.pathname === "/state") return route.fulfill({ json: state });
    if (url.pathname === "/pending") return route.fulfill({ json: pending });
    if (url.pathname === "/contacts") return route.fulfill({ json: [{ id: "ana", address: "0x1000000000000000000000000000000000000001", label: "Ana · synthetic contact", allowed: true, activeAfter: "0" }] });
    if (url.pathname === "/audit") return route.fulfill({ json: [{ id: 1, timestamp: "2026-10-16T08:00:00.000Z", kind: "pipeline_result", hash: "f".repeat(64), data: { decision: { outcome: "EXECUTED", transactionHash, blockNumber: "42" } } }] });
    if (url.pathname === "/value") return route.fulfill({ json: valueResponse });
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

test.beforeEach(async ({ page }) => { ownerHeaderSeen.splice(0); state.paused = false; pending.splice(0, pending.length, { id: "1", recipientContactId: "ana", amount: "200", currency: "USD", status: "PENDING", expiresAt: "1792200000" }); await mockApi(page); await page.goto("/"); });

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
  expect(ownerHeaderSeen).toEqual(["/owner/pending/1/approve"]);
});

test("kill switch pauses and resumes the agent", async ({ page }) => {
  await page.getByTestId("kill-switch").click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(page.getByTestId("kill-switch")).toContainText("Resume agent");
  await page.getByTestId("kill-switch").click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  expect(ownerHeaderSeen).toEqual(["/owner/pause", "/owner/unpause"]);
});

test("owner actions fail closed without an owner session", async ({ page }) => {
  await page.route("**/__owner-session", route => route.fulfill({ status: 503, json: { error: "OWNER_SESSION_UNAVAILABLE" } }));
  await page.getByTestId("kill-switch").click();
  await expect(page.getByTestId("kill-switch")).toContainText("Pause agent");
  expect(ownerHeaderSeen).toEqual([]);
  expect(state.paused).toBe(false);
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

test("shows evaluation targets and live audit counts on the Value Dashboard", async ({ page }) => {
  await page.goto("/#/value");
  await expect(page.getByTestId("eval-verdict")).toHaveText("All targets met");
  await expect(page.getByTestId("eval-targets")).toContainText("Task success");
  await expect(page.getByTestId("eval-targets")).toContainText("40 of 40");
  await expect(page.getByTestId("eval-targets")).toContainText("19 of 19");
  await expect(page.getByTestId("eval-scenarios")).toContainText("N01");
  await expect(page.getByTestId("live-metrics")).toContainText("150 USD");
  await expect(page.getByTestId("live-metrics")).toContainText("11/11");
});

test("shows the CNY disclaimer wherever CNY demo balances appear", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByText("CNY available")).toBeVisible();
  await expect(page.getByTestId("currency-disclaimer").first()).toHaveText(CNY_DISCLAIMER);
  await page.goto("/#/value");
  await expect(page.getByTestId("live-metrics").getByTestId("currency-disclaimer")).toHaveText(CNY_DISCLAIMER);
});
