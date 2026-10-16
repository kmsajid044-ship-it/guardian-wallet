import type { AuditEntry, JsonValue } from "../audit/audit.js";
import { manualMinutesByTask, ownerReviewMinutes } from "./baselines.js";

type Currency = "USD" | "BDT";
export type LiveValueMetrics = {
  decisions: number;
  routes: Record<"EXECUTED" | "NEEDS_APPROVAL" | "BLOCKED" | "ANSWER_ONLY" | "SCHEDULE_READY", number>;
  ownerApprovals: number;
  pauses: number;
  movedOut: Record<Currency, string>;
  savedToSavings: Record<Currency, string>;
  blockedValue: Record<Currency, string>;
  attackLab: { runs: number; blocked: number };
  estimatedMinutesSaved: number;
  lastActivity: string | null;
};

type Record_ = { [key: string]: JsonValue };
const isRecord = (value: JsonValue | undefined): value is Record_ => typeof value === "object" && value !== null && !Array.isArray(value);
const UNIT = 1_000_000n;

/** Live counts derived only from the hash-chained audit log. Amounts are decimal strings. */
export function liveValueMetrics(entries: readonly AuditEntry[]): LiveValueMetrics {
  const routes = { EXECUTED: 0, NEEDS_APPROVAL: 0, BLOCKED: 0, ANSWER_ONLY: 0, SCHEDULE_READY: 0 };
  const movedOut = { USD: 0n, BDT: 0n };
  const saved = { USD: 0n, BDT: 0n };
  const blocked = { USD: 0n, BDT: 0n };
  let decisions = 0; let ownerApprovals = 0; let pauses = 0; let attackRuns = 0; let attackBlocked = 0; let minutes = 0;
  for (const entry of entries) {
    const data = entry.data;
    if (entry.kind === "pending_approved") { ownerApprovals += 1; continue; }
    if (entry.kind === "wallet_paused") { pauses += 1; continue; }
    if (entry.kind === "attack_lab_result" && isRecord(data)) { attackRuns += 1; if (data.status === "BLOCKED") attackBlocked += 1; continue; }
    if (entry.kind !== "pipeline_result" || !isRecord(data)) continue;
    const route = data.route;
    if (typeof route !== "string" || !(route in routes)) continue;
    decisions += 1;
    routes[route as keyof typeof routes] += 1;
    const proposal = isRecord(data.proposal) ? data.proposal : undefined;
    const kind = proposal?.kind;
    const currency: Currency = proposal?.currency === "BDT" ? "BDT" : "USD";
    const amount = typeof proposal?.amount === "string" ? parseDecimal(proposal.amount) : undefined;
    if (route === "EXECUTED" && amount !== undefined) {
      if (kind === "pay") { movedOut[currency] += amount; minutes += manualMinutesByTask.pay; }
      if (kind === "save") { saved[currency] += amount; minutes += manualMinutesByTask.save; }
    }
    if (route === "NEEDS_APPROVAL") minutes += manualMinutesByTask.approval - ownerReviewMinutes;
    if (route === "SCHEDULE_READY") minutes += manualMinutesByTask.schedule;
    if (route === "BLOCKED" && amount !== undefined) blocked[currency] += amount;
  }
  return {
    decisions, routes, ownerApprovals, pauses,
    movedOut: format(movedOut), savedToSavings: format(saved), blockedValue: format(blocked),
    attackLab: { runs: attackRuns, blocked: attackBlocked },
    estimatedMinutesSaved: Math.round(minutes * 10) / 10,
    lastActivity: entries.at(-1)?.timestamp ?? null,
  };
}

function parseDecimal(value: string): bigint | undefined {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(value);
  if (!match) return undefined;
  return BigInt(match[1]!) * UNIT + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function format(values: Record<Currency, bigint>): Record<Currency, string> {
  const one = (value: bigint) => { const whole = value / UNIT; const fraction = (value % UNIT).toString().padStart(6, "0").replace(/0+$/, ""); return fraction ? `${whole}.${fraction}` : whole.toString(); };
  return { USD: one(values.USD), BDT: one(values.BDT) };
}
