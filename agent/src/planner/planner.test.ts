import { describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit.js";
import type { PipelineResult } from "../pipeline/pipeline.js";
import { PlanManager } from "./planner.js";

const llm = { requested: "mock" as const, effective: "mock" as const, fallback: false };
const result = (route: PipelineResult["route"]): PipelineResult => ({ proposal: { kind: "save", currency: "USD", amount: "10", reason: "test", sourceRefs: [] }, route, explanation: route, llm });

describe("multi-step planner", () => {
  it("shows a draft before execution and allows edits", () => {
    const manager = new PlanManager({ run: async () => result("EXECUTED") }, new AuditLog(":memory:"));
    const plan = manager.create("Save 10 USD then Pay Ana 20 USD");
    expect(plan).toMatchObject({ status: "DRAFT", steps: [{ status: "READY" }, { status: "READY" }] });
    const edited = manager.edit(plan.id, [{ kind: "pay", currency: "USD", recipientContactId: "ana", amount: "15", reason: "edited", sourceRefs: [] }]);
    expect(edited.steps[0]!.proposal.amount).toBe("15");
    expect(manager.cancel(edited.id).status).toBe("CANCELLED");
  });

  it("executes in order and stops later dependencies after a failed step", async () => {
    let calls = 0;
    const manager = new PlanManager({ run: async () => result(++calls === 1 ? "BLOCKED" : "EXECUTED") }, new AuditLog(":memory:"));
    const plan = manager.create("Save 10 USD then Pay Ana 20 USD");
    const executed = await manager.execute(plan.id);
    expect(calls).toBe(1);
    expect(executed).toMatchObject({ status: "STOPPED", stoppedAt: 0, steps: [{ status: "STOPPED" }, { status: "NOT_RUN" }] });
  });
});
