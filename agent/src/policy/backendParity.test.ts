import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress, keccak256, toBytes, type Address } from "viem";
import { createChainAdapter, type ChainAdapter } from "../chain/ChainAdapter.js";
import type { Config, Deployment } from "../config.js";
import { startAnvilFixture, type AnvilFixture } from "../test/anvil.js";
import { precheckAction } from "./precheck.js";
import type { AgentAction } from "./types.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const CASE_COUNT = 256;
const blockedRecipient = getAddress("0x2000000000000000000000000000000000000001");

describe("policy pre-check equivalence", () => {
  let fixture: AnvilFixture | undefined;
  let adapter: ChainAdapter;
  let recipient: Address;
  let agent: Address;

  beforeAll(async () => {
    if (process.env.PARITY_BACKEND === "fisco") {
      const deployment = JSON.parse(readFileSync(resolve(root, "deployments/fisco.json"), "utf8")) as Deployment;
      const config: Config = {
        CHAIN_BACKEND: "fisco", AGENT_PORT: 8787, RPC_URL: "http://127.0.0.1:8545", CHAIN_ID: 1337,
        DEPLOYMENTS_FILE: "./deployments/fisco.json", AUDIT_DB_PATH: ":memory:", LLM_PROVIDER: "mock",
        OWNER_TIMEZONE: "UTC", OWNER_ACTIVE_HOURS: "00-24",
      };
      adapter = createChainAdapter(config, deployment);
      recipient = getAddress("0x1000000000000000000000000000000000000001");
      agent = getAddress(deployment.agent);
      await adapter.readPolicy();
      return;
    }
    fixture = await startAnvilFixture();
    const deployment: Deployment = {
      network: "evm-local", chainId: 31337, deployedAt: 0, guardianWallet: fixture.wallet,
      demoLedger: fixture.ledger, owner: fixture.owner, agent: fixture.agent,
      guardian: "0x0000000000000000000000000000000000000000", feeAccount: fixture.service,
    };
    const config: Config = {
      CHAIN_BACKEND: "evm-local", AGENT_PORT: 8787, RPC_URL: fixture.rpcUrl, CHAIN_ID: 31337,
      DEPLOYMENTS_FILE: "unused", AUDIT_DB_PATH: ":memory:", LLM_PROVIDER: "mock",
      OWNER_TIMEZONE: "UTC", OWNER_ACTIVE_HOURS: "00-24",
    };
    adapter = createChainAdapter(config, deployment);
    recipient = fixture.activeRecipient;
    agent = fixture.agent;
  }, 60_000);

  afterAll(async () => { await fixture?.stop(); });

  it(`matches the contract on ${CASE_COUNT} generated cases`, async () => {
    const policy = await adapter.readPolicy();
    for (let index = 0; index < CASE_COUNT; index++) {
      const action = generatedAction(index, policy, recipient);
      const predicted = await precheckAction(adapter.policyReader(), action);
      const actual = await adapter.simulateAgentTx(action, agent);
      const expected = predicted.route === "EXECUTE" ? 0 : predicted.route === "NEEDS_APPROVAL" ? 1 : 2;
      expect(actual.outcome, `case ${index}: ${action.kind}, predicted ${predicted.route}${predicted.route === "BLOCKED" ? `/${predicted.reason}` : ""}`).toBe(expected);
    }
  }, 180_000);
});

function generatedAction(index: number, policy: Awaited<ReturnType<ChainAdapter["readPolicy"]>>, recipient: Address): AgentAction {
  const intentId = keccak256(toBytes(`backend-parity-${index}`));
  const amounts = [0n, 1n, policy.approvalThreshold - 1n, policy.approvalThreshold, policy.perTxLimit, policy.perTxLimit + 1n, policy.dailyLimit + 1n];
  const amount = amounts[(index * 11) % amounts.length]!;
  const to = index % 5 === 0 ? blockedRecipient : recipient;
  switch (index % 4) {
    case 0: return { kind: "pay", currency: index % 2 as 0 | 1, to, amount, intentId };
    case 1: return { kind: "request_approval", currency: index % 2 as 0 | 1, to, amount, intentId };
    case 2: return { kind: "save", currency: index % 2 as 0 | 1, amount, intentId };
    default: return { kind: "service_fee", amount, intentId };
  }
}
