import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const transactionHash = `0x${"a".repeat(64)}`;
const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";
const firstPaymentFactor = { code: "FIRST_PAYMENT", points: 10, explanation: "This is the first recorded payment to the contact." };
const executedWhy = { decision: "EXECUTED", riskScore: 10, riskClass: "low", factors: [firstPaymentFactor], decidedBy: { layer: "tier gate", rule: "WITHIN_POLICY_AND_RISK_LIMITS", detail: "Policy, simulation, risk, and tier checks all passed.", ownerApprovalRequired: false } };
const pendingWhy = { decision: "NEEDS_APPROVAL", riskScore: 10, riskClass: "low", factors: [firstPaymentFactor], decidedBy: { layer: "contract", rule: "APPROVAL_THRESHOLD", detail: "The amount is at or above the owner's approval threshold, so the contract created a pending item only the owner can approve.", ownerApprovalRequired: true } };
const state = { paused: false, balances: [{ code: "USD", name: "US dollar (demo units)", available: "5000", savings: "300" }, { code: "CNY", name: "Chinese yuan (demo units)", available: "35000", savings: "0", disclaimer: CNY_DISCLAIMER }], spentToday: "100", remainingDaily: "900", perTxLimit: "500", dailyLimit: "1000", approvalThreshold: "200", recipientCooldown: "600", pendingExpiry: "86400", opsPerCallLimit: "0.1", opsDailyLimit: "5" };
const EXPIRES = Math.floor(Date.now() / 1000) + 86_400;
const pendingItem = () => ({ id: "1", recipientContactId: "ana", amount: "200", currency: "USD", status: "PENDING", expiresAt: String(EXPIRES), why: pendingWhy, operation: "requestApproval", agentReasoning: "Pay contact ana", flags: [] as string[] });
const pending = [pendingItem()];
const POSITIONING = "Guardian Wallet: a trust and control layer for autonomous AI finance. Let AI handle your financial tasks, without giving up control of your money.";
let approveFails = false;
let aiLabel = "offline rules";
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
  { label: "held-out, offline parser, before fixes", generatedAt: "2026-10-19T08:46:00.000Z", commit: "b4a5bf1", suite: "heldout", llm: "mock", scenarioCount: 20, taskSuccess: metric(0.8, 16, 20), unsafeActionRate: metric(0, 0, 20), attackBlockRate: metric(0.778, 7, 9), clarificationAccuracy: metric(1, 6, 6), failedIds: ["H01", "H10", "H14", "H15"] },
  { label: "all 61, offline parser, after fixes", generatedAt: "2026-10-19T08:59:00.000Z", commit: "507fe53", suite: "all", llm: "mock", scenarioCount: 61, taskSuccess: metric(1, 61, 61), unsafeActionRate: metric(0, 0, 61), attackBlockRate: metric(1, 29, 29), clarificationAccuracy: metric(1, 15, 15), failedIds: [] },
];
const proofHash = `0x${"b".repeat(64)}`;
const attacks = Array.from({ length: 11 }, (_, index) => ({ id: `A${index + 1}`, title: `Safety scenario ${index + 1}`, description: "Synthetic adversarial scenario", status: "READY", directProofRequired: [2, 3, 6, 7, 8, 9, 10].includes(index + 1) }));

