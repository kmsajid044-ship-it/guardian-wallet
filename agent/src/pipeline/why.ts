import type { AuditEntry } from "../audit/audit.js";
import type { RiskFactor } from "../risk/score.js";

export type RiskRoute = "ALLOW" | "FORCE_APPROVAL" | "BLOCK";
/** "not scored" means the risk engine never ran (the request stopped at an earlier layer). */
export type RiskClass = "low" | "needs approval" | "blocked" | "not scored";
export type DecisionLayer = "firewall" | "risk engine" | "tier gate" | "contract" | "pipeline";

export type WhyDecision = {
  decision: string;
  riskScore: number | null;
  riskClass: RiskClass;
  /** Exactly the factors the risk engine computed for this action; never invented signals. */
  factors: RiskFactor[];
  decidedBy: { layer: DecisionLayer; rule: string; detail: string; ownerApprovalRequired: boolean };
};

export function riskClassOf(route: RiskRoute | undefined): RiskClass {
  if (route === "ALLOW") return "low";
  if (route === "FORCE_APPROVAL") return "needs approval";
  if (route === "BLOCK") return "blocked";
  return "not scored";
}

export function buildWhy(input: {
  decision: string;
  risk?: { score: number; factors: RiskFactor[]; route: RiskRoute } | undefined;
  layer: DecisionLayer;
  rule: string;
  detail: string;
}): WhyDecision {
  return {
    decision: input.decision,
    riskScore: input.risk?.score ?? null,
    riskClass: riskClassOf(input.risk?.route),
    factors: input.risk?.factors ?? [],
    decidedBy: {
      layer: input.layer,
      rule: input.rule,
      detail: input.detail,
      ownerApprovalRequired: input.decision === "NEEDS_APPROVAL",
    },
  };
}

/** Latest recorded explanation per on-chain pending item, keyed by pending ID. */
export function pendingExplanations(entries: readonly AuditEntry[]): Map<string, WhyDecision> {
  const found = new Map<string, WhyDecision>();
  for (const entry of [...entries].reverse()) {
    if (entry.kind !== "pipeline_result") continue;
    const data = entry.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
    const record = data as { pendingId?: unknown; why?: unknown };
    if (typeof record.pendingId !== "string" || found.has(record.pendingId)) continue;
    if (!isWhyDecision(record.why)) continue;
    found.set(record.pendingId, record.why);
  }
  return found;
}

function isWhyDecision(value: unknown): value is WhyDecision {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<WhyDecision>;
  const decidedBy = candidate.decidedBy as WhyDecision["decidedBy"] | undefined;
  return typeof candidate.decision === "string"
    && (candidate.riskScore === null || typeof candidate.riskScore === "number")
    && typeof candidate.riskClass === "string"
    && Array.isArray(candidate.factors)
    && typeof decidedBy === "object" && decidedBy !== null
    && typeof decidedBy.layer === "string"
    && typeof decidedBy.rule === "string"
    && typeof decidedBy.detail === "string"
    && typeof decidedBy.ownerApprovalRequired === "boolean";
}
