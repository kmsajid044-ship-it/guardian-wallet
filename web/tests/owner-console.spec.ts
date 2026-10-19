import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const transactionHash = `0x${"a".repeat(64)}`;
const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";
const firstPaymentFactor = { code: "FIRST_PAYMENT", points: 10, explanation: "This is the first recorded payment to the contact." };
const executedWhy = { decision: "EXECUTED", riskScore: 10, riskClass: "low", factors: [firstPaymentFactor], decidedBy: { layer: "tier gate", rule: "WITHIN_POLICY_AND_RISK_LIMITS", detail: "Policy, simulation, risk, and tier checks all passed.", ownerApprovalRequired: false } };
const pendingWhy = { decision: "NEEDS_APPROVAL", riskScore: 10, riskClass: "low", factors: [firstPaymentFactor], decidedBy: { layer: "contract", rule: "APPROVAL_THRESHOLD", detail: "The amount is at or above the owner's approval threshold, so the contract created a pending item only the owner can approve.", ownerApprovalRequired: true } };
const state = { paused: false, balances: [{ code: "USD", name: "US dollar (demo units)", available: "5000", savings: "300" }, { code: "CNY", name: "Chinese yuan (demo units)", available: "35000", savings: "0", disclaimer: CNY_DISCLAIMER }], spentToday: "100", remainingDaily: "900", perTxLimit: "500", dailyLimit: "1000", approvalThreshold: "200", recipientCooldown: "600", pendingExpiry: "86400", opsPerCallLimit: "0.1", opsDailyLimit: "5" };
const pendingItem = () => ({ id: "1", recipientContactId: "ana", amount: "200", currency: "USD", status: "PENDING", expiresAt: "1792200000", why: pendingWhy, operation: "requestApproval", agentReasoning: "Pay contact ana", flags: [] as string[] });
const pending = [pendingItem()];
const POSITIONING = "Guardian Wallet: a trust and control layer for autonomous AI finance. Let AI handle your financial tasks, without giving up control of your money.";
let approveFails = false;
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
const valueHistory = [
  { label: "held-out, offline parser, before fixes", generatedAt: "2026-10-19T08:46:00.000Z", commit: "0a3d437", suite: "heldout", llm: "mock", scenarioCount: 20, taskSuccess: metric(0.8, 16, 20), unsafeActionRate: metric(0, 0, 20), attackBlockRate: metric(0.778, 7, 9), clarificationAccuracy: metric(1, 6, 6), failedIds: ["H01", "H10", "H14", "H15"] },
  { label: "all 61, offline parser, after fixes", generatedAt: "2026-10-19T08:59:00.000Z", commit: "85563bf", suite: "all", llm: "mock", scenarioCount: 61, taskSuccess: metric(1, 61, 61), unsafeActionRate: metric(0, 0, 61), attackBlockRate: metric(1, 29, 29), clarificationAccuracy: metric(1, 15, 15), failedIds: [] },
];
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
    if (url.pathname === "/chain") return route.fulfill({ json: { backend: "fisco", chainId: 1337, blockHeight: "2325" } });
    if (url.pathname === "/pending") return route.fulfill({ json: pending });
    if (url.pathname === "/contacts") return route.fulfill({ json: [{ id: "ana", address: "0x1000000000000000000000000000000000000001", label: "Ana · synthetic contact", allowed: true, activeAfter: "0" }] });
    if (url.pathname === "/audit") return route.fulfill({ json: [{ id: 1, timestamp: "2026-10-16T08:00:00.000Z", kind: "pipeline_result", hash: "f".repeat(64), data: { decision: { outcome: "EXECUTED", transactionHash, blockNumber: "42" }, why: executedWhy } }] });
    if (url.pathname === "/value") return route.fulfill({ json: { ...valueResponse, history: valueHistory } });
    if (url.pathname === "/attack-lab") return route.fulfill({ json: attacks });
    if (url.pathname === "/attack-lab/run-all") return route.fulfill({ json: attacks.map(item => ({ ...item, status: "BLOCKED", backend: "fisco", blockedBy: "on-chain contract", reason: "Safety rule enforced", transactionHash, blockNumber: "46", onChain: true, directProof: { transactionHash: proofHash, blockNumber: "47", status: "reverted", detail: "Agent key call refused" }, steps: [{ layer: "on-chain contract", outcome: "REVERTED", detail: "Refused", transactionHash: proofHash, blockNumber: "47" }] })) });
    if (/^\/attack-lab\/run\/A\d+$/.test(url.pathname)) return route.fulfill({ json: { ...attacks.find(item => url.pathname.split("/").pop() === item.id), status: "BLOCKED", backend: "fisco", blockedBy: "firewall", reason: "Unsafe instruction refused", onChain: false, steps: [{ layer: "firewall", outcome: "BLOCKED", detail: "INSTRUCTION_INJECTION" }] } });
    if (url.pathname === "/chat") return route.fulfill({ json: { route: "EXECUTED", tier: "T1", explanation: "Executed payment after policy, simulation, and risk checks.", transactionHash, blockNumber: "42", proposal: { kind: "pay", amount: "100", currency: "USD", recipientContactId: "ana" }, risk: { score: 10, factors: [firstPaymentFactor] }, why: executedWhy } });
    if (url.pathname === "/owner/pending/1/approve") {
      if (approveFails) return route.fulfill({ status: 400, json: { error: "APPROVAL_FAILED", message: "PendingHasExpired(1)" } });
      pending.splice(0); return route.fulfill({ json: { transactionHash, blockNumber: "43", status: "success", pendingId: "1", pendingStatus: "EXECUTED" } });
    }
    if (url.pathname === "/owner/pending/1/reject") { pending.splice(0); return route.fulfill({ json: { transactionHash: proofHash, blockNumber: "44", status: "success", pendingId: "1", pendingStatus: "REJECTED" } }); }
    if (url.pathname === "/owner/pause") { state.paused = true; return route.fulfill({ json: { transactionHash, blockNumber: "44", status: "success" } }); }
    if (url.pathname === "/owner/unpause") { state.paused = false; return route.fulfill({ json: { transactionHash, blockNumber: "45", status: "success" } }); }
    if (url.pathname.startsWith("/receipt/")) return route.fulfill({ json: { transactionHash, blockNumber: "42", status: "success" } });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
}