const ownerSession = "synthetic-owner-session-token-for-e2e-only";
const ownerHeaderSeen: string[] = [];
const chatMessages: string[] = [];

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
    if (url.pathname === "/health") return route.fulfill({ json: { ok: true, llmProvider: "mock", llm: { provider: "mock", model: null, label: aiLabel }, chainId: 1337 } });
    if (url.pathname === "/chain") return route.fulfill({ json: { backend: "fisco", chainId: 1337, blockHeight: "2325" } });
    if (url.pathname === "/pending") return route.fulfill({ json: pending });
    if (url.pathname === "/contacts") return route.fulfill({ json: [{ id: "ana", address: "0x1000000000000000000000000000000000000001", label: "Ana · synthetic contact", allowed: true, activeAfter: "0" }, { id: "bob", address: "0x1000000000000000000000000000000000000002", label: "Bob · synthetic contact", allowed: true, activeAfter: "0" }] });
    if (url.pathname === "/audit") return route.fulfill({ json: [{ id: 1, timestamp: "2026-10-16T08:00:00.000Z", kind: "pipeline_result", hash: "f".repeat(64), data: { proposal: { kind: "pay", amount: "100", currency: "USD", recipientContactId: "ana" }, decision: { outcome: "EXECUTED", tier: "T1", transactionHash, blockNumber: "42" }, why: executedWhy } }, { id: 2, timestamp: "2026-10-16T08:01:00.000Z", kind: "pipeline_result", hash: "e".repeat(64), data: { proposal: { kind: "pay", amount: "600", currency: "USD", recipientContactId: "ana" }, decision: { outcome: "BLOCKED", transactionHash: proofHash, blockNumber: "43" } } }, { id: 3, timestamp: "2026-10-16T08:02:00.000Z", kind: "plan_step_validated", hash: "d".repeat(64), data: {} }].reverse() });
    if (url.pathname === "/value") return route.fulfill({ json: { ...valueResponse, history: valueHistory } });
    if (url.pathname === "/attack-lab") return route.fulfill({ json: attacks });
    if (url.pathname === "/attack-lab/run-all") return route.fulfill({ json: attacks.map(item => ({ ...item, status: "BLOCKED", backend: "fisco", blockedBy: "on-chain contract", reason: "Safety rule enforced", transactionHash, blockNumber: "46", onChain: true, directProof: { transactionHash: proofHash, blockNumber: "47", status: "reverted", detail: "Agent key call refused" }, steps: [{ layer: "on-chain contract", outcome: "REVERTED", detail: "Refused", transactionHash: proofHash, blockNumber: "47" }] })) });
    if (/^\/attack-lab\/run\/A\d+$/.test(url.pathname)) return route.fulfill({ json: { ...attacks.find(item => url.pathname.split("/").pop() === item.id), status: "BLOCKED", backend: "fisco", blockedBy: "firewall", reason: "Unsafe instruction refused", onChain: false, steps: [{ layer: "firewall", outcome: "BLOCKED", detail: "INSTRUCTION_INJECTION" }] } });
    if (url.pathname === "/chat") { chatMessages.push((route.request().postDataJSON() as { message: string }).message); return route.fulfill({ json: { route: "EXECUTED", tier: "T1", explanation: "Executed payment after policy, simulation, and risk checks.", transactionHash, blockNumber: "42", proposal: { kind: "pay", amount: "100", currency: "USD", recipientContactId: "ana" }, risk: { score: 10, factors: [firstPaymentFactor] }, why: executedWhy } }); }
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


async function send(page: Page, text: string) {
  await page.getByLabel("What should your AI do?").fill(text);
  await page.getByLabel("What should your AI do?").press("Enter");
}

test.beforeEach(async ({ page }, testInfo) => {
  ownerHeaderSeen.splice(0); chatMessages.splice(0); state.paused = false; approveFails = false; aiLabel = "offline rules"; pending.splice(0, pending.length, pendingItem());
  // The first-time tour has its own test; everywhere else it is already done.
  if (!testInfo.title.includes("tour")) await page.addInitScript(() => localStorage.setItem("guardian-tour-done", "1"));
  await mockApi(page); await page.goto("/");
});

test("Home pays and shows a Done receipt, with proof and details on demand", async ({ page }) => {
  await send(page, "Pay Ana $100");
  expect(chatMessages).toEqual(["Pay Ana 100 USD"]);
  await expect(page.getByTestId("chat-summary")).toHaveText("Paid $100.00 to Ana");
  await expect(page.getByTestId("chat-status")).toHaveText("Done");
  await expect(page.getByTestId("chat-status-code")).toHaveCount(0);
  await expect(page.getByTestId("chat-details")).toHaveCount(0);
  await page.getByTestId("view-proof").click();
  await expect(page.getByTestId("proof-tx")).toHaveAttribute("title", transactionHash);
  await page.getByTestId("proof-verify").click();
  await expect(page.getByTestId("proof-receipt")).toHaveText("Receipt success · block 42");
  await page.getByTestId("show-details").click();
  await expect(page.getByTestId("chat-details").getByTestId("why-panel")).toContainText("Why this action?");
  await expect(page.getByTestId("chat-tier")).toHaveText("AI can do alone");
});

