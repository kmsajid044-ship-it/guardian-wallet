import { describe, expect, it } from "vitest";
import type { AuditEntry, JsonValue } from "../audit/audit.js";
import { liveValueMetrics } from "./valueMetrics.js";

let id = 0;
const entry = (kind: string, data: JsonValue): AuditEntry => ({ id: ++id, timestamp: `2026-10-16T10:00:${String(id).padStart(2, "0")}.000Z`, kind, data, prevHash: "0".repeat(64), hash: "f".repeat(64) });
const decision = (route: string, proposal: JsonValue) => entry("pipeline_result", { route, proposal });

describe("liveValueMetrics", () => {
  it("returns zeros for an empty audit log", () => {
    expect(liveValueMetrics([])).toMatchObject({ decisions: 0, movedOut: { USD: "0", BDT: "0" }, estimatedMinutesSaved: 0, lastActivity: null });
  });

  it("counts routes, value moved, value blocked, and attack results from audit entries", () => {
    const metrics = liveValueMetrics([
      decision("EXECUTED", { kind: "pay", currency: "USD", amount: "50.25", recipientContactId: "ana" }),
      decision("EXECUTED", { kind: "save", currency: "BDT", amount: "500" }),
      decision("NEEDS_APPROVAL", { kind: "pay", currency: "USD", amount: "250" }),
      decision("BLOCKED", { kind: "pay", currency: "USD", amount: "600" }),
      decision("BLOCKED", { kind: "pay", currency: "BDT", amount: "abc" }),
      decision("ANSWER_ONLY", { kind: "answer_only" }),
      decision("SCHEDULE_READY", { kind: "schedule_recurring", currency: "USD", amount: "20" }),
      entry("pending_approved", { transactionHash: "0x1" }),
      entry("wallet_paused", { transactionHash: "0x2" }),
      entry("attack_lab_result", { status: "BLOCKED" }),
      entry("attack_lab_result", { status: "NOT_BLOCKED" }),
      entry("risk_intel_fee", { amount: "50000" }),
    ]);
    expect(metrics).toMatchObject({
      decisions: 7,
      routes: { EXECUTED: 2, NEEDS_APPROVAL: 1, BLOCKED: 2, ANSWER_ONLY: 1, SCHEDULE_READY: 1 },
      ownerApprovals: 1, pauses: 1,
      movedOut: { USD: "50.25", BDT: "0" }, savedToSavings: { USD: "0", BDT: "500" }, blockedValue: { USD: "600", BDT: "0" },
      attackLab: { runs: 2, blocked: 1 },
      estimatedMinutesSaved: 13.5,
    });
  });
});