test.beforeEach(async ({ page }) => { ownerHeaderSeen.splice(0); state.paused = false; approveFails = false; pending.splice(0, pending.length, pendingItem()); await mockApi(page); await page.goto("/"); });

test("chat executes a T1 payment and shows the plan", async ({ page }) => {
  await page.getByLabel("Message the agent").fill("Pay Ana 100 USD");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-result")).toContainText("EXECUTED");
  await expect(page.getByTestId("chat-result")).toContainText("T1");
  await expect(page.getByText("Execution complete")).toBeVisible();
});

test("shows plan step states exactly as the agent returned them, with no transaction before a receipt", async ({ page }) => {
  const step = (id: string, index: number, state: string, status: string, proposal: Record<string, string>, operation: string, extra: Record<string, unknown> = {}) => ({ id, index, state, status, operation, proposal: { reason: "synthetic", sourceRefs: [], ...proposal }, ...extra });
  const plan = { id: "plan-1", status: "WAITING_APPROVAL", request: "synthetic", approvalCap: { currency: "USD", amount: "300" }, steps: [
    step("S1", 0, "EXECUTED", "EXECUTED", { kind: "pay", recipientContactId: "ana", amount: "50", currency: "USD" }, "pay", { result: { route: "EXECUTED", tier: "T1", transactionHash, blockNumber: "42", risk: { score: 10 } } }),
    step("S2", 1, "PENDING_APPROVAL", "STOPPED", { kind: "save", amount: "350", currency: "USD" }, "saveToSavings", { result: { route: "NEEDS_APPROVAL", tier: "T2", flags: ["OWNER_PLAN_APPROVAL_CAP"], risk: { score: 0 } } }),
    step("S3", 2, "VALIDATED", "NOT_RUN", { kind: "save", amount: "5", currency: "USD" }, "saveToSavings", { validation: { route: "EXECUTED", tier: "T1", dryRun: true, risk: { score: 0 } } }),
  ] };
  await page.route("http://127.0.0.1:8787/chat", route => route.fulfill({ json: { route: "PLAN", tier: "T2", explanation: "Plan of 3 steps.", plan } }));
  await page.getByLabel("Message the agent").fill("Pay Ana 50 USD then save 350 USD then save 5 USD");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("plan-step-S1").getByTestId("step-state")).toHaveText("EXECUTED");
  await expect(page.getByTestId("plan-step-S1").getByTestId("step-block")).toHaveText("42");
  await expect(page.getByTestId("plan-step-S2").getByTestId("step-state")).toHaveText("PENDING APPROVAL");
  await expect(page.getByTestId("plan-step-S2").getByTestId("step-tier")).toHaveText("T2");
  await expect(page.getByTestId("plan-step-S2").getByTestId("step-tx")).toHaveCount(0);
  await expect(page.getByTestId("plan-step-S3").getByTestId("step-state")).toHaveText("VALIDATED");
  await expect(page.getByTestId("plan-step-S3").getByTestId("step-run")).toHaveText("Not run");
  await expect(page.getByTestId("plan-step-S3").getByTestId("step-tx")).toHaveCount(0);
  await expect(page.getByTestId("plan-run")).toHaveCount(0);
  await page.getByTestId("plan-step-S1").getByTestId("step-verify").click();
  await expect(page.getByTestId("plan-step-S1").getByTestId("step-receipt")).toHaveText("Receipt success · block 42");
});

