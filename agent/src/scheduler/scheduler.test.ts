import { describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit.js";
import type { PipelineResult } from "../pipeline/pipeline.js";
import { RecurringScheduler } from "./scheduler.js";

describe("recurring scheduler", () => {
  it("routes every due occurrence through the full pipeline runner and advances its deadline", async () => {
    const calls: string[] = [];
    const response: PipelineResult = { proposal: { kind: "pay", currency: "USD", recipientContactId: "ana", amount: "5", reason: "scheduled", sourceRefs: [] }, route: "EXECUTED", explanation: "ok", llm: { requested: "mock", effective: "mock", fallback: false } };
    const scheduler = new RecurringScheduler({ run: async (intake) => { calls.push(intake.message); return response; } }, new AuditLog(":memory:"));
    const job = scheduler.add({ contactId: "ana", amount: "5", intervalSeconds: 86_400, nextRunAt: 100 });
    expect(await scheduler.runDue(99)).toEqual([]);
    expect(await scheduler.runDue(100)).toHaveLength(1);
    expect(calls).toEqual(["Pay ana 5 USD"]);
    expect(job.nextRunAt).toBe(86_500);
  });
});
