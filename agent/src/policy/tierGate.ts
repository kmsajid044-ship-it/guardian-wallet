import type { PolicyVerdict } from "./types.js";
import type { RiskResult } from "../risk/score.js";

export type PermissionTier = "T0" | "T1" | "T2" | "T3";
export type TierDecision = { tier: PermissionTier; allowed: boolean; reason: string };

export function tierGate(input:
  | { operation: "read" }
  | { operation: "owner" }
  | { operation: "agent"; policyRoute: PolicyVerdict["route"]; riskRoute: RiskResult["route"] },
): TierDecision {
  if (input.operation === "read") return { tier: "T0", allowed: true, reason: "Read-only operation" };
  if (input.operation === "owner") return { tier: "T3", allowed: false, reason: "Owner-only configuration cannot be performed by the agent" };
  if (input.riskRoute === "BLOCK") return { tier: "T2", allowed: false, reason: "Risk score is at least 85" };
  if (input.policyRoute === "BLOCKED") return { tier: "T1", allowed: false, reason: "Contract policy blocks the action" };
  if (input.policyRoute === "NEEDS_APPROVAL" || input.riskRoute === "FORCE_APPROVAL") {
    return { tier: "T2", allowed: true, reason: "Owner approval is required" };
  }
  return { tier: "T1", allowed: true, reason: "Autonomous action is within policy and risk limits" };
}