test("example chips read in symbols and send the exact request in one tap", async ({ page }) => {
  for (const label of ["Pay Ana $50", "Pay Ana $250", "Save ¥200", "Pay Ana $50, then save ¥200"]) await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save ¥200", exact: true }).click();
  await expect(page.getByTestId("chat-result")).toBeVisible();
  expect(chatMessages).toEqual(["Save 200 CNY"]);
});

test("a payment above the limit waits with Approve and Decline right on the receipt", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/chat", route => route.fulfill({ json: { route: "NEEDS_APPROVAL", tier: "T2", explanation: "Held for the owner.", pendingId: "1", transactionHash, blockNumber: "41", proposal: { kind: "pay", amount: "250", currency: "USD", recipientContactId: "ana" }, why: pendingWhy } }));
  await send(page, "Pay Ana $250");
  await expect(page.getByTestId("chat-summary")).toHaveText("Needs your OK: $250.00 to Ana. It's above your $200 limit.");
  await expect(page.getByTestId("chat-status")).toHaveText("Needs your OK");
  await page.getByTestId("receipt-approve").click();
  await expect(page.getByTestId("chat-summary")).toHaveText("Paid $250.00 to Ana");
  await expect(page.getByTestId("toast")).toContainText("Approved and paid.");
  expect(ownerHeaderSeen).toEqual(["/owner/pending/1/approve"]);
});

test("a blocked payment says why with the real limit", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/chat", route => route.fulfill({ json: { route: "BLOCKED", tier: "T1", flags: ["OVER_PER_TX_LIMIT"], explanation: "Refused.", transactionHash, blockNumber: "44", proposal: { kind: "pay", amount: "600", currency: "USD", recipientContactId: "ana" } } }));
  await send(page, "Send Ana 600 USD");
  await expect(page.getByTestId("chat-summary")).toHaveText("Blocked: $600.00 is above your $500 limit.");
  await expect(page.getByTestId("chat-status")).toHaveText("Blocked");
  await expect(page.getByTestId("view-proof")).toHaveCount(0);
});

test("a question about who to pay offers the contacts as chips", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/chat", route => { chatMessages.push((route.request().postDataJSON() as { message: string }).message); return route.fulfill({ json: { route: "ANSWER_ONLY", tier: "T0", explanation: "Asked a question.", clarification: { required: true, questions: ["How much USD or CNY should I pay contact someone?"] }, proposal: { kind: "answer_only" } } }); });
  await send(page, "Pay someone");
  await expect(page.getByTestId("chat-summary")).toHaveText("Who should I pay?");
  await expect(page.getByTestId("chat-status")).toHaveText("Asking you");
  await expect(page.getByTestId("ask-contact-bob")).toHaveText("Bob");
  await page.getByTestId("ask-contact-ana").click();
  expect(chatMessages).toEqual(["Pay someone", "Pay Ana"]);
});

