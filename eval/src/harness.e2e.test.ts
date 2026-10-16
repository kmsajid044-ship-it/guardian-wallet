import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../../agent/src/config.js";
import { startAnvilFixture, type AnvilFixture } from "../../agent/src/test/anvil.js";
import { EvalHarness } from "./harness.js";
import { loadScenarios, type ChatScenario } from "./scenarios.js";

const scenarios = loadScenarios();
const byId = (id: string) => scenarios.find((scenario) => scenario.id === id)!;

describe("EvalHarness on a local chain", () => {
  let fixture: AnvilFixture;
  let harness: EvalHarness;

  beforeAll(async () => {
    fixture = await startAnvilFixture();
    const config: Config = { CHAIN_BACKEND: "evm-local", AGENT_PORT: 8787, RPC_URL: fixture.rpcUrl, CHAIN_ID: 31337, DEPLOYMENTS_FILE: "unused", AUDIT_DB_PATH: ":memory:", LLM_PROVIDER: "mock", OWNER_TIMEZONE: "UTC", OWNER_ACTIVE_HOURS: "00-24" };
    harness = new EvalHarness(config, { AGENT_PRIVATE_KEY: fixture.agentKey, OWNER_PRIVATE_KEY: fixture.ownerKey });
  }, 60_000);

  afterAll(async () => { if (fixture) await fixture.stop(); });

  it.each(["N01", "N06", "N07", "N12", "C02", "C06", "X01", "X08", "X09", "A2"])("passes scenario %s", async (id) => {
    const result = await harness.run(byId(id));
    expect({ id, failures: result.failures, unsafe: result.unsafe }).toEqual({ id, failures: [], unsafe: false });
    if (result.suite === "attack") expect(result.blocked).toBe(true);
  }, 60_000);

  it("fails and marks unsafe when more value moves than expected", async () => {
    const base = byId("N01") as ChatScenario;
    const tampered: ChatScenario = { ...base, steps: [{ ...base.steps[0]!, expect: { route: "EXECUTED", transfers: [{ contact: "ana", currency: "USD", amount: "40" }] } }] };
    const result = await harness.run(tampered);
    expect(result.success).toBe(false);
    expect(result.unsafe).toBe(true);
  }, 60_000);

  it("fails without marking unsafe when the route differs", async () => {
    const base = byId("C01") as ChatScenario;
    const tampered: ChatScenario = { ...base, steps: [{ ...base.steps[0]!, expect: { route: "EXECUTED" } }] };
    const result = await harness.run(tampered);
    expect(result.success).toBe(false);
    expect(result.unsafe).toBe(false);
    expect(result.failures[0]).toContain("route ANSWER_ONLY");
  }, 60_000);
});
