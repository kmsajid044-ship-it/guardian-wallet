import { describe, expect, it } from "vitest";
import { createChainAdapter } from "./ChainAdapter.js";
import type { Config, Deployment } from "../config.js";

const address = "0x0000000000000000000000000000000000000001";
const deployment: Deployment = {
  network: "local",
  chainId: 1337,
  deployedAt: 0,
  guardianWallet: address,
  demoLedger: address,
  owner: address,
  agent: address,
  guardian: address,
  feeAccount: address,
};

function config(CHAIN_BACKEND: Config["CHAIN_BACKEND"], CHAIN_ID: number): Config {
  return {
    CHAIN_BACKEND,
    CHAIN_ID,
    RPC_URL: "http://127.0.0.1:8545",
    DEPLOYMENTS_FILE: "unused",
    AGENT_PORT: 8787,
    AUDIT_DB_PATH: ":memory:",
    LLM_PROVIDER: "mock",
    OWNER_TIMEZONE: "UTC",
    OWNER_ACTIVE_HOURS: "00-24",
  };
}

describe("ChainAdapter factory", () => {
  it("selects fisco by default configuration", () => {
    expect(createChainAdapter(config("fisco", 1337), deployment).backend).toBe("fisco");
  });

  it("selects the local development backend", () => {
    expect(createChainAdapter(config("evm-local", 31337), { ...deployment, chainId: 31337 }).backend).toBe("evm-local");
  });
});
