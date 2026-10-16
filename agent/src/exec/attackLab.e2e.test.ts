import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AttackLab } from "../attack/attackLab.js";
import { attackIds, directProofIds, type AttackResult } from "../attack/types.js";
import { AuditLog } from "../audit/audit.js";
import type { Config } from "../config.js";
import { startAnvilFixture, type AnvilFixture } from "../test/anvil.js";

const hash = /^0x[0-9a-f]{64}$/;
const expectedLayer: Record<string, string> = {
  A1: "firewall", A2: "on-chain contract", A3: "on-chain contract", A4: "firewall", A5: "on-chain contract", A6: "on-chain contract",
  A7: "on-chain contract", A8: "tier gate", A9: "on-chain contract", A10: "firewall", A11: "firewall",
};

describe("AttackLab on a local chain", () => {
  let fixture: AnvilFixture;
  let audit: AuditLog;
  let results: AttackResult[];

  beforeAll(async () => {
    fixture = await startAnvilFixture();
    audit = new AuditLog(":memory:");
    const config: Config = { CHAIN_BACKEND: "evm-local", AGENT_PORT: 8787, RPC_URL: fixture.rpcUrl, CHAIN_ID: 31337, DEPLOYMENTS_FILE: "unused", AUDIT_DB_PATH: ":memory:", LLM_PROVIDER: "mock", OWNER_TIMEZONE: "UTC", OWNER_ACTIVE_HOURS: "00-24" };
    results = await new AttackLab(config, { AGENT_PRIVATE_KEY: fixture.agentKey, OWNER_PRIVATE_KEY: fixture.ownerKey }, { audit }).runAll();
  }, 180_000);

  afterAll(async () => { if (fixture) await fixture.stop(); });

  it("blocks all eleven scenarios", () => {
    expect(results.map((result) => result.id)).toEqual(attackIds);
    for (const result of results) expect({ id: result.id, status: result.status, reason: result.reason }).toMatchObject({ id: result.id, status: "BLOCKED" });
  });

  it.each(attackIds)("records the stopping layer and a verified state check for %s", (id) => {
    const result = results.find((item) => item.id === id)!;
    expect(result.blockedBy).toBe(expectedLayer[id]);
    expect(result.reason.length).toBeGreaterThan(10);
    expect(result.steps.some((step) => step.outcome === "FAILED")).toBe(false);
    expect(result.steps.some((step) => step.layer === result.blockedBy && (step.outcome === "BLOCKED" || step.outcome === "REVERTED"))).toBe(true);
  });

  it.each(directProofIds)("proves %s is refused when sent straight to the contract", (id) => {
    const result = results.find((item) => item.id === id)!;
    expect(result.onChain).toBe(true);
    expect(result.directProof?.transactionHash).toMatch(hash);
    expect(result.transactionHash).toMatch(hash);
  });

  it("decodes contract revert reasons for refused calls", () => {
    const revert = (id: string) => results.find((item) => item.id === id)?.revertRecord;
    expect(revert("A6")).toMatch(/^PendingNotActive/);
    expect(revert("A7")).toMatch(/^PendingHasExpired/);
    expect(revert("A8")).toMatch(/^OwnableUnauthorizedAccount/);
    expect(revert("A9")).toBe("NotController");
    expect(revert("A10")).toMatch(/^OwnableUnauthorizedAccount/);
    expect(results.find((item) => item.id === "A6")?.directProof?.status).toBe("reverted");
  });

  it("records PolicyViolation events for limit, cooldown, and replay refusals", () => {
    const steps = (id: string) => results.find((item) => item.id === id)!.steps.map((step) => step.detail).join("\n");
    expect(steps("A2")).toContain("PolicyViolation(OVER_PER_TX_LIMIT)");
    expect(steps("A3")).toContain("PolicyViolation(OVER_DAILY_LIMIT)");
    expect(steps("A5")).toContain("PolicyViolation(RECIPIENT_NOT_ACTIVE)");
    expect(steps("A6")).toContain("PolicyViolation(DUPLICATE_INTENT)");
    expect(steps("A9")).toContain("PolicyViolation(RECIPIENT_NOT_ALLOWED)");
  });

  it("appends every result to the hash-chained audit log", () => {
    const entries = audit.list().filter((entry) => entry.kind === "attack_lab_result");
    expect(entries).toHaveLength(11);
    expect(audit.verify()).toEqual({ valid: true, count: 11 });
  });
});