test("a plan shows its steps in plain words and the technical view shows the states", async ({ page }) => {
  const step = (id: string, index: number, stepState: string, status: string, proposal: Record<string, string>, operation: string, extra: Record<string, unknown> = {}) => ({ id, index, state: stepState, status, operation, proposal: { reason: "synthetic", sourceRefs: [], ...proposal }, ...extra });
  const plan = { id: "plan-1", status: "WAITING_APPROVAL", request: "synthetic", approvalCap: { currency: "USD", amount: "300" }, steps: [
    step("S1", 0, "EXECUTED", "EXECUTED", { kind: "pay", recipientContactId: "ana", amount: "50", currency: "USD" }, "pay", { result: { route: "EXECUTED", tier: "T1", transactionHash, blockNumber: "42", risk: { score: 10 } } }),
    step("S2", 1, "PENDING_APPROVAL", "STOPPED", { kind: "save", amount: "350", currency: "USD" }, "saveToSavings", { result: { route: "NEEDS_APPROVAL", tier: "T2", flags: ["OWNER_PLAN_APPROVAL_CAP"], risk: { score: 0 } } }),
    step("S3", 2, "VALIDATED", "NOT_RUN", { kind: "save", amount: "5", currency: "USD" }, "saveToSavings", { validation: { route: "EXECUTED", tier: "T1", dryRun: true, risk: { score: 0 } } }),
  ] };
  await page.route("http://127.0.0.1:8787/chat", route => route.fulfill({ json: { route: "PLAN", tier: "T2", explanation: "Plan of 3 steps.", plan } }));
  await send(page, "Pay Ana $50, then save $350, then save $5");
  await expect(page.getByTestId("chat-summary")).toHaveText("Needs your OK: Save $350.00. 1 of 3 done.");
  await expect(page.getByTestId("simple-step-S1")).toHaveText(/Pay Ana \$50\.00\s*Done/);
  await expect(page.getByTestId("simple-step-S3")).toContainText("Checked");
  await expect(page.locator("body")).not.toContainText("saveToSavings");
  await page.getByTestId("tech-switch").click();
  await expect(page.getByTestId("plan-step-S1").getByTestId("step-state")).toHaveText("Done");
  await expect(page.getByTestId("plan-step-S1").getByTestId("step-state-code")).toHaveText("EXECUTED");
  await expect(page.getByTestId("plan-step-S2").getByTestId("step-tier")).toHaveText("Needs your OK");
  await expect(page.getByTestId("plan-step-S2").getByTestId("step-tier-code")).toHaveText("T2");
  await expect(page.getByTestId("plan-step-S3").getByTestId("step-run")).toHaveText("Not run");
  await expect(page.getByTestId("plan-step-S2").getByTestId("step-tx")).toHaveCount(0);
  await expect(page.getByTestId("plan-run")).toHaveCount(0);
  await page.getByTestId("plan-step-S1").getByTestId("step-verify").click();
  await expect(page.getByTestId("plan-step-S1").getByTestId("step-receipt")).toHaveText("Receipt success · block 42");
});

test("the top bar names the active AI: a cloud model or the offline rules", async ({ page }) => {
  await expect(page.getByTestId("ai-provider")).toHaveText("AI: offline rules");
  aiLabel = "GPT-OSS 120B via Groq";
  await page.reload();
  await expect(page.getByTestId("ai-provider")).toHaveText("AI: GPT-OSS 120B via Groq");
});

test("navigation has four tabs and older links open where their content moved", async ({ page }) => {
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Home", "Activity", "Controls", "Security"]);
  await expect(page.getByTestId("chain-badge")).toHaveText("FISCO BCOS · 1337 · #2325");
  for (const [href, title] of [["/#/policy", "Controls"], ["/#/wallet", "Activity"], ["/#/evidence", "Security"], ["/#/value", "Security"], ["/#/agent", "Home"]]) {
    await page.goto(href);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  }
  await page.goto("/#/value");
  await expect(page.getByTestId("security-title")).toHaveText("Evaluation");
  await expect(page.getByTestId("page-lead")).toHaveText("Proof that the safeguards work, for reviewers.");
});

test("Home shows demo money, what waits for you, and one Pause button", async ({ page }) => {
  await expect(page.getByTestId("balance-card")).toHaveCount(2);
  await expect(page.getByTestId("balance-amount")).toHaveText(["$5,000.00", "¥35,000.00"]);
  await expect(page.getByTestId("balance-savings")).toHaveText(["Savings $300.00", "Savings ¥0.00"]);
  await expect(page.getByTestId("demo-balance")).toHaveText(["Demo money", "Demo money"]);
  await expect(page.getByTestId("currency-disclaimer").first()).toHaveText(CNY_DISCLAIMER);
  await expect(page.getByText("Waiting for your OK")).toBeVisible();
  await expect(page.getByTestId("pending-1").getByTestId("pending-sentence")).toHaveText("$200.00 to Ana");
  await expect(page.getByTestId("pending-1").getByTestId("pending-why")).toContainText("It's at your $200 limit.");
  await expect(page.getByTestId("kill-switch")).toHaveText("Pause AI");
  await expect(page.getByText("Stops the AI from paying anyone.")).toBeVisible();
  await expect(page.getByTestId("positioning")).toHaveText(POSITIONING);
  await expect(page.getByTestId("footer-disclaimer")).toHaveText(CNY_DISCLAIMER);
});

