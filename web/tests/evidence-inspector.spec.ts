import { expect, test, type Page } from "@playwright/test";

// UI behaviour of the Evidence Inspector with a fixed agent response; evidence-live.spec.ts runs it
// against the real exported evidence and the FISCO BCOS node.
const INFO = "Permissioned FISCO BCOS network operated by the team. Hashes come from this network. Reviewers can re-verify with ./scripts/verify-evidence.sh --all. A fresh replay creates new hashes; mode (a) checks the original ones.";
const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";
const TX_HASH = /0x[0-9a-fA-F]{64}/;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const wallet = "0x00000000000000000000000000000000000000F8";
const executed = {
  hash: hash("1"), blockNumber: 140, blockHash: hash("b"), chainId: 1337, label: "Agent pay(ana, 50 USD) after firewall, pre-check, simulation", fromRole: "agent",
  contractAddress: wallet, contractRole: "GuardianWallet #1", functionName: "pay", call: "pay(contact ana, USD, 50000000, 0x01)", status: "success",
  events: [{ contract: "GuardianWallet #1", address: wallet, name: "PaymentCompleted", args: { currency: "USD", to: "contact ana", amount: "50" } }], result: "PaymentCompleted",
  decision: { source: "agent pipeline", outcome: "EXECUTED", tier: "T1", rule: "WITHIN_POLICY_AND_RISK_LIMITS" },
};
const refused = {
  ...executed, hash: hash("2"), blockNumber: 141, label: "Agent requestApproval(ana, 600 USD) refused", functionName: "requestApproval", result: "BLOCKED OVER_PER_TX_LIMIT", refusal: "OVER_PER_TX_LIMIT",
  events: [{ contract: "GuardianWallet #1", address: wallet, name: "PolicyViolation", args: { reason: "OVER_PER_TX_LIMIT", amount: "600" } }],
  decision: { source: "agent pipeline", outcome: "BLOCKED", tier: "T1", rule: "OVER_PER_TX_LIMIT" },
};
const reverted = { ...executed, hash: hash("3"), blockNumber: 142, label: "unpause() from the agent key", functionName: "unpause", status: "reverted", events: [], result: "REVERTED OwnableUnauthorizedAccount(agent)", refusal: "OwnableUnauthorizedAccount(agent)", decision: { source: "contract", outcome: "REVERTED", tier: null, rule: "OwnableUnauthorizedAccount(agent)" } };
const block = {
  scenario: "E-A8", log: "E-A8", entryId: 2, entryHash: "c".repeat(64), kind: "tier_gate_decision", outcome: "BLOCKED", tier: "T3", layer: "tier gate", rule: "OWNER_ONLY_OPERATION", reason: "Owner-only configuration cannot be performed by the agent",
  audit: { id: 2, timestamp: "2026-10-19T08:00:00.000Z", kind: "tier_gate_decision", prevHash: "d".repeat(64), hash: "c".repeat(64) }, chainValid: true,
};
const inspection = {
  generatedAt: "2026-10-19T08:00:00.000Z",
  network: { backend: "fisco", chainId: 1337, rpcUrl: "http://127.0.0.1:8545", clientVersion: "FISCO-BCOS-Web3RPC/3.16.4", firstBlock: 130, lastBlock: 150 },
  totals: { executed: 1, refusals: 2, offChain: 1 },
  auditLogs: { core: { entries: 3, valid: true }, "E-A8": { entries: 2, valid: true } },
  verification: { running: { verifiedAt: "2026-10-19T08:01:00.000Z", passed: true }, fresh: { verifiedAt: "2026-10-19T08:02:00.000Z", passed: true, scenariosMatched: 2, scenarios: 2 } },
  scenarios: [
    { id: "E02", title: "T1 payment", expectation: "", passed: true, detail: "EXECUTED T1", executed: [executed], refusals: [refused], offChain: [] },
    { id: "E-A8", title: "Attack Lab A8", expectation: "", passed: true, detail: "Agent attempts to resume: BLOCKED by tier gate", executed: [], refusals: [reverted], offChain: [block] },
  ],
};

async function mockApi(page: Page) {
  await page.route("http://127.0.0.1:8787/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/state") return route.fulfill({ json: { paused: false, balances: [], spentToday: "0", remainingDaily: "1000", perTxLimit: "500", dailyLimit: "1000", approvalThreshold: "200", recipientCooldown: "600", pendingExpiry: "86400", opsPerCallLimit: "0.1", opsDailyLimit: "5" } });
    if (path === "/pending" || path === "/contacts" || path === "/audit") return route.fulfill({ json: [] });
    if (path === "/evidence") return route.fulfill({ json: inspection });
    if (path === `/evidence/verify/${hash("1")}`) return route.fulfill({ json: { match: true, problems: [], chainId: 1337, rpcUrl: "http://127.0.0.1:8545", receipt: { status: "success", blockNumber: 140 } } });
    if (path === `/evidence/verify/${hash("2")}`) return route.fulfill({ json: { match: false, problems: ["receipt differs from export"], chainId: 1337, rpcUrl: "http://127.0.0.1:8545", receipt: { status: "success", blockNumber: 141 } } });
    if (path === `/evidence/verify/${hash("3")}`) return route.fulfill({ status: 502, json: { error: "NODE_UNAVAILABLE", message: "Could not reach http://127.0.0.1:8545" } });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
}

