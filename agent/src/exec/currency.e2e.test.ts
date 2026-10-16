import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit.js";
import type { Config } from "../config.js";
import { resetCurrencyCache } from "../currency/registry.js";
import { MockAdapter } from "../llm/provider.js";
import { AgentPipeline } from "../pipeline/pipeline.js";
import { startAnvilFixture, type AnvilFixture } from "../test/anvil.js";
import { AttackExecutor, type AttackFixture } from "./attackExecutor.js";

/** A third demo unit added only in configuration flows through deployment, pipeline, and contract. */
describe("third configured currency on a local chain", () => {
  const ana = getAddress("0x00000000000000000000000000000000000000a5");
  const directory = mkdtempSync(join(tmpdir(), "guardian-sgd-"));
  let anvil: AnvilFixture;
  let fixture: AttackFixture;
  let pipeline: AgentPipeline;

  beforeAll(async () => {
    const file = join(directory, "currencies.json");
    writeFileSync(file, JSON.stringify({ currencies: [
      { code: "USD", decimals: 6, name: "US dollar (demo units)" },
      { code: "CNY", decimals: 6, name: "Chinese yuan (demo units)" },
      { code: "SGD", decimals: 6, name: "Singapore dollar (demo units)" },
    ] }));
    process.env.CURRENCIES_FILE = file;
    resetCurrencyCache();
    anvil = await startAnvilFixture();
    const config: Config = { CHAIN_BACKEND: "evm-local", AGENT_PORT: 8787, RPC_URL: anvil.rpcUrl, CHAIN_ID: 31337, DEPLOYMENTS_FILE: "unused", AUDIT_DB_PATH: ":memory:", LLM_PROVIDER: "mock", OWNER_TIMEZONE: "UTC", OWNER_ACTIVE_HOURS: "00-24" };
    const environment = { AGENT_PRIVATE_KEY: anvil.agentKey, OWNER_PRIVATE_KEY: anvil.ownerKey };
    const executor = AttackExecutor.create(config, environment);
    fixture = await executor.fixture({ allowlist: [{ address: ana, label: "ana" }] });
    pipeline = new AgentPipeline(config, fixture.deployment, executor.publicClient, new AuditLog(":memory:"), { ana }, environment, new MockAdapter());
  }, 120_000);

  afterAll(async () => {
    delete process.env.CURRENCIES_FILE;
    resetCurrencyCache();
    await anvil?.stop();
    rmSync(directory, { recursive: true, force: true });
  });

  it("lists, funds, and pays SGD through the full pipeline", async () => {
    const before = (await fixture.readBalances(ana)).SGD?.available ?? 0n;
    const result = await pipeline.run({ message: "Pay ana 40 SGD", source: "trusted", sourceRefs: ["test"] });
    expect(result).toMatchObject({ route: "EXECUTED", tier: "T1", proposal: { currency: "SGD" } });
    expect((await fixture.readBalances(ana)).SGD?.available).toBe(before + 40_000_000n);
    expect((await fixture.readBalances()).SGD?.available).toBe(20_000_000_000n - 40_000_000n);
  }, 60_000);
});