test("no raw codes in the normal view; the technical switch shows them and is remembered", async ({ page }) => {
  await send(page, "Pay Ana $100");
  await expect(page.getByTestId("chat-summary")).toHaveText("Paid $100.00 to Ana");
  for (const code of ["EXECUTED", "COMPLETED", "T1", "requestApproval", "saveToSavings"]) await expect(page.locator("main")).not.toContainText(code);
  await expect(page.getByTestId("pending-details-1")).toHaveCount(0);
  await page.getByTestId("tech-switch").click();
  await expect(page.getByTestId("tech-switch")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("chat-status-code")).toHaveText("EXECUTED");
  await expect(page.getByTestId("chat-tier-code")).toHaveText("T1");
  await expect(page.getByTestId("chat-details").getByTestId("why-panel")).toBeVisible();
  await expect(page.getByTestId("pending-1").getByTestId("pending-operation")).toHaveText("requestApproval");
  await expect(page.getByTestId("pending-1").getByTestId("pending-rules")).toContainText("APPROVAL_THRESHOLD");
  await expect(page.getByTestId("pending-1").getByTestId("pending-expiry")).toHaveText(new Date(EXPIRES * 1000).toLocaleString("en-US"));
  await expect(page.getByTestId("why-panel-1").getByTestId("why-decided-by")).toContainText("APPROVAL THRESHOLD");
  await page.reload();
  await expect(page.getByTestId("tech-switch")).toHaveAttribute("aria-checked", "true");
});

test("approve from the waiting list: success only after chain confirmation", async ({ page }) => {
  await page.getByTestId("approve-1").click();
  await expect(page.getByTestId("confirmed-1")).toHaveText("Request #1 approved and paid · confirmed on chain in block 43");
  await expect(page.getByTestId("toast")).toContainText("Approved and paid.");
  await expect(page.getByTestId("toast").getByRole("link", { name: "View proof" })).toBeVisible();
  await expect(page.getByTestId("pending-1")).toHaveCount(0);
  expect(ownerHeaderSeen).toEqual(["/owner/pending/1/approve"]);
});

test("decline from the waiting list on chain", async ({ page }) => {
  await expect(page.getByTestId("reject-1")).toHaveText("Decline");
  await page.getByTestId("reject-1").click();
  await expect(page.getByTestId("confirmed-1")).toContainText("Request #1 declined · confirmed on chain in block 44");
  expect(ownerHeaderSeen).toEqual(["/owner/pending/1/reject"]);
});

test("a failed approval is shown as an error, never as success", async ({ page }) => {
  approveFails = true;
  await page.getByTestId("approve-1").click();
  await expect(page.getByTestId("pending-error-1")).toHaveText("PendingHasExpired(1)");
  await expect(page.getByTestId("pending-confirmations")).toHaveCount(0);
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await expect(page.getByTestId("pending-1")).toBeVisible();
});

test("Activity lists what the AI did, filters, and expands each row", async ({ page }) => {
  await page.goto("/#/activity");
  await expect(page.getByTestId("activity-1")).toContainText("Paid $100.00 to Ana");
  await expect(page.getByTestId("activity-1")).toContainText("Done");
  await expect(page.getByTestId("activity-2")).toContainText("Blocked: $600.00 to Ana");
  await expect(page.getByTestId("activity-3")).toHaveCount(0);
  await page.getByRole("button", { name: "Blocked", exact: true }).click();
  await expect(page.getByTestId("activity-1")).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByTestId("why-toggle-1").click();
  const panel = page.getByTestId("why-panel-audit-1");
  await expect(panel.getByTestId("why-score")).toHaveText("10/100");
  await expect(panel.getByTestId("why-decided-by")).toContainText("WITHIN POLICY AND RISK LIMITS");
  await expect(page.getByTestId("activity-1").getByTestId("proof-tx")).toHaveAttribute("title", transactionHash);
  await page.getByTestId("why-toggle-1").click();
  await expect(panel).toHaveCount(0);
  await page.getByTestId("tech-switch").click();
  await expect(page.getByTestId("activity-3")).toBeVisible();
});

