import { describe, expect, it } from "vitest";
import type { EvidenceRun, EvidenceTx } from "./runner.js";
import { compareRuns, normalizeTx, verifyRunning } from "./verify.js";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const tx = (n: number, overrides: Partial<EvidenceTx> = {}): EvidenceTx => ({
  scenario: "E02", label: "pay", hash: hash(n), blockNumber: 10 + n, blockHash: hash(1000 + n), transactionIndex: 0, timestamp: "2026-10-16T00:00:00.000Z",
  from: "0x0000000000000000000000000000000000000001", fromRole: "agent", to: "0x0000000000000000000000000000000000000002", toRole: "GuardianWallet #1", contractAddress: null,
  call: `pay(contact ana, 0, 50000000, ${hash(5000 + n)})`, status: "success", gasUsed: "60000", inputBytes: { zero: 40, nonzero: 60 },
  events: [{ contract: "GuardianWallet #1", address: "0x0000000000000000000000000000000000000002", name: "RecipientSet", args: { recipient: "contact ana", allowed: true, activeAfter: String(1_792_000_000 + n), label: "ana" } }],
  result: "PaymentCompleted", ...overrides,
});
const run = (transactions: EvidenceTx[], passed = true): EvidenceRun => ({
  generatedAt: "2026-10-16T00:00:00.000Z",
  network: { backend: "fisco", chainId: 1337, rpcUrl: "http://127.0.0.1:8545", clientVersion: "test", firstBlock: 10, lastBlock: 20 },
  roles: { owner: "0x0000000000000000000000000000000000000003", agent: "0x0000000000000000000000000000000000000001", contacts: {} },
  scenarios: [{ id: "E02", title: "T1", expectation: "", passed, detail: "", transactions: transactions.map((item) => item.hash) }],
  transactions,
  rawReceipts: Object.fromEntries(transactions.map((item) => [item.hash, { transactionHash: item.hash, status: "0x1", blockHash: item.blockHash }])),
  rawTransactions: Object.fromEntries(transactions.map((item) => [item.hash, { hash: item.hash, nonce: "0x1", input: "0x" }])),
});

describe("normalizeTx", () => {
  it("drops intent IDs and timestamps but keeps effects", () => {
    expect(normalizeTx(tx(1))).toEqual(normalizeTx(tx(2)));
    expect(normalizeTx(tx(1)).call).toBe("pay(contact ana, 0, 50000000, <bytes32>)");
    expect(normalizeTx(tx(1)).events[0]!.args.activeAfter).toBe("<time>");
  });
});

describe("compareRuns (mode b)", () => {
  it("passes for a replay with different hashes and the same effects", () => {
    const result = compareRuns(run([tx(1), tx(2)]), run([tx(11), tx(12)]), "http://127.0.0.1:8555");
    expect(result).toMatchObject({ passed: true, scenariosMatched: 1, transactionsMatched: 2, identicalHashes: 0 });
  });
  it("compares execution gas net of calldata pricing on EVM chains only", () => {
    const evm = (transactions: EvidenceTx[]) => { const value = run(transactions); value.network.backend = "evm-local"; return value; };
    // One more non-zero byte costs 12 more gas on an EVM chain; the execution itself is the same.
    expect(compareRuns(evm([tx(1)]), evm([tx(11, { gasUsed: "60012", inputBytes: { zero: 39, nonzero: 61 } })]), "x").passed).toBe(true);
    expect(compareRuns(evm([tx(1)]), evm([tx(11, { gasUsed: "60500" })]), "x").passed).toBe(false);
    expect(compareRuns(run([tx(1)]), run([tx(11, { gasUsed: "60012", inputBytes: { zero: 39, nonzero: 61 } })]), "x").passed).toBe(false);
  });

  it("fails on a different result, amount, or transaction count", () => {
    expect(compareRuns(run([tx(1)]), run([tx(11, { result: "BLOCKED OVER_DAILY_LIMIT" })]), "x").passed).toBe(false);
    expect(compareRuns(run([tx(1)]), run([tx(11, { call: `pay(contact ana, 0, 60000000, ${hash(9)})` })]), "x").passed).toBe(false);
    expect(compareRuns(run([tx(1), tx(2)]), run([tx(11)]), "x").differences[0]).toContain("2 transactions originally, 1 on replay");
    expect(compareRuns(run([tx(1)]), run([tx(11)], false), "x").passed).toBe(false);
  });
});

describe("verifyRunning (mode a)", () => {
  const original = run([tx(1), tx(2)]);
  const honest = async (method: string, params: unknown[]) => {
    if (method === "eth_getTransactionReceipt") return original.rawReceipts[params[0] as `0x${string}`];
    if (method === "eth_getTransactionByHash") return original.rawTransactions[params[0] as `0x${string}`];
    const block = original.transactions.find((item) => `0x${item.blockNumber.toString(16)}` === params[0]);
    return { hash: block?.blockHash };
  };
  it("passes when every receipt, transaction, and block hash matches", async () => {
    const result = await verifyRunning(original, [{ rpcUrl: "a", request: honest }, { rpcUrl: "b", request: honest }]);
    expect(result).toMatchObject({ passed: true, transactions: 2 });
    expect(result.endpoints.map((endpoint) => endpoint.matched)).toEqual([2, 2]);
  });
  it("detects a modified receipt, a missing transaction, and a replaced block", async () => {
    const tampered = async (method: string, params: unknown[]) => {
      if (method === "eth_getTransactionReceipt" && params[0] === hash(1)) return { ...original.rawReceipts[hash(1)] as object, status: "0x0" };
      if (method === "eth_getTransactionByHash" && params[0] === hash(2)) return null;
      if (method === "eth_getBlockByNumber") return { hash: hash(7) };
      return honest(method, params);
    };
    const result = await verifyRunning(original, [{ rpcUrl: "a", request: tampered }]);
    expect(result.passed).toBe(false);
    expect(result.endpoints[0]!.mismatches.join("\n")).toMatch(/receipt differs[\s\S]*transaction not found/);
    expect(result.endpoints[0]!.mismatches.join("\n")).toContain("block 11 hash");
  });
});
