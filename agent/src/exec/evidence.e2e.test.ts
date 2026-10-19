import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../api/server.js";
import { verifyAuditChain } from "../audit/audit.js";
import type { Config, Deployment } from "../config.js";
import { inspectEvidence } from "../evidence/inspect.js";
import { EvidenceRunner, type EvidenceRun } from "../evidence/runner.js";
import { compareRuns, rpcEndpoint, verifyRunning } from "../evidence/verify.js";
import { startAnvilFixture, type AnvilFixture } from "../test/anvil.js";

const config = (rpcUrl: string): Config => ({ CHAIN_BACKEND: "evm-local", AGENT_PORT: 8787, RPC_URL: rpcUrl, CHAIN_ID: 31337, DEPLOYMENTS_FILE: "unused", AUDIT_DB_PATH: ":memory:", LLM_PROVIDER: "mock", OWNER_TIMEZONE: "UTC", OWNER_ACTIVE_HOURS: "00-24" });

describe("execution evidence on two independent local chains", () => {
  let first: AnvilFixture;
  let second: AnvilFixture;
  let original: EvidenceRun;
  let replay: EvidenceRun;

  beforeAll(async () => {
    first = await startAnvilFixture();
    second = await startAnvilFixture();
    // Same identities on both chains, as on the primary and the fresh FISCO network.
    await second.testClient.setBalance({ address: first.owner, value: 10n ** 20n });
    await second.testClient.setBalance({ address: first.agent, value: 10n ** 20n });
    const keys = { AGENT_PRIVATE_KEY: first.agentKey, OWNER_PRIVATE_KEY: first.ownerKey };
    original = await new EvidenceRunner(config(first.rpcUrl), keys).run();
    replay = await new EvidenceRunner(config(second.rpcUrl), keys).run();
  }, 240_000);

  afterAll(async () => { await first?.stop(); await second?.stop(); });

  it("records at least 20 transactions with receipts and every scenario as expected", () => {
    expect(original.transactions.length).toBeGreaterThanOrEqual(20);
    expect(original.scenarios.filter((scenario) => !scenario.passed)).toEqual([]);
    for (const tx of original.transactions) expect(original.rawReceipts[tx.hash]).toBeTruthy();
    const results = original.transactions.map((tx) => tx.result).join("\n");
    for (const expected of ["PaymentCompleted", "PendingApproved", "SavingsFunded", "ServiceFeePaid", "BLOCKED OVER_PER_TX_LIMIT", "BLOCKED PAUSED", "Paused", "Unpaused", "REVERTED PendingNotActive", "REVERTED PendingHasExpired", "REVERTED NotController", "REVERTED OwnableUnauthorizedAccount"]) expect(results).toContain(expected);
  });

  it("passes mode (a) against the chain that produced it", async () => {
    expect((await verifyRunning(original, [rpcEndpoint(first.rpcUrl)])).passed).toBe(true);
  });

  it("fails mode (a) against a different chain", async () => {
    expect((await verifyRunning(original, [rpcEndpoint(second.rpcUrl)])).passed).toBe(false);
  });

  it("records every off-chain block with its audit entry and no transaction", () => {
    const blocks = (original.decisions ?? []).filter((item) => item.offChain);
    expect(new Set(blocks.map((item) => item.scenario))).toEqual(new Set(["E-A1", "E-A4", "E-A8", "E-A10", "E-A11"]));
    for (const block of blocks) {
      expect(block.transactionHash).toBeNull();
      const entry = original.auditLogs?.[block.log]?.find((item) => item.id === block.entryId);
      expect(entry?.hash).toBe(block.entryHash);
    }
    expect(blocks.find((item) => item.scenario === "E-A8")).toMatchObject({ kind: "tier_gate_decision", layer: "tier gate", tier: "T3", rule: "OWNER_ONLY_OPERATION" });
    expect(blocks.find((item) => item.scenario === "E-A10" && item.kind === "pipeline_result")).toMatchObject({ layer: "firewall", tier: "T3" });
    for (const entries of Object.values(original.auditLogs ?? {})) expect(verifyAuditChain(entries).valid).toBe(true);
    // Every pipeline decision that sent a transaction points at a recorded one.
    const hashes = new Set(original.transactions.map((tx) => tx.hash));
    for (const decision of original.decisions ?? []) if (decision.transactionHash) expect(hashes.has(decision.transactionHash)).toBe(true);
  });

  it("splits the evidence into executed, on-chain refusals, and off-chain blocks without hashes", () => {
    const view = inspectEvidence(original);
    expect(view.totals.executed + view.totals.refusals).toBe(original.transactions.length);
    const all = view.scenarios.flatMap((scenario) => [...scenario.executed, ...scenario.refusals]);
    for (const tx of view.scenarios.flatMap((scenario) => scenario.refusals)) expect(tx.status === "reverted" || tx.events.some((event) => event.name === "PolicyViolation")).toBe(true);
    for (const tx of view.scenarios.flatMap((scenario) => scenario.executed)) expect(tx.status === "success" && !tx.events.some((event) => event.name === "PolicyViolation")).toBe(true);
    expect(all.find((tx) => tx.label.startsWith("Agent pay(ana, 50 USD)"))?.decision).toMatchObject({ source: "agent pipeline", outcome: "EXECUTED", tier: "T1" });
    for (const block of view.scenarios.flatMap((scenario) => scenario.offChain)) {
      expect(JSON.stringify(block)).not.toMatch(/"(transactionHash|blockNumber|hash)":"0x/);
      expect(block.chainValid).toBe(true);
    }
  });

  it("verifies one exported transaction against the node through the API: match, then mismatch", async () => {
    const directory = mkdtempSync(join(tmpdir(), "guardian-evidence-"));
    const app = buildServer(config(first.rpcUrl), {
      deployment: { network: "integration", chainId: 31337, deployedAt: 1, guardianWallet: first.wallet, demoLedger: first.ledger, owner: first.owner, agent: first.agent, guardian: "0x0000000000000000000000000000000000000000", feeAccount: first.service } satisfies Deployment,
      environment: { AGENT_PRIVATE_KEY: first.agentKey, OWNER_PRIVATE_KEY: first.ownerKey }, contacts: {}, evidenceDir: directory, evalResultsPath: join(directory, "none.json"),
    });
    try {
      const { rawReceipts, rawTransactions, ...summary } = original;
      mkdirSync(join(directory, "receipts"));
      writeFileSync(join(directory, "evidence.json"), JSON.stringify(summary));
      for (const tx of original.transactions) writeFileSync(join(directory, "receipts", `${tx.hash}.json`), JSON.stringify({ transaction: rawTransactions[tx.hash], receipt: rawReceipts[tx.hash] }));
      const view = (await app.inject({ method: "GET", url: "/evidence" })).json<{ totals: { offChain: number } }>();
      expect(view.totals.offChain).toBeGreaterThanOrEqual(5);
      const target = original.transactions.find((tx) => tx.result.startsWith("BLOCKED"))!;
      const match = (await app.inject({ method: "GET", url: `/evidence/verify/${target.hash}` })).json();
      expect(match).toMatchObject({ match: true, problems: [], chainId: 31337, receipt: { blockNumber: target.blockNumber, blockHash: target.blockHash, status: "success" } });
      writeFileSync(join(directory, "receipts", `${target.hash}.json`), JSON.stringify({ transaction: rawTransactions[target.hash], receipt: { ...(rawReceipts[target.hash] as object), gasUsed: "0x1" } }));
      const mismatch = (await app.inject({ method: "GET", url: `/evidence/verify/${target.hash}` })).json();
      expect(mismatch).toMatchObject({ match: false, problems: ["receipt differs from export"] });
      expect((await app.inject({ method: "GET", url: `/evidence/verify/0x${"ab".repeat(32)}` })).statusCode).toBe(404);
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes mode (b): an independent replay reproduces every effect", () => {
    const result = compareRuns(original, replay, second.rpcUrl);
    expect(result.differences).toEqual([]);
    expect(result).toMatchObject({ passed: true, identicalHashes: 0, transactionsMatched: original.transactions.length });
  });
});
