import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../config.js";
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

  it("passes mode (b): an independent replay reproduces every effect", () => {
    const result = compareRuns(original, replay, second.rpcUrl);
    expect(result.differences).toEqual([]);
    expect(result).toMatchObject({ passed: true, identicalHashes: 0, transactionsMatched: original.transactions.length });
  });
});
