import { describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit.js";
import type { PipelineResult } from "../pipeline/pipeline.js";
import type { Intake } from "../llm/mock.js";
import { looksLikePlan, PlanManager, type ActionRunner } from "./planner.js";

const llm = { requested: "mock" as const, effective: "mock" as const, fallback: false };
const result = (route: PipelineResult["route"]): PipelineResult => ({ proposal: { kind: "save", currency: "USD", amount: "10", reason: "test", sourceRefs: [] }, route, explanation: route, llm });
const validated = async (): Promise<PipelineResult> => ({ ...result("EXECUTED"), dryRun: true });
const runner = (run: ActionRunner["run"], validate: ActionRunner["validate"] = validated): ActionRunner => ({ run, validate });
const TARGET = "Pay Ana 50 USD, then move 200 CNY to savings, and ask me before anything above 300 USD.";

describe("multi-step planner", () => {
  it("expands the tuition-and-savings request into a visible safety plan", () => {
    const manager = new PlanManager(runner(async () => result("EXECUTED")), new AuditLog(":memory:"));
    const plan = manager.create("Pay my tuition of 1,200 USD this month but keep 300 USD in savings");
    expect(plan.preview).toEqual(["CHECK_BALANCE", "CHECK_LIMITS", "SAVE", "REQUEST_APPROVAL", "EXECUTE_AFTER_APPROVAL"]);
    expect(plan.steps.map((step) => step.proposal)).toMatchObject([
      { kind: "save", amount: "300", currency: "USD" },
      { kind: "pay", recipientContactId: "tuition", amount: "1200", currency: "USD" },
    ]);
  });
  it("shows a draft before execution and allows edits", () => {
    const manager = new PlanManager(runner(async () => result("EXECUTED")), new AuditLog(":memory:"));
    const plan = manager.create("Save 10 USD then Pay Ana 20 USD");
    expect(plan).toMatchObject({ status: "DRAFT", steps: [{ status: "READY" }, { status: "READY" }] });
    const edited = manager.edit(plan.id, [{ kind: "pay", currency: "USD", recipientContactId: "ana", amount: "15", reason: "edited", sourceRefs: [] }]);
    expect(edited.steps[0]!.proposal.amount).toBe("15");
    expect(manager.cancel(edited.id).status).toBe("CANCELLED");
  });

  it("executes in order and stops later dependencies after a failed step", async () => {
    let calls = 0;
    const manager = new PlanManager(runner(async () => result(++calls === 1 ? "BLOCKED" : "EXECUTED")), new AuditLog(":memory:"));
    const plan = manager.create("Save 10 USD then Pay Ana 20 USD");
    const executed = await manager.execute(plan.id);
    expect(calls).toBe(1);
    expect(executed).toMatchObject({ status: "STOPPED", stoppedAt: 0, steps: [{ status: "STOPPED" }, { status: "NOT_RUN" }] });
  });

  it("keeps an untrusted plan's source on every executed step", async () => {
    const sources: string[] = [];
    const manager = new PlanManager(runner(async (intake) => { sources.push(intake.source); return result("NEEDS_APPROVAL"); }), new AuditLog(":memory:"));
    const plan = manager.create("Save 10 USD then Pay Ana 20 USD", "untrusted");
    expect(plan.source).toBe("untrusted");
    const edited = manager.edit(plan.id, [{ kind: "save", currency: "USD", amount: "5", reason: "edited", sourceRefs: [] }]);
    expect(edited.source).toBe("untrusted");
    expect(await manager.execute(plan.id)).toMatchObject({ status: "WAITING_APPROVAL" });
    expect(sources).toEqual(["untrusted"]);
  });

  it("turns the pay, save, and approval-cap request into two steps and an owner cap", () => {
    const manager = new PlanManager(runner(async () => result("EXECUTED")), new AuditLog(":memory:"));
    expect(looksLikePlan(TARGET)).toBe(true);
    expect(looksLikePlan("Pay Ana 50 USD")).toBe(false);
    const plan = manager.create(TARGET);
    expect(plan.approvalCap).toEqual({ currency: "USD", amount: "300" });
    expect(plan.request).toBe(TARGET);
    expect(plan.steps).toMatchObject([
      { id: "S1", state: "PLANNED", operation: "pay", proposal: { kind: "pay", recipientContactId: "ana", amount: "50", currency: "USD" } },
      { id: "S2", state: "PLANNED", operation: "saveToSavings", proposal: { kind: "save", amount: "200", currency: "CNY" } },
    ]);
  });

  it("passes the full request and the owner cap to every validated and executed step", async () => {
    const intakes: Intake[] = [];
    const manager = new PlanManager(runner(async (intake) => { intakes.push(intake); return result("EXECUTED"); }, async (intake) => { intakes.push(intake); return validated(); }), new AuditLog(":memory:"));
    const plan = manager.create(TARGET);
    await manager.validate(plan.id);
    await manager.execute(plan.id);
    expect(intakes).toHaveLength(4);
    for (const intake of intakes) expect(intake.plan).toEqual({ request: TARGET, approvalCap: { currency: "USD", amount: "300" } });
    expect(intakes.map((intake) => intake.message)).toEqual(["Pay ana 50 USD", "Save 200 CNY", "Pay ana 50 USD", "Save 200 CNY"]);
  });

  it("marks a step VALIDATED only when validation predicts it can run", async () => {
    let call = 0;
    const manager = new PlanManager(runner(async () => result("EXECUTED"), async () => ({ ...result(++call === 1 ? "NEEDS_APPROVAL" : "BLOCKED"), dryRun: true })), new AuditLog(":memory:"));
    const plan = await manager.validate(manager.create(TARGET).id);
    expect(plan.steps.map((step) => step.state)).toEqual(["VALIDATED", "PLANNED"]);
    expect(plan.steps[1]!.validation?.route).toBe("BLOCKED");
  });

  it("takes every executed state from the backend route", async () => {
    const routes: PipelineResult["route"][] = ["EXECUTED", "NEEDS_APPROVAL"];
    const manager = new PlanManager(runner(async () => ({ ...result(routes.shift()!), transactionHash: `0x${"1".repeat(64)}`, blockNumber: "7", operation: "pay" as const })), new AuditLog(":memory:"));
    const plan = manager.create("Pay Ana 50 USD then Pay Ana 250 USD then Save 10 USD");
    await manager.validate(plan.id);
    const executed = await manager.execute(plan.id);
    expect(executed.status).toBe("WAITING_APPROVAL");
    expect(executed.steps.map((step) => [step.state, step.status])).toEqual([["EXECUTED", "EXECUTED"], ["PENDING_APPROVAL", "STOPPED"], ["VALIDATED", "NOT_RUN"]]);
  });

  it("records BLOCKED from a refusal and FAILED when the run raises, and stops there", async () => {
    const blocked = new PlanManager(runner(async () => result("BLOCKED")), new AuditLog(":memory:"));
    const blockedPlan = await blocked.execute(blocked.create(TARGET).id);
    expect(blockedPlan).toMatchObject({ status: "STOPPED", stoppedAt: 0, steps: [{ state: "BLOCKED" }, { state: "PLANNED", status: "NOT_RUN" }] });

    const failing = new PlanManager(runner(async () => { throw new Error("node unavailable"); }), new AuditLog(":memory:"));
    const failedPlan = await failing.execute(failing.create(TARGET).id);
    expect(failedPlan).toMatchObject({ status: "STOPPED", stoppedAt: 0, steps: [{ state: "FAILED", error: "node unavailable" }, { state: "PLANNED", status: "NOT_RUN" }] });
    expect(failedPlan.steps[0]!.result).toBeUndefined();
  });

  it("keeps a step PLANNED with the error when validation itself fails", async () => {
    const manager = new PlanManager(runner(async () => result("EXECUTED"), async () => { throw new Error("rpc down"); }), new AuditLog(":memory:"));
    const plan = await manager.validate(manager.create(TARGET).id);
    expect(plan.steps.every((step) => step.state === "PLANNED" && step.error === "validation failed: rpc down")).toBe(true);
  });

  it("refuses a cap clause without a currency and keeps unrelated wording out of the cap", () => {
    const manager = new PlanManager(runner(async () => result("EXECUTED")), new AuditLog(":memory:"));
    expect(() => manager.create("Pay Ana 50 USD, then move 200 CNY to savings, and ask me before anything above 300")).toThrow();
    expect(manager.create("Pay Ana 50 USD then Save 10 USD").approvalCap).toBeUndefined();
  });
});
