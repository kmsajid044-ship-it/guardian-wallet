import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex } from "viem";
import { verifyAuditChain, type AuditEntry } from "../audit/audit.js";
import type { EvidenceEvent, EvidenceRun, EvidenceTx } from "./runner.js";
import type { Verification } from "./doc.js";

/**
 * One decision the agent recorded in a hash-chained audit log during an evidence scenario: a
 * pipeline result or a tier-gate refusal. An off-chain decision sent nothing to the chain, so it
 * has no transaction hash; its proof is the audit entry.
 */
export type EvidenceDecision = {
  scenario: string;
  /** Key into `EvidenceRun.auditLogs`. */
  log: string;
  entryId: number;
  entryHash: string;
  kind: string;
  outcome: string;
  tier: string | null;
  layer: string;
  rule: string;
  reason: string;
  transactionHash: Hex | null;
  blockNumber: string | null;
  offChain: boolean;
};

type Json = Record<string, unknown>;
const record = (value: unknown): Json | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

/** Pipeline results and tier-gate refusals in an audit log, attributed to the scenario that wrote them. */
export function decisionsFromAudit(scenario: string, log: string, entries: readonly AuditEntry[]): EvidenceDecision[] {
  return entries.flatMap((entry): EvidenceDecision[] => {
    if (entry.kind !== "pipeline_result" && entry.kind !== "tier_gate_decision") return [];
    const data = record(entry.data);
    const decision = record(data?.decision);
    if (!data || !decision) return [];
    const why = record(decision.why) ?? record(data.why);
    const decidedBy = record(why?.decidedBy);
    const outcome = text(decision.outcome) ?? "UNKNOWN";
    const transactionHash = (text(decision.transactionHash) ?? null) as Hex | null;
    return [{
      scenario, log, entryId: entry.id, entryHash: entry.hash, kind: entry.kind, outcome,
      tier: text(decision.tier) ?? null,
      layer: text(decision.layer) ?? text(decidedBy?.layer) ?? "agent pipeline",
      rule: text(decision.rule) ?? text(decidedBy?.rule) ?? text(decision.reason) ?? outcome,
      reason: text(decision.reason) ?? "",
      transactionHash, blockNumber: text(decision.blockNumber) ?? null,
      offChain: transactionHash === null && (outcome === "BLOCKED" || outcome === "NEEDS_APPROVAL"),
    }];
  });
}

export type InspectedTx = {
  hash: Hex; blockNumber: number; blockHash: Hex; chainId: number; label: string; fromRole: string;
  /** The contract the call went to, or the contract the transaction created. */
  contractAddress: string | null; contractRole: string; functionName: string; call: string;
  status: EvidenceTx["status"]; events: EvidenceEvent[]; result: string;
  /** The agent's own decision when the pipeline sent this transaction; otherwise what the contract did. */
  decision: { source: "agent pipeline" | "contract"; outcome: string; tier: string | null; rule: string };
  /** Why this is a refusal: the revert reason or the PolicyViolation reason. */
  refusal?: string;
};
/** Off-chain block: never carries a transaction hash or block. */
export type InspectedBlock = Omit<EvidenceDecision, "transactionHash" | "blockNumber" | "offChain"> & { audit: AuditEntry; chainValid: boolean };
export type InspectedScenario = { id: string; title: string; expectation: string; passed: boolean; detail: string; executed: InspectedTx[]; refusals: InspectedTx[]; offChain: InspectedBlock[] };
export type EvidenceInspection = {
  generatedAt: string; network: EvidenceRun["network"]; roles: EvidenceRun["roles"];
  totals: { executed: number; refusals: number; offChain: number };
  auditLogs: Record<string, { entries: number; valid: boolean }>;
  verification: Verification;
  scenarios: InspectedScenario[];
};

/**
 * Splits the evidence into (1) executed transactions, (2) on-chain refusals: a reverted transaction
 * or one whose receipt carries a PolicyViolation event, and (3) off-chain blocks from the audit log.
 */
