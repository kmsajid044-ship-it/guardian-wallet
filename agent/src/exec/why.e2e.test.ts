import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toCurrencyCode } from "../currency/registry.js";
import { demoLedgerAbi } from "../chain/abi.js";
import type { Config, Deployment } from "../config.js";
import { startAnvilFixture, type AnvilFixture } from "../test/anvil.js";
import { buildServer } from "../api/server.js";

type App = ReturnType<typeof buildServer>;

/** The owner console's "Why this action?" panel is only as truthful as these fields. */
describe("why this action", () => {
  let fixture: AnvilFixture;
  let directory: string;
  const apps: App[] = [];

  beforeAll(async () => {
    fixture = await startAnvilFixture();
    directory = mkdtempSync(join(tmpdir(), "guardian-why-"));
  }, 60_000);

  afterAll(async () => {
    for (const app of apps) await app.close();
    if (fixture) await fixture.stop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("explains a low-risk autonomous payment with only the factors the engine computed", async () => {
    const app = await buildChatApp("low", { score: 8, sanctioned: false });
    const response = await app.inject({ method: "POST", url: "/chat", payload: { message: "Pay ana 5 USD", source: "trusted" } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ route: "EXECUTED", tier: "T1" });
    expect(body.why).toEqual({
      decision: "EXECUTED",
      riskScore: 10,
      riskClass: "low",
      factors: [{ code: "FIRST_PAYMENT", points: 10, explanation: expect.any(String) }],
      decidedBy: { layer: "tier gate", rule: "WITHIN_POLICY_AND_RISK_LIMITS", detail: expect.any(String), ownerApprovalRequired: false },
    });
    expect(body.why.factors).toEqual(body.risk.factors);
  }, 20_000);

  it("explains an approval-level risk score as decided by the risk engine", async () => {
    // The owner's usual hours exclude the current hour, so OUTSIDE_USUAL_HOURS applies on top of the payee check.
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const activeHours = `${String((hour + 1) % 24).padStart(2, "0")}-${String((hour + 2) % 24).padStart(2, "0")}`;
    const app = await buildChatApp("approval", { score: 75, sanctioned: false }, activeHours);
    const response = await app.inject({ method: "POST", url: "/chat", payload: { message: "Pay ana 5 USD", source: "trusted" } });
    const body = response.json();
    expect(body.risk).toMatchObject({ score: 60, route: "FORCE_APPROVAL" });
    expect(body).toMatchObject({ route: "NEEDS_APPROVAL", tier: "T2" });
    expect(body.transactionHash).toBeUndefined();
    expect(body.pendingId).toBeUndefined();
    expect(body.why).toEqual({
      decision: "NEEDS_APPROVAL",
      riskScore: 60,
      riskClass: "needs approval",
      factors: [
        { code: "FIRST_PAYMENT", points: 10, explanation: expect.any(String) },
        { code: "OUTSIDE_USUAL_HOURS", points: 10, explanation: expect.any(String) },
        { code: "RISK_INTEL_HIGH", points: 40, explanation: expect.any(String) },
      ],
      decidedBy: { layer: "risk engine", rule: "RISK_SCORE_60_TO_84", detail: expect.any(String), ownerApprovalRequired: true },
    });
  }, 20_000);

  it("explains a blocked risk score as decided by the risk engine with no approval escape", async () => {
    const app = await buildChatApp("blocked", { score: 1, sanctioned: true });
    const response = await app.inject({ method: "POST", url: "/chat", payload: { message: "Pay ana 5 USD", source: "trusted" } });
    const body = response.json();
    expect(body.risk).toMatchObject({ route: "BLOCK" });
    expect(body).toMatchObject({ route: "BLOCKED" });
    expect(body.why).toMatchObject({
      decision: "BLOCKED",
      riskClass: "blocked",
      factors: [
        expect.objectContaining({ code: "FIRST_PAYMENT", points: 10 }),
        expect.objectContaining({ code: "RISK_INTEL_SANCTIONED", points: 100 }),
      ],
      decidedBy: { layer: "risk engine", rule: "RISK_SCORE_AT_LEAST_85", ownerApprovalRequired: false },
    });
    expect(body.why.riskScore).toBe(body.risk.score);
    expect(body.why.riskScore).toBeGreaterThanOrEqual(85);
  }, 20_000);

  it("lets stricter contract policy win over a low risk score", async () => {
    const app = await buildChatApp("stricter", { score: 8, sanctioned: false });
    const approvalSized = (await app.inject({ method: "POST", url: "/chat", payload: { message: "Pay ana 200 USD", source: "trusted" } })).json();
    expect(approvalSized.risk).toMatchObject({ score: 10, route: "ALLOW" });
    expect(approvalSized).toMatchObject({ route: "NEEDS_APPROVAL", tier: "T2", pendingId: "1" });
    expect(approvalSized.why).toMatchObject({
      decision: "NEEDS_APPROVAL", riskScore: 10, riskClass: "low",
      decidedBy: { layer: "contract", rule: "APPROVAL_THRESHOLD", ownerApprovalRequired: true },
    });

    const overLimit = (await app.inject({ method: "POST", url: "/chat", payload: { message: "Pay ana 600 USD", source: "trusted" } })).json();
    expect(overLimit).toMatchObject({ route: "BLOCKED", flags: ["OVER_PER_TX_LIMIT"], transactionHash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(overLimit.why).toMatchObject({
      decision: "BLOCKED", riskScore: null, riskClass: "not scored", factors: [],
      decidedBy: { layer: "contract", rule: "OVER_PER_TX_LIMIT", ownerApprovalRequired: false },
    });

    // The approval inbox reads the same explanation back from the audit chain.
    const pending = (await app.inject({ method: "GET", url: "/pending" })).json();
    expect(pending).toMatchObject([{ id: "1", status: "PENDING", why: { decision: "NEEDS_APPROVAL", riskClass: "low", decidedBy: { layer: "contract", rule: "APPROVAL_THRESHOLD" } } }]);
    const verify = await app.inject({ method: "GET", url: "/audit/verify" });
    expect(verify.json()).toMatchObject({ valid: true });
  }, 20_000);

  it("gives the same input the same score and the same explanation", async () => {
    const first = await buildChatApp("deterministic-a", { score: 8, sanctioned: false });
    const second = await buildChatApp("deterministic-b", { score: 8, sanctioned: false });
    const firstBody = (await first.inject({ method: "POST", url: "/chat", payload: { message: "Pay ana 7 USD", source: "trusted" } })).json();
    const secondBody = (await second.inject({ method: "POST", url: "/chat", payload: { message: "Pay ana 7 USD", source: "trusted" } })).json();
    expect(firstBody.why.riskScore).toBe(secondBody.why.riskScore);
    expect(firstBody.why).toEqual(secondBody.why);
  }, 20_000);

  it("explains a repeated attempt exactly the same way and still moves nothing", async () => {
    const app = await buildChatApp("repeat", { score: 8, sanctioned: false });
    const payload = { message: "Pay ana 10 USD", source: "untrusted" as const, sourceRefs: ["invoice:repeated"] };
    const received = () => fixture.publicClient.readContract({ address: fixture.ledger, abi: demoLedgerAbi, functionName: "balanceOf", args: [fixture.activeRecipient, toCurrencyCode("USD")] });
    const before = await received();
    const first = (await app.inject({ method: "POST", url: "/chat", payload })).json();
    const second = (await app.inject({ method: "POST", url: "/chat", payload })).json();
    expect(first).toMatchObject({ route: "NEEDS_APPROVAL", tier: "T2", flags: ["UNTRUSTED_SOURCE_REQUIRES_APPROVAL"] });
    expect(first.transactionHash).toBeUndefined();
    expect(first.pendingId).toBeUndefined();
    expect(second.why).toEqual(first.why);
    expect(first.why).toMatchObject({
      riskScore: 30, riskClass: "low",
      factors: [expect.objectContaining({ code: "UNTRUSTED_SOURCE", points: 20 }), expect.objectContaining({ code: "FIRST_PAYMENT", points: 10 })],
      decidedBy: { layer: "tier gate", rule: "UNTRUSTED_SOURCE_REQUIRES_APPROVAL", ownerApprovalRequired: true },
    });
    expect(await received()).toBe(before);
    const audit = (await app.inject({ method: "GET", url: "/audit" })).json() as Array<{ kind: string; data: { decision?: { riskFactors?: unknown[]; why?: { riskScore?: number } } } }>;
    const decisions = audit.filter((entry) => entry.kind === "pipeline_result").map((entry) => entry.data.decision);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]?.riskFactors).toEqual(decisions[1]?.riskFactors);
    expect(decisions[0]?.why?.riskScore).toBe(decisions[1]?.why?.riskScore);
  }, 20_000);

  async function buildChatApp(name: string, intel: { score: number; sanctioned: boolean }, ownerActiveHours = "00-24"): Promise<App> {
    const config: Config = {
      CHAIN_BACKEND: "evm-local",
      AGENT_PORT: 8787,
      RPC_URL: fixture.rpcUrl,
      CHAIN_ID: 31337,
      DEPLOYMENTS_FILE: "unused.json",
      AUDIT_DB_PATH: join(directory, `${name}.sqlite`),
      LLM_PROVIDER: "mock",
      OWNER_TIMEZONE: "UTC",
      OWNER_ACTIVE_HOURS: ownerActiveHours,
    };
    const deployment: Deployment = {
      network: "why-e2e",
      chainId: 31337,
      deployedAt: 1,
      guardianWallet: fixture.wallet,
      demoLedger: fixture.ledger,
      owner: fixture.owner,
      agent: fixture.agent,
      guardian: "0x0000000000000000000000000000000000000000",
      feeAccount: fixture.service,
    };
    const app = buildServer(config, {
      deployment,
      environment: { AGENT_PRIVATE_KEY: fixture.agentKey, OWNER_PRIVATE_KEY: fixture.ownerKey },
      contacts: { ana: fixture.activeRecipient },
      evalResultsPath: join(directory, "no-eval-yet.json"),
      riskIntel: {
        checkPayee: async (address) => ({
          address,
          level: intel.sanctioned ? "high" : intel.score >= 70 ? "high" : intel.score >= 40 ? "medium" : "low",
          score: intel.score,
          sanctioned: intel.sanctioned,
          reasons: ["synthetic payee check"],
        }),
      },
    });
    await app.ready();
    apps.push(app);
    return app;
  }
});
