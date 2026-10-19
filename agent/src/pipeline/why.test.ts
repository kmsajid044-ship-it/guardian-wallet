import { describe, expect, it } from "vitest";
import type { AuditEntry, JsonValue } from "../audit/audit.js";
import { buildWhy, pendingExplanations, riskClassOf } from "./why.js";

const factor = { code: "FIRST_PAYMENT", points: 10, explanation: "This is the first recorded payment to the contact." };

describe("risk class", () => {
  it.each([
    ["ALLOW", "low"],
    ["FORCE_APPROVAL", "needs approval"],
    ["BLOCK", "blocked"],
    [undefined, "not scored"],
  ] as const)("maps %s to %s", (route, expected) => {
    expect(riskClassOf(route)).toBe(expected);
  });
});

describe("buildWhy", () => {
  it("reports a low-score autonomous action decided by the tier gate", () => {
    const why = buildWhy({
      decision: "EXECUTED",
      risk: { score: 10, factors: [factor], route: "ALLOW" },
      layer: "tier gate", rule: "WITHIN_POLICY_AND_RISK_LIMITS", detail: "Policy, simulation, risk, and tier checks all passed.",
    });
    expect(why).toEqual({
      decision: "EXECUTED", riskScore: 10, riskClass: "low", factors: [factor],
      decidedBy: { layer: "tier gate", rule: "WITHIN_POLICY_AND_RISK_LIMITS", detail: "Policy, simulation, risk, and tier checks all passed.", ownerApprovalRequired: false },
    });
  });

  it("marks owner approval on a held action and keeps only computed factors", () => {
    const why = buildWhy({
      decision: "NEEDS_APPROVAL",
      risk: { score: 75, factors: [factor], route: "FORCE_APPROVAL" },
      layer: "risk engine", rule: "RISK_SCORE_60_TO_84", detail: "Risk score is at least 60",
    });
    expect(why.riskClass).toBe("needs approval");
    expect(why.factors).toEqual([factor]);
    expect(why.decidedBy.ownerApprovalRequired).toBe(true);
  });

  it("reports an unscored action stopped before the risk engine ran", () => {
    const why = buildWhy({ decision: "BLOCKED", layer: "firewall", rule: "INSTRUCTION_INJECTION", detail: "The firewall refused the request." });
    expect(why).toMatchObject({ riskScore: null, riskClass: "not scored", factors: [], decidedBy: { ownerApprovalRequired: false } });
  });
});

describe("pendingExplanations", () => {
  const entry = (id: number, data: JsonValue): AuditEntry => ({
    id, timestamp: "2026-10-19T00:00:00.000Z", kind: "pipeline_result", data, prevHash: "0".repeat(64), hash: String(id).repeat(64),
  });
  const why = buildWhy({ decision: "NEEDS_APPROVAL", risk: { score: 10, factors: [factor], route: "ALLOW" }, layer: "contract", rule: "APPROVAL_THRESHOLD", detail: "Threshold reached." });

  it("keys the latest explanation by pending ID", () => {
    const older = { ...why, decidedBy: { ...why.decidedBy, rule: "OLD_RULE" } };
    const map = pendingExplanations([
      entry(1, { pendingId: "1", why: older }),
      entry(2, { route: "EXECUTED" }),
      entry(3, { pendingId: "1", why }),
      entry(4, { pendingId: "2", why: null }),
    ]);
    expect(map.get("1")).toEqual(why);
    expect(map.has("2")).toBe(false);
  });

  it("ignores malformed or missing explanations", () => {
    const map = pendingExplanations([
      entry(1, { pendingId: "7", why: { decision: "NEEDS_APPROVAL" } }),
      entry(2, { pendingId: "8" }),
      entry(3, "not-an-object"),
    ]);
    expect(map.size).toBe(0);
  });
});
