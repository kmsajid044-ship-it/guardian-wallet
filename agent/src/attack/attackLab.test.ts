import { describe, expect, it } from "vitest";
import type { Config } from "../config.js";
import { AttackLab } from "./attackLab.js";
import { attackIds, directProofIds } from "./types.js";

describe("AttackLab catalog", () => {
  it("lists eleven ready scenarios and marks the ones that need direct contract proof", () => {
    const config = { CHAIN_BACKEND: "evm-local", AGENT_PORT: 8787, RPC_URL: "http://127.0.0.1:8545", CHAIN_ID: 31337, DEPLOYMENTS_FILE: "unused", AUDIT_DB_PATH: ":memory:", LLM_PROVIDER: "mock", OWNER_TIMEZONE: "UTC", OWNER_ACTIVE_HOURS: "00-24" } satisfies Config;
    const items = new AttackLab(config, {}).list();
    expect(items.map((item) => item.id)).toEqual(attackIds);
    expect(items.every((item) => item.status === "READY")).toBe(true);
    expect(items.filter((item) => "directProofRequired" in item && item.directProofRequired).map((item) => item.id)).toEqual(directProofIds);
  });
});