export function inspectEvidence(run: Omit<EvidenceRun, "rawReceipts" | "rawTransactions">, verification: Verification = {}): EvidenceInspection {
  const decisions = run.decisions ?? [];
  const logs = run.auditLogs ?? {};
  const chains = Object.fromEntries(Object.entries(logs).map(([key, entries]) => [key, { entries: entries.length, valid: verifyAuditChain(entries).valid }]));
  const byHash = new Map(decisions.filter((item) => item.transactionHash).map((item) => [item.transactionHash!.toLowerCase(), item]));
  const scenarios = run.scenarios.map((scenario): InspectedScenario => {
    const txs = run.transactions.filter((tx) => tx.scenario === scenario.id).map((tx) => inspectTx(tx, run.network.chainId, byHash.get(tx.hash.toLowerCase())));
    const offChain = decisions.filter((item) => item.scenario === scenario.id && item.offChain).flatMap((item): InspectedBlock[] => {
      const audit = logs[item.log]?.find((entry) => entry.id === item.entryId);
      if (!audit) return [];
      const { transactionHash: _hash, blockNumber: _block, offChain: _off, ...rest } = item;
      void _hash; void _block; void _off;
      return [{ ...rest, audit, chainValid: chains[item.log]?.valid ?? false }];
    });
    return {
      id: scenario.id, title: scenario.title, expectation: scenario.expectation, passed: scenario.passed, detail: scenario.detail,
      executed: txs.filter((tx) => !tx.refusal), refusals: txs.filter((tx) => tx.refusal), offChain,
    };
  });
  return {
    generatedAt: run.generatedAt, network: run.network, roles: run.roles,
    totals: {
      executed: scenarios.reduce((sum, item) => sum + item.executed.length, 0),
      refusals: scenarios.reduce((sum, item) => sum + item.refusals.length, 0),
      offChain: scenarios.reduce((sum, item) => sum + item.offChain.length, 0),
    },
    auditLogs: chains, verification, scenarios,
  };
}

function inspectTx(tx: EvidenceTx, chainId: number, decision: EvidenceDecision | undefined): InspectedTx {
  const violation = tx.events.find((event) => event.name === "PolicyViolation");
  const refusal = tx.status === "reverted" ? tx.result.replace(/^REVERTED\s*/, "") : violation ? String(violation.args.reason) : undefined;
  const created = tx.toRole.startsWith("create ");
  const contractOutcome = tx.status === "reverted" ? "REVERTED" : violation ? "BLOCKED" : "EXECUTED";
  return {
    hash: tx.hash, blockNumber: tx.blockNumber, blockHash: tx.blockHash, chainId, label: tx.label, fromRole: tx.fromRole,
    contractAddress: created ? tx.contractAddress : tx.to, contractRole: created ? tx.toRole.slice("create ".length) : tx.toRole,
    functionName: tx.call === "constructor" ? "constructor" : tx.call.split("(")[0]!, call: tx.call,
    status: tx.status, events: tx.events, result: tx.result,
    decision: decision
      ? { source: "agent pipeline", outcome: decision.outcome, tier: decision.tier, rule: decision.rule }
      : { source: "contract", outcome: contractOutcome, tier: null, rule: refusal ?? tx.result },
    ...(refusal ? { refusal } : {}),
  };
}

export type EvidenceSummary = Omit<EvidenceRun, "rawReceipts" | "rawTransactions">;

/** Reads evidence/evidence.json only; undefined when nothing has been exported yet. */
export function loadEvidenceSummary(directory: string): EvidenceSummary | undefined {
  const path = resolve(directory, "evidence.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as EvidenceSummary : undefined;
}

/** One exported transaction with its raw receipt and transaction, enough for a mode (a) check. */
export function loadEvidenceTx(directory: string, summary: EvidenceSummary, hash: string): { run: EvidenceRun; tx: EvidenceTx } | undefined {
  const tx = summary.transactions.find((item) => item.hash.toLowerCase() === hash.toLowerCase());
  if (!tx) return undefined;
  const file = JSON.parse(readFileSync(resolve(directory, "receipts", `${tx.hash}.json`), "utf8")) as { transaction: unknown; receipt: unknown };
  return { run: { ...summary, rawReceipts: { [tx.hash]: file.receipt }, rawTransactions: { [tx.hash]: file.transaction } }, tx };
}

/** Reads evidence/evidence.json and the raw receipts and transactions in evidence/receipts/. */
export function loadEvidence(directory: string): EvidenceRun {
  const summary = JSON.parse(readFileSync(resolve(directory, "evidence.json"), "utf8")) as Omit<EvidenceRun, "rawReceipts" | "rawTransactions">;
  const rawReceipts: EvidenceRun["rawReceipts"] = {};
  const rawTransactions: EvidenceRun["rawTransactions"] = {};
  const files = new Set(readdirSync(resolve(directory, "receipts")));
  for (const tx of summary.transactions) {
    if (!files.has(`${tx.hash}.json`)) throw new Error(`missing receipt file for ${tx.hash}`);
    const file = JSON.parse(readFileSync(resolve(directory, "receipts", `${tx.hash}.json`), "utf8")) as { transaction: unknown; receipt: unknown };
    rawReceipts[tx.hash] = file.receipt;
    rawTransactions[tx.hash] = file.transaction;
  }
  return { ...summary, rawReceipts, rawTransactions };
}

export function loadVerification(directory: string): Verification {
  const path = resolve(directory, "verification.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Verification : {};
}