test("Pause asks first, shows a banner on every page, and resumes", async ({ page }) => {
  await page.getByTestId("kill-switch").click();
  const dialog = page.getByRole("dialog", { name: "Pause AI?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Pause AI" }).click();
  await expect(page.getByTestId("paused-banner")).toContainText("Paused. The AI can't pay anyone.");
  await expect(page.getByTestId("kill-switch")).toHaveText("Resume AI");
  await page.goto("/#/activity");
  await expect(page.getByTestId("paused-banner")).toBeVisible();
  await page.getByTestId("banner-resume").click();
  await expect(page.getByTestId("paused-banner")).toHaveCount(0);
  expect(ownerHeaderSeen).toEqual(["/owner/pause", "/owner/unpause"]);
});

test("Esc closes the pause confirmation without pausing", async ({ page }) => {
  await page.getByTestId("kill-switch").click();
  await expect(page.getByRole("dialog", { name: "Pause AI?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Pause AI?" })).toBeHidden();
  expect(ownerHeaderSeen).toEqual([]);
});

test("owner actions fail closed without an owner session", async ({ page }) => {
  await page.route("**/__owner-session", route => route.fulfill({ status: 503, json: { error: "OWNER_SESSION_UNAVAILABLE" } }));
  await page.goto("/#/controls");
  await page.getByTestId("kill-switch").click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause AI" }).click();
  await expect(page.getByTestId("toast")).toContainText("Could not pause");
  await expect(page.getByTestId("kill-switch")).toHaveText("Pause AI");
  expect(ownerHeaderSeen).toEqual([]);
  expect(state.paused).toBe(false);
});

test("Controls shows limits, recipients by name, and the pause switch", async ({ page }) => {
  await page.goto("/#/controls");
  await expect(page.getByLabel("Most per payment")).toHaveValue("500");
  await expect(page.getByLabel("Ask me at or above")).toHaveValue("200");
  await expect(page.getByText("Ana", { exact: true })).toBeVisible();
  await expect(page.getByText("Bob", { exact: true })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("0x1000");
  await expect(page.getByTestId("kill-switch")).toHaveText("Pause AI");
});

test("first-visit tour walks through three steps and can be shown again", async ({ page }) => {
  const tour = page.getByTestId("tour");
  await expect(tour).toContainText("Tell your AI what to do");
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour).toContainText("Big payments wait for your OK");
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour).toContainText("Pause stops everything");
  await tour.getByRole("button", { name: "Done" }).click();
  await expect(tour).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("balance-card").first()).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Show tour again" }).click();
  await expect(tour).toContainText("Tell your AI what to do");
  await tour.getByRole("button", { name: "Skip" }).click();
  await expect(tour).toHaveCount(0);
});

test("captures light and dark owner-console screenshots", async ({ page }) => {
  const directory = resolve(process.cwd(), "../docs/screenshots");
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, "owner-console-light.png"), fullPage: true });
  await page.getByLabel("Toggle color mode").click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(directory, "owner-console-dark.png"), fullPage: true });
});

test("runs every Attack Lab scenario in Security and shows evidence", async ({ page }) => {
  await page.goto("/#/security/attack-lab");
  await expect(page.getByTestId("attack-grid").locator("article")).toHaveCount(11);
  await page.getByTestId("run-A1").click();
  await expect(page.getByTestId("attack-A1")).toContainText("Stopped by the AI firewall");
  await expect(page.getByTestId("attack-summary")).toContainText("1 of 1 attacks blocked");
  await page.getByTestId("run-all-attacks").click();
  await expect(page.getByTestId("attack-summary")).toContainText("11 of 11 attacks blocked");
  await expect(page.getByTestId("attack-grid")).toContainText(transactionHash);
  await expect(page.getByTestId("attack-A9")).toContainText(proofHash);
  await expect(page.getByTestId("attack-A9")).toContainText("Sent straight to contract");
});

test("shows evaluation targets and live audit counts in Security", async ({ page }) => {
  await page.goto("/#/security/evaluation");
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
  await expect(page.getByTestId("live-metrics").getByTestId("currency-disclaimer")).toHaveText(CNY_DISCLAIMER);
});
