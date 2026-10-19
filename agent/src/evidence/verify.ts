import { createPublicClient, http } from "viem";
import { canonicalJson, type JsonValue } from "../audit/audit.js";
import type { EvidenceEvent, EvidenceRun, EvidenceTx } from "./runner.js";

type Request = (method: string, params: unknown[]) => Promise<unknown>;

/** Raw JSON-RPC access to a loopback endpoint, returning responses unformatted. */
export function rpcEndpoint(rpcUrl: string): { rpcUrl: string; request: Request } {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname)) throw new Error(`refusing non-loopback endpoint ${rpcUrl}`);
  const client = createPublicClient({ transport: http(rpcUrl) });
  return { rpcUrl, request: (method, params) => client.request({ method, params } as never) as Promise<unknown> };
}
export type RunningCheck = { rpcUrl: string; checked: number; matched: number; mismatches: string[] };
export type RunningVerification = { mode: "running"; verifiedAt: string; transactions: number; endpoints: RunningCheck[]; passed: boolean };
export type FreshVerification = {
  mode: "fresh"; verifiedAt: string; original: { transactions: number; firstBlock: number; lastBlock: number };
  replay: { transactions: number; firstBlock: number; lastBlock: number; rpcUrl: string; clientVersion: string };
  scenariosMatched: number; scenarios: number; transactionsMatched: number; identicalHashes: number; differences: string[]; passed: boolean;
};

/**
 * Mode (a): every recorded transaction is fetched again by hash from each endpoint. The raw
 * receipt and transaction must equal the exported files byte for byte (canonical JSON), and the
 * block at the recorded height must still carry the recorded block hash.
 */
export async function verifyRunning(run: EvidenceRun, endpoints: Array<{ rpcUrl: string; request: Request }>): Promise<RunningVerification> {
  const checks: RunningCheck[] = [];
  for (const { rpcUrl, request } of endpoints) {
    const check: RunningCheck = { rpcUrl, checked: 0, matched: 0, mismatches: [] };
    for (const tx of run.transactions) {
      check.checked += 1;
      const { problems } = await verifyTransaction(run, tx, request);
      if (problems.length) check.mismatches.push(`${tx.hash}: ${problems.join("; ")}`);
      else check.matched += 1;
    }
    checks.push(check);
  }
  return { mode: "running", verifiedAt: new Date().toISOString(), transactions: run.transactions.length, endpoints: checks, passed: checks.every((check) => check.checked === run.transactions.length && check.matched === check.checked) };
}

export type ReceiptSummary = { status: string; blockNumber: number; blockHash: string; transactionIndex: number };

/**
 * Mode (a) for one transaction: the node's raw receipt and transaction must equal the export, and
 * the block at the recorded height must carry the recorded block hash.
 */
export async function verifyTransaction(run: EvidenceRun, tx: EvidenceTx, request: Request): Promise<{ problems: string[]; receipt: ReceiptSummary | null }> {
  const problems: string[] = [];
  const receipt = await request("eth_getTransactionReceipt", [tx.hash]) as Record<string, string> | null;
  const transaction = await request("eth_getTransactionByHash", [tx.hash]);
  const block = await request("eth_getBlockByNumber", [`0x${tx.blockNumber.toString(16)}`, false]) as { hash?: string; timestamp?: string } | null;
  if (!receipt) problems.push("receipt not found");
  else if (canonicalJson(receipt as JsonValue) !== canonicalJson(run.rawReceipts[tx.hash] as JsonValue)) problems.push("receipt differs from export");
  if (!transaction) problems.push("transaction not found");
  else if (canonicalJson(stripPending(transaction) as JsonValue) !== canonicalJson(stripPending(run.rawTransactions[tx.hash]) as JsonValue)) problems.push("transaction differs from export");
  if (block?.hash?.toLowerCase() !== tx.blockHash.toLowerCase()) problems.push(`block ${tx.blockNumber} hash ${block?.hash ?? "missing"} ≠ ${tx.blockHash}`);
  const summary = receipt ? {
    status: receipt.status === "0x1" ? "success" : "reverted", blockNumber: Number(BigInt(receipt.blockNumber ?? "0x0")),
    blockHash: receipt.blockHash ?? "", transactionIndex: Number(BigInt(receipt.transactionIndex ?? "0x0")),
  } : null;
  return { problems, receipt: summary };
}

// Some clients add per-request fields to transaction objects; keep the signed content.
function stripPending(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const { blockHash, blockNumber, transactionIndex, hash, from, to, input, nonce, gas, gasPrice, value: amount, v, r, s, chainId, type } = value as Record<string, unknown>;
  return { blockHash, blockNumber, transactionIndex, hash, from, to, input, nonce, gas, gasPrice, value: amount, v, r, s, chainId, type };
}

export type NormalizedTx = { scenario: string; fromRole: string; toRole: string; call: string; status: string; result: string; executionGas: string; events: Array<{ contract: string; name: string; args: Record<string, string | boolean> }> };