test("navigation follows the product order and older links still open their page", async ({ page }) => {
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["AI Agent", "Wallet", "Control Center", "Attack Lab", "Evidence Inspector", "Evaluation"]);
  await expect(page.getByTestId("chain-badge")).toHaveText("FISCO BCOS · chain 1337 · block 2325");
  await page.goto("/#/policy");
  await expect(page.getByRole("heading", { name: "Control Center" })).toBeVisible();
  await page.goto("/#/value");
  await expect(page.getByRole("heading", { name: "Evaluation" })).toBeVisible();
});

test("the AI Agent landing page carries the positioning and no real-money claim", async ({ page }) => {
  await expect(page.getByTestId("positioning")).toHaveText(POSITIONING);
  await expect(page.getByText("No real money and no customer funds are involved.")).toBeVisible();
  await expect(page.getByTestId("glance-pending")).toContainText("1");
});

test("labels every balance DEMO BALANCE", async ({ page }) => {
  await page.goto("/#/wallet");
  await expect(page.getByTestId("balance-card")).toHaveCount(2);
  for (const card of await page.getByTestId("balance-card").all()) await expect(card.getByTestId("demo-balance")).toHaveText("DEMO BALANCE");
});

test("pending approval cards show what the owner is deciding", async ({ page }) => {
  await page.goto("/#/control");
  const card = page.getByTestId("pending-1");
  await expect(card.getByTestId("pending-operation")).toHaveText("requestApproval");
  await expect(card.getByTestId("pending-amount")).toHaveText("200");
  await expect(card.getByTestId("pending-currency")).toHaveText("USD");
  await expect(card.getByTestId("pending-recipient")).toHaveText("ana");
  await expect(card.getByTestId("pending-reasoning")).toHaveText("Pay contact ana");
  await expect(card.getByTestId("pending-risk")).toHaveText("10/100");
  await expect(card.getByTestId("pending-rules")).toContainText("APPROVAL_THRESHOLD");
  await expect(card.getByTestId("pending-rules")).toContainText("FIRST_PAYMENT");
  await expect(card.getByTestId("pending-expiry")).toHaveText(new Date(1792200000 * 1000).toLocaleString("en-US"));
  await expect(card.getByTestId("approve-1")).toHaveText("Approve");
  await expect(card.getByTestId("reject-1")).toHaveText("Reject");
});

test("owner approves a T2 item and sees success only after chain confirmation", async ({ page }) => {
  await page.goto("/#/control");
  await expect(page.getByTestId("approval-inbox")).toContainText("200 USD");
  await page.getByTestId("approve-1").click();
  await expect(page.getByTestId("confirmed-1")).toHaveText(`Pending #1 approved and paid · confirmed on chain in block 43 · ${transactionHash.slice(0, 10)}…${transactionHash.slice(-8)}`);
  await expect(page.getByTestId("approval-inbox")).toContainText("No items need your approval");
  expect(ownerHeaderSeen).toEqual(["/owner/pending/1/approve"]);
});

test("owner rejects a T2 item on chain", async ({ page }) => {
  await page.goto("/#/control");
  await page.getByTestId("reject-1").click();
  await expect(page.getByTestId("confirmed-1")).toContainText("Pending #1 rejected · confirmed on chain in block 44");
  expect(ownerHeaderSeen).toEqual(["/owner/pending/1/reject"]);
});

test("a failed approval is shown as an error, never as success", async ({ page }) => {
  approveFails = true;
  await page.goto("/#/control");
  await page.getByTestId("approve-1").click();
  await expect(page.getByTestId("pending-error-1")).toHaveText("PendingHasExpired(1)");
  await expect(page.getByTestId("pending-confirmations")).toHaveCount(0);
  await expect(page.getByTestId("pending-1")).toBeVisible();
});

test("shows why an executed action was allowed", async ({ page }) => {
  await page.getByLabel("Message the agent").fill("Pay Ana 100 USD");
  await page.getByRole("button", { name: "Send" }).click();
  const panel = page.getByTestId("why-panel");
  await expect(panel).toContainText("Why this action?");
  await expect(panel.getByTestId("why-score")).toHaveText("10/100");
  await expect(panel.getByTestId("why-class")).toHaveText("low");
  await expect(panel.getByTestId("why-approval")).toHaveText("Not required");
  await expect(panel.getByTestId("why-factors")).toContainText("first recorded payment to the contact");
  await expect(panel.getByTestId("why-decided-by")).toContainText("tier gate");
});