test.beforeEach(async ({ page }) => { await mockApi(page); await page.goto("/#/evidence"); });

test("shows the info box, network, and the three groups", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Evidence Inspector" })).toBeVisible();
  await expect(page.getByTestId("evidence-info")).toHaveText(INFO);
  await expect(page.getByTestId("evidence-network")).toContainText("FISCO BCOS · chain ID 1337 · blocks 130–150");
  await expect(page.getByTestId("currency-disclaimer")).toHaveText(CNY_DISCLAIMER);
  await expect(page.getByTestId("total-executed")).toHaveText("1");
  await expect(page.getByTestId("total-refusals")).toHaveText("2");
  await expect(page.getByTestId("total-offchain")).toHaveText("1");
  await expect(page.getByTestId("total-verification")).toHaveText("(a) passed · (b) passed");
  await expect(page.getByTestId("group-executed").getByTestId(`tx-${hash("1")}`)).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveText(["Done1", "Refused on-chain2", "Blocked before the chain1"]);
  await page.getByRole("tab", { name: /Refused on-chain/ }).click();
  await expect(page.getByTestId("group-refusals").getByTestId(`tx-${hash("2")}`)).toBeVisible();
  await expect(page.getByTestId("group-refusals").getByTestId(`tx-${hash("3")}`)).toHaveCount(1);
  await expect(page.getByTestId("group-executed")).toBeHidden();
  await page.getByRole("tab", { name: /Blocked before the chain/ }).click();
  await expect(page.getByTestId("group-offchain").getByTestId("offchain-E-A8-2")).toBeVisible();
});

test("opens the executed group per scenario on demand", async ({ page }) => {
  const scenario = page.getByTestId("group-executed").getByTestId("scenario-E02");
  await expect(scenario.getByTestId(`tx-${hash("1")}`)).toBeHidden();
  await scenario.locator("summary").click();
  await expect(scenario.getByTestId(`tx-${hash("1")}`)).toBeVisible();
});

test("shows every field of a transaction, including decoded events and the policy decision", async ({ page }) => {
  const card = page.getByTestId(`tx-${hash("2")}`);
  await expect(card.getByTestId("tx-hash")).toHaveText(hash("2"));
  await expect(card.getByTestId("tx-block")).toHaveText("141");
  await expect(card.getByTestId("tx-chain")).toHaveText("1337");
  await expect(card.getByTestId("tx-contract")).toContainText(`GuardianWallet #1 ${wallet}`);
  await expect(card.getByTestId("tx-function")).toHaveText("requestApproval");
  await expect(card.getByTestId("tx-status-raw")).toHaveText("success");
  await expect(card.getByTestId("tx-status")).toHaveText("Refusal recorded");
  await expect(card.getByTestId("tx-events")).toContainText("PolicyViolation(reason: OVER_PER_TX_LIMIT, amount: 600)");
  await expect(card.getByTestId("tx-decision")).toHaveText("Agent pipeline: BLOCKED · T1 · OVER_PER_TX_LIMIT");
  await expect(page.getByTestId(`tx-${hash("3")}`).getByTestId("tx-status")).toHaveText("Reverted", { useInnerText: false });
});

test("never shows a transaction hash for an off-chain block, only its audit record", async ({ page }) => {
  await page.getByRole("tab", { name: /Blocked before the chain/ }).click();
  const group = page.getByTestId("group-offchain");
  expect(await group.innerText()).not.toMatch(TX_HASH);
  await expect(group.getByTestId("tx-hash")).toHaveCount(0);
  await expect(group.getByTestId("tx-verify")).toHaveCount(0);
  const card = group.getByTestId("offchain-E-A8-2");
  await expect(card.getByTestId("offchain-no-tx")).toBeVisible();
  await expect(card.getByTestId("audit-entry")).toHaveText("E-A8 #2");
  await expect(card.getByTestId("audit-kind")).toHaveText("tier_gate_decision");
  await expect(card.getByTestId("audit-hash")).toHaveText("c".repeat(64));
  await expect(card.getByTestId("audit-chain")).toHaveText("Verifies");
});

test("Verify reports match, mismatch, and an unreachable node", async ({ page }) => {
  await page.getByTestId("group-executed").getByTestId("scenario-E02").locator("summary").click();
  const executedCard = page.getByTestId(`tx-${hash("1")}`);
  await executedCard.getByTestId("tx-verify").click();
  await expect(executedCard.getByTestId("tx-verify-result")).toHaveText("Match · receipt in block 140 on chain 1337, equal to the export");
  await page.getByRole("tab", { name: /Refused on-chain/ }).click();
  await page.getByTestId("group-refusals").getByTestId("scenario-E-A8").locator("summary").click();
  const refusedCard = page.getByTestId(`tx-${hash("2")}`);
  await refusedCard.getByTestId("tx-verify").click();
  await expect(refusedCard.getByTestId("tx-verify-result")).toHaveText("Mismatch · receipt differs from export");
  const revertedCard = page.getByTestId(`tx-${hash("3")}`);
  await revertedCard.getByTestId("tx-verify").click();
  await expect(revertedCard.getByTestId("tx-verify-result")).toHaveText("Could not reach http://127.0.0.1:8545");
});