const bytes32 = /0x[0-9a-fA-F]{64}/g;
const address = /0x[0-9a-fA-F]{40}/g;
const timeFields = new Set(["activeAfter", "expiresAt", "createdAt"]);

/**
 * Removes what legitimately differs between two executions of the same scenarios on different
 * chains: intent IDs and hashes (random per run), timestamps, and raw addresses that are not one of
 * the run's roles or contracts. Roles and contracts are already labelled by deployment order.
 */
export function normalizeTx(tx: EvidenceTx, backend = "fisco"): NormalizedTx {
  // Calldata bytes differ with random intent IDs; on EVM chains they change gas by 12 per byte.
  const calldataGas = backend === "fisco" ? 0n : BigInt(tx.inputBytes.zero * 4 + tx.inputBytes.nonzero * 16);
  const clean = (value: string) => value.replace(bytes32, "<bytes32>").replace(address, "<address>");
  const event = (item: EvidenceEvent) => ({
    contract: clean(item.contract), name: item.name,
    args: Object.fromEntries(Object.entries(item.args).map(([key, value]) => [key, typeof value === "boolean" ? value : timeFields.has(key) ? "<time>" : clean(value)])),
  });
  return { scenario: tx.scenario, fromRole: clean(tx.fromRole), toRole: clean(tx.toRole), call: clean(tx.call), status: tx.status, result: clean(tx.result), executionGas: (BigInt(tx.gasUsed) - calldataGas).toString(), events: tx.events.map(event) };
}

/** Mode (b): a replay on a fresh chain must reproduce every scenario outcome and transaction effect. */
export function compareRuns(original: EvidenceRun, replay: EvidenceRun, rpcUrl: string): FreshVerification {
  const differences: string[] = [];
  let scenariosMatched = 0;
  let transactionsMatched = 0;
  for (const scenario of original.scenarios) {
    const other = replay.scenarios.find((item) => item.id === scenario.id);
    if (!other) { differences.push(`${scenario.id}: missing from replay`); continue; }
    const left = original.transactions.filter((tx) => tx.scenario === scenario.id).map((tx) => normalizeTx(tx, original.network.backend));
    const right = replay.transactions.filter((tx) => tx.scenario === scenario.id).map((tx) => normalizeTx(tx, replay.network.backend));
    let scenarioOk = other.passed === scenario.passed && left.length === right.length;
    if (other.passed !== scenario.passed) differences.push(`${scenario.id}: expectation ${scenario.passed ? "passed" : "failed"} originally, ${other.passed ? "passed" : "failed"} on replay`);
    if (left.length !== right.length) differences.push(`${scenario.id}: ${left.length} transactions originally, ${right.length} on replay`);
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const a = canonicalJson(left[index] as unknown as JsonValue);
      const b = canonicalJson(right[index] as unknown as JsonValue);
      if (a === b) transactionsMatched += 1;
      else { scenarioOk = false; differences.push(`${scenario.id} tx ${index + 1}: ${diffFields(left[index]!, right[index]!)}`); }
    }
    // Off-chain refusals leave no transaction; the replay must reach the same decisions.
    const decisionsOf = (value: EvidenceRun) => (value.decisions ?? []).filter((item) => item.scenario === scenario.id)
      .map((item) => `${item.kind} ${item.outcome} ${item.tier ?? "-"} ${item.layer} ${item.rule} ${item.transactionHash ? "on-chain" : "off-chain"}`);
    const originalDecisions = decisionsOf(original);
    const replayDecisions = decisionsOf(replay);
    if (original.decisions && originalDecisions.join("\n") !== replayDecisions.join("\n")) {
      scenarioOk = false;
      differences.push(`${scenario.id}: decisions [${originalDecisions.join("; ")}] originally, [${replayDecisions.join("; ")}] on replay`);
    }
    if (scenarioOk) scenariosMatched += 1;
  }
  const originalHashes = new Set(original.transactions.map((tx) => tx.hash));
  return {
    mode: "fresh", verifiedAt: new Date().toISOString(),
    original: { transactions: original.transactions.length, firstBlock: original.network.firstBlock, lastBlock: original.network.lastBlock },
    replay: { transactions: replay.transactions.length, firstBlock: replay.network.firstBlock, lastBlock: replay.network.lastBlock, rpcUrl, clientVersion: replay.network.clientVersion },
    scenariosMatched, scenarios: original.scenarios.length, transactionsMatched, identicalHashes: replay.transactions.filter((tx) => originalHashes.has(tx.hash)).length,
    differences, passed: differences.length === 0 && replay.transactions.length === original.transactions.length && original.scenarios.every((scenario) => scenario.passed),
  };
}

function diffFields(left: NormalizedTx, right: NormalizedTx): string {
  return (Object.keys(left) as Array<keyof NormalizedTx>)
    .filter((key) => canonicalJson(left[key] as unknown as JsonValue) !== canonicalJson(right[key] as unknown as JsonValue))
    .map((key) => `${key} ${JSON.stringify(left[key])} ≠ ${JSON.stringify(right[key])}`).join("; ");
}
