import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoLedgerAbi } from "../chain/abi.js";
import type { Config, Deployment } from "../config.js";
import { toCurrencyCode } from "../currency/registry.js";
import { startAnvilFixture, type AnvilFixture } from "../test/anvil.js";
import { buildServer } from "../api/server.js";

const TARGET = "Pay Ana 50 USD, then move 200 CNY to savings, and ask me before anything above 300 USD.";
const HASH = /^0x[0-9a-f]{64}$/;

type Step = { id: string; state: string; operation: string; validation?: { route: string; tier?: string; dryRun?: boolean; transactionHash?: string; risk?: { score: number } }; result?: { route: string; tier?: string; transactionHash?: string; blockNumber?: string; flags?: string[]; risk?: { score: number } } };
type PlanBody = { id: string; status: string; approvalCap?: { currency: string; amount: string }; steps: Step[] };

describe("multi-step plan through the agent API on a local chain", () => {
  let fixture: AnvilFixture;
  let directory: string;
  let app: ReturnType<typeof buildServer>;

  const balance = (functionName: "balanceOf" | "savingsBalance", account: `0x${string}`, code: string) =>
    fixture.publicClient.readContract({ address: fixture.ledger, abi: demoLedgerAbi, functionName, args: [account, toCurrencyCode(code)] });
  const auditKinds = async () => (await app.inject({ method: "GET", url: "/audit" })).json<Array<{ kind: string }>>().map((entry) => entry.kind);

  beforeAll(async () => {
    fixture = await startAnvilFixture();
    directory = mkdtempSync(join(tmpdir(), "guardian-plan-"));
    const config: Config = {
      CHAIN_BACKEND: "evm-local", AGENT_PORT: 8787, RPC_URL: fixture.rpcUrl, CHAIN_ID: 31337, DEPLOYMENTS_FILE: "unused.json",
      AUDIT_DB_PATH: join(directory, "audit.sqlite"), LLM_PROVIDER: "mock", OWNER_TIMEZONE: "UTC", OWNER_ACTIVE_HOURS: "00-24",
    };
    const deployment: Deployment = {
      network: "integration", chainId: 31337, deployedAt: 1, guardianWallet: fixture.wallet, demoLedger: fixture.ledger,
      owner: fixture.owner, agent: fixture.agent, guardian: "0x0000000000000000000000000000000000000000", feeAccount: fixture.service,
    };
    app = buildServer(config, {
      deployment, environment: { AGENT_PRIVATE_KEY: fixture.agentKey, OWNER_PRIVATE_KEY: fixture.ownerKey },
      contacts: { ana: fixture.activeRecipient }, evalResultsPath: join(directory, "no-eval-yet.json"),
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    if (fixture) await fixture.stop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("validates the plan from chat without signing anything", async () => {
    const anaBefore = await balance("balanceOf", fixture.activeRecipient, "USD");
    const savingsBefore = await balance("savingsBalance", fixture.wallet, "CNY");
    const blockBefore = await fixture.publicClient.getBlockNumber();
    const response = await app.inject({ method: "POST", url: "/chat", payload: { message: TARGET, source: "trusted", sourceRefs: ["web:chat"] } });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ route: string; tier: string; plan: PlanBody }>();
    expect(body.route).toBe("PLAN");
    expect(body.plan).toMatchObject({ status: "DRAFT", approvalCap: { currency: "USD", amount: "300" } });
    expect(body.plan.steps).toMatchObject([
      { id: "S1", state: "VALIDATED", operation: "pay", validation: { route: "EXECUTED", tier: "T1", dryRun: true } },
      { id: "S2", state: "VALIDATED", operation: "saveToSavings", validation: { route: "EXECUTED", tier: "T1", dryRun: true } },
    ]);
    for (const step of body.plan.steps) {
      expect(step.validation?.transactionHash).toBeUndefined();
      expect(typeof step.validation?.risk?.score).toBe("number");
    }
    expect(await fixture.publicClient.getBlockNumber()).toBe(blockBefore);
    expect(await balance("balanceOf", fixture.activeRecipient, "USD")).toBe(anaBefore);
    expect(await balance("savingsBalance", fixture.wallet, "CNY")).toBe(savingsBefore);
    const kinds = await auditKinds();
    expect(kinds).toContain("plan_step_validated");
    expect(kinds).not.toContain("pipeline_result");
  });

  it("executes both steps in order with real receipts", async () => {
    const created = (await app.inject({ method: "POST", url: "/chat", payload: { message: TARGET, source: "trusted" } })).json<{ plan: PlanBody }>().plan;
    const anaBefore = await balance("balanceOf", fixture.activeRecipient, "USD");
    const savingsBefore = await balance("savingsBalance", fixture.wallet, "CNY");
    const response = await app.inject({ method: "POST", url: `/plans/${created.id}/execute` });
    expect(response.statusCode).toBe(200);
    const plan = response.json<PlanBody>();
    expect(plan.status).toBe("COMPLETED");
    expect(plan.steps.map((step) => [step.id, step.state, step.result?.route])).toEqual([["S1", "EXECUTED", "EXECUTED"], ["S2", "EXECUTED", "EXECUTED"]]);
    for (const step of plan.steps) {
      expect(step.result?.transactionHash).toMatch(HASH);
      const receipt = (await app.inject({ method: "GET", url: `/receipt/${step.result!.transactionHash}` })).json<{ status: string; blockNumber: string }>();
      expect(receipt).toMatchObject({ status: "success", blockNumber: step.result!.blockNumber });
    }
    expect(BigInt(plan.steps[1]!.result!.blockNumber!)).toBeGreaterThan(BigInt(plan.steps[0]!.result!.blockNumber!));
    expect(await balance("balanceOf", fixture.activeRecipient, "USD")).toBe(anaBefore + 50_000_000n);
    // Savings accrue simulated interest over time, so assert the principal moved, not an exact total.
    expect(await balance("savingsBalance", fixture.wallet, "CNY")).toBeGreaterThanOrEqual(savingsBefore + 200_000_000n);
    expect(await auditKinds()).toContain("plan_completed");
  }, 30_000);

  it("holds a step above the owner's cap off-chain even when the contract would execute it", async () => {
    const created = (await app.inject({ method: "POST", url: "/chat", payload: { message: "Save 10 USD, then move 350 USD to savings, and ask me before anything above 300 USD", source: "trusted" } })).json<{ plan: PlanBody }>().plan;
    expect(created.steps.map((step) => [step.state, step.validation?.route])).toEqual([["VALIDATED", "EXECUTED"], ["VALIDATED", "NEEDS_APPROVAL"]]);
    const savingsBefore = await balance("savingsBalance", fixture.wallet, "USD");
    const plan = (await app.inject({ method: "POST", url: `/plans/${created.id}/execute` })).json<PlanBody>();
    expect(plan.status).toBe("WAITING_APPROVAL");
    expect(plan.steps.map((step) => step.state)).toEqual(["EXECUTED", "PENDING_APPROVAL"]);
    expect(plan.steps[1]!.result).toMatchObject({ route: "NEEDS_APPROVAL", tier: "T2", flags: ["OWNER_PLAN_APPROVAL_CAP"] });
    expect(plan.steps[1]!.result?.transactionHash).toBeUndefined();
    const saved = await balance("savingsBalance", fixture.wallet, "USD") - savingsBefore;
    expect(saved >= 10_000_000n && saved < 350_000_000n).toBe(true);
  }, 30_000);

  it("never lets the cap loosen the contract threshold", async () => {
    const created = (await app.inject({ method: "POST", url: "/chat", payload: { message: "Save 1 USD then Pay Ana 250 USD, and ask me before anything above 1000 USD", source: "trusted" } })).json<{ plan: PlanBody }>().plan;
    const plan = (await app.inject({ method: "POST", url: `/plans/${created.id}/execute` })).json<PlanBody>();
    expect(plan.steps.map((step) => [step.state, step.operation])).toEqual([["EXECUTED", "saveToSavings"], ["PENDING_APPROVAL", "requestApproval"]]);
    expect(plan.steps[1]!.result?.transactionHash).toMatch(HASH);
  }, 30_000);

  it("falls back to the single-action pipeline when a 'then' request does not parse as a plan", async () => {
    const response = await app.inject({ method: "POST", url: "/chat", payload: { message: "Pay Ana then do something", source: "trusted" } });
    expect(response.json()).toMatchObject({ route: "ANSWER_ONLY" });
  });
});
