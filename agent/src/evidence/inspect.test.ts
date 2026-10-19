import { describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit.js";
import { decisionsFromAudit, inspectEvidence } from "./inspect.js";
import type { EvidenceRun, EvidenceTx } from "./runner.js";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const wallet = "0x0000000000000000000000000000000000000002";
const tx = (n: number, overrides: Partial<EvidenceTx> = {}): EvidenceTx => ({
  scenario: "S1", label: `tx ${n}`, hash: hash(n), blockNumber: 10 + n, blockHash: hash(1000 + n), transactionIndex: 0, timestamp: "2026-10-16T00:00:00.000Z",
  from: "0x0000000000000000000000000000000000000001", fromRole: "agent", to: wallet, toRole: "GuardianWallet #1", contractAddress: null,
  call: "pay(contact ana, USD, 50000000, 0x01)", status: "success", gasUsed: "60000", inputBytes: { zero: 1, nonzero: 1 }, events: [], result: "PaymentCompleted", ...overrides,
});

function decisionLog() {
  const audit = new AuditLog(":memory:");
  const decision = (outcome: string, transactionHash: string | null, layer: string, rule: string) => ({ outcome, reason: rule, tier: outcome === "EXECUTED" ? "T1" : "T0", riskFactors: [], why: { decidedBy: { layer, rule } }, transactionHash, blockNumber: transactionHash ? "11" : null });
  audit.append({ timestamp: "2026-10-16T00:00:00.000Z", kind: "pipeline_result", data: { route: "EXECUTED", decision: decision("EXECUTED", hash(1), "tier gate", "WITHIN_POLICY_AND_RISK_LIMITS") } });
  audit.append({ timestamp: "2026-10-16T00:00:01.000Z", kind: "pipeline_result", data: { route: "BLOCKED", decision: decision("BLOCKED", null, "firewall", "INSTRUCTION_INJECTION") } });
  audit.append({ timestamp: "2026-10-16T00:00:02.000Z", kind: "tier_gate_decision", data: { request: "resume", operation: "unpause", decision: { outcome: "BLOCKED", tier: "T3", reason: "owner only", layer: "tier gate", rule: "OWNER_ONLY_OPERATION", transactionHash: null, blockNumber: null } } });
  audit.append({ timestamp: "2026-10-16T00:00:03.000Z", kind: "attack_lab_result", data: { status: "BLOCKED" } });
  return audit.list();
}

function run(): EvidenceRun {
  const entries = decisionLog();
  return {
    generatedAt: "2026-10-16T00:00:00.000Z",
    network: { backend: "fisco", chainId: 1337, rpcUrl: "http://127.0.0.1:8545", clientVersion: "test", firstBlock: 10, lastBlock: 20 },
    roles: { owner: "0x0000000000000000000000000000000000000003", agent: "0x0000000000000000000000000000000000000001", contacts: {} },
    scenarios: [{ id: "S1", title: "Synthetic", expectation: "", passed: true, detail: "", transactions: [hash(1), hash(2), hash(3), hash(4)] }],
    transactions: [
      tx(1),
      tx(2, { call: "requestApproval(contact ana, USD, 600000000, 0x02)", result: "BLOCKED OVER_PER_TX_LIMIT", events: [{ contract: "GuardianWallet #1", address: wallet, name: "PolicyViolation", args: { reason: "OVER_PER_TX_LIMIT" } }] }),
      tx(3, { call: "unpause()", status: "reverted", result: "REVERTED OwnableUnauthorizedAccount(agent)" }),
      tx(4, { to: null, toRole: "create DemoLedger #1", contractAddress: "0x0000000000000000000000000000000000000009", call: "constructor", result: "OwnershipTransferred" }),
    ],
    decisions: decisionsFromAudit("S1", "S1", entries),
    auditLogs: { S1: entries },
    rawReceipts: {}, rawTransactions: {},
  };
}

describe("decisionsFromAudit", () => {
  it("reads pipeline results and tier-gate refusals and marks those without a transaction as off-chain", () => {
    expect(decisionsFromAudit("S1", "S1", decisionLog()).map(({ kind, outcome, layer, rule, offChain, transactionHash }) => ({ kind, outcome, layer, rule, offChain, transactionHash }))).toEqual([
      { kind: "pipeline_result", outcome: "EXECUTED", layer: "tier gate", rule: "WITHIN_POLICY_AND_RISK_LIMITS", offChain: false, transactionHash: hash(1) },
      { kind: "pipeline_result", outcome: "BLOCKED", layer: "firewall", rule: "INSTRUCTION_INJECTION", offChain: true, transactionHash: null },
      { kind: "tier_gate_decision", outcome: "BLOCKED", layer: "tier gate", rule: "OWNER_ONLY_OPERATION", offChain: true, transactionHash: null },
    ]);
  });
});

describe("inspectEvidence", () => {
  it("splits executed transactions, on-chain refusals, and off-chain blocks", () => {
    const [scenario] = inspectEvidence(run()).scenarios;
    expect(scenario!.executed.map((item) => item.hash)).toEqual([hash(1), hash(4)]);
    expect(scenario!.refusals.map((item) => [item.hash, item.refusal])).toEqual([[hash(2), "OVER_PER_TX_LIMIT"], [hash(3), "OwnableUnauthorizedAccount(agent)"]]);
    expect(scenario!.offChain.map((item) => [item.layer, item.rule, item.audit.kind])).toEqual([["firewall", "INSTRUCTION_INJECTION", "pipeline_result"], ["tier gate", "OWNER_ONLY_OPERATION", "tier_gate_decision"]]);
  });

  it("never gives an off-chain block a transaction hash or block", () => {
    for (const block of inspectEvidence(run()).scenarios[0]!.offChain) {
      expect(block).not.toHaveProperty("transactionHash");
      expect(block).not.toHaveProperty("blockNumber");
      expect(block.chainValid).toBe(true);
    }
  });

  it("names the contract, function, chain ID, and the decision that sent each transaction", () => {
    const [executed, created] = inspectEvidence(run()).scenarios[0]!.executed;
    expect(executed).toMatchObject({ chainId: 1337, contractAddress: wallet, contractRole: "GuardianWallet #1", functionName: "pay", decision: { source: "agent pipeline", outcome: "EXECUTED", tier: "T1" } });
    expect(created).toMatchObject({ contractAddress: "0x0000000000000000000000000000000000000009", contractRole: "DemoLedger #1", functionName: "constructor", decision: { source: "contract", outcome: "EXECUTED" } });
    expect(inspectEvidence(run()).scenarios[0]!.refusals[1]!.decision).toMatchObject({ source: "contract", outcome: "REVERTED" });
  });

  it("flags a tampered decision audit log", () => {
    const tampered = run();
    tampered.auditLogs!.S1![1] = { ...tampered.auditLogs!.S1![1]!, data: { route: "EXECUTED" } };
    const view = inspectEvidence(tampered);
    expect(view.auditLogs.S1).toEqual({ entries: 4, valid: false });
    expect(view.scenarios[0]!.offChain.every((block) => !block.chainValid)).toBe(true);
  });

  it("reads an older export without decisions", () => {
    const { decisions: _decisions, auditLogs: _logs, ...older } = run();
    void _decisions; void _logs;
    expect(inspectEvidence(older).totals).toEqual({ executed: 2, refusals: 2, offChain: 0 });
  });
});