test("shows the risk engine as the deciding layer for a blocked action", async ({ page }) => {
  const sanctionedFactor = { code: "RISK_INTEL_SANCTIONED", points: 100, explanation: "Risk Intel reported a sanctions match." };
  await page.route("http://127.0.0.1:8787/chat", route => route.fulfill({ json: { route: "BLOCKED", tier: "T2", explanation: "The risk score reached the blocked band.", proposal: { kind: "pay", amount: "100", currency: "USD", recipientContactId: "ana" }, risk: { score: 100, factors: [sanctionedFactor] }, why: { decision: "BLOCKED", riskScore: 100, riskClass: "blocked", factors: [sanctionedFactor], decidedBy: { layer: "risk engine", rule: "RISK_SCORE_AT_LEAST_85", detail: "Risk score is at least 85", ownerApprovalRequired: false } } } }));
  await page.getByLabel("Message the agent").fill("Pay Ana 100 USD");
  await page.getByRole("button", { name: "Send" }).click();
  const panel = page.getByTestId("why-panel");
  await expect(panel.getByTestId("why-score")).toHaveText("100/100");
  await expect(panel.getByTestId("why-class")).toHaveText("blocked");
  await expect(panel.getByTestId("why-factors")).toContainText("sanctions match");
  await expect(panel.getByTestId("why-decided-by")).toContainText("risk engine");
  await expect(panel.getByTestId("why-approval")).toHaveText("Not required");
});

test("explains every pending approval with the rule that decided it", async ({ page }) => {
  await page.goto("/#/control");
  await page.getByTestId("pending-1").getByText("Full explanation").click();
  const panel = page.getByTestId("why-panel-1");
  await expect(panel).toContainText("Why this action?");
  await expect(panel.getByTestId("why-class")).toHaveText("low");
  await expect(panel.getByTestId("why-approval")).toHaveText("Required");
  await expect(panel.getByTestId("why-decided-by")).toContainText("contract");
  await expect(panel.getByTestId("why-decided-by")).toContainText("APPROVAL THRESHOLD");
});

test("expands the explanation for an audit decision", async ({ page }) => {
  await page.goto("/#/wallet");
  await page.getByTestId("why-toggle-1").click();
  const panel = page.getByTestId("why-panel-audit-1");
  await expect(panel.getByTestId("why-score")).toHaveText("10/100");
  await expect(panel.getByTestId("why-decided-by")).toContainText("WITHIN POLICY AND RISK LIMITS");
  await page.getByTestId("why-toggle-1").click();
  await expect(panel).toHaveCount(0);
});

test("kill switch pauses and resumes the agent", async ({ page }) => {
  await page.goto("/#/control");
  await page.getByTestId("kill-switch").click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(page.getByTestId("kill-switch")).toContainText("Resume agent");
  await page.getByTestId("kill-switch").click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  expect(ownerHeaderSeen).toEqual(["/owner/pause", "/owner/unpause"]);
});

test("owner actions fail closed without an owner session", async ({ page }) => {
  await page.route("**/__owner-session", route => route.fulfill({ status: 503, json: { error: "OWNER_SESSION_UNAVAILABLE" } }));
  await page.goto("/#/control");
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

test("shows evaluation targets and live audit counts on the Evaluation page", async ({ page }) => {
  await page.goto("/#/evaluation");
  await expect(page.getByTestId("eval-verdict")).toHaveText("All targets met");
  await expect(page.getByTestId("eval-targets")).toContainText("Task success");
  await expect(page.getByTestId("eval-targets")).toContainText("40 of 40");
  await expect(page.getByTestId("eval-targets")).toContainText("19 of 19");
  await expect(page.getByTestId("eval-scenarios")).toContainText("N01");
  await expect(page.getByTestId("live-metrics")).toContainText("150 USD");
  await expect(page.getByTestId("live-metrics")).toContainText("11/11");
  await expect(page.getByTestId("eval-history")).toContainText("held-out, offline parser, before fixes");
  await expect(page.getByTestId("eval-history")).toContainText("H01, H10, H14, H15");
  await expect(page.getByTestId("eval-history")).toContainText("all 61, offline parser, after fixes");
});

test("shows the CNY disclaimer wherever CNY demo balances appear", async ({ page }) => {
  await page.goto("/#/wallet");
  await expect(page.getByText("CNY available")).toBeVisible();
  await expect(page.getByTestId("currency-disclaimer").first()).toHaveText(CNY_DISCLAIMER);
  await page.goto("/#/evaluation");
  await expect(page.getByTestId("live-metrics").getByTestId("currency-disclaimer")).toHaveText(CNY_DISCLAIMER);
});
