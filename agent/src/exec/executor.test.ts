import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import type { Config, Deployment } from "../config.js";
import { AgentExecutor } from "./executor.js";

const config: Config = {
  AGENT_PORT: 8787,
  RPC_URL: "http://127.0.0.1:1",
  CHAIN_ID: 31337,
  DEPLOYMENTS_FILE: "./deployments/local.json",
  AUDIT_DB_PATH: "./agent/data/audit.sqlite",
  LLM_PROVIDER: "mock",
  OWNER_TIMEZONE: "Asia/Shanghai",
  OWNER_ACTIVE_HOURS: "08-22",
};

describe("AgentExecutor", () => {
  it("rejects a signing key that does not match the deployed agent", () => {
    const deployment = fixtureDeployment(privateKeyToAccount(generatePrivateKey()).address);
    expect(() => AgentExecutor.create(config, deployment, { AGENT_PRIVATE_KEY: generatePrivateKey() })).toThrow(
      /does not match/,
    );
  });

  it("refuses simulation-mismatched authorization before RPC submission", async () => {
    const key = generatePrivateKey();
    const deployment = fixtureDeployment(privateKeyToAccount(key).address);
    const executor = AgentExecutor.create(config, deployment, { AGENT_PRIVATE_KEY: key });
    const action = {
      kind: "pay" as const,
      currency: 0 as const,
      to: deployment.feeAccount as `0x${string}`,
      amount: 1n,
      intentId: keccak256(toBytes("blocked")),
    };
    await expect(
      executor.submit(action, {
        policy: { route: "EXECUTE" },
        simulation: { outcome: "PENDING", auxiliary: 0n },
      }),
    ).rejects.toThrow(/does not permit/);
  });
});

function fixtureDeployment(agent: `0x${string}`): Deployment {
  return {
    network: "test",
    chainId: 31337,
    deployedAt: 1,
    guardianWallet: "0x0000000000000000000000000000000000000001",
    demoLedger: "0x0000000000000000000000000000000000000002",
    owner: "0x0000000000000000000000000000000000000004",
    agent,
    guardian: "0x0000000000000000000000000000000000000000",
    feeAccount: "0x0000000000000000000000000000000000000005",
  };
}
