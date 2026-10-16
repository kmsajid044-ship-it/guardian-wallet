import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, loadDeployment } from "./config.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function deploymentFile(chainId: number): string {
  const directory = mkdtempSync(join(tmpdir(), "guardian-deployment-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "deployment.json");
  const address = "0x0000000000000000000000000000000000000001";
  writeFileSync(
    path,
    JSON.stringify({
      network: "test",
      chainId,
      deployedAt: 1,
      guardianWallet: address,
      demoLedger: address,
      owner: address,
      agent: address,
      guardian: address,
      feeAccount: address,
    }),
  );
  return path;
}

describe("deployment config", () => {
  it("loads a shared manifest for the configured chain", () => {
    const config = loadConfig({ CHAIN_BACKEND: "evm-local", CHAIN_ID: "31337", DEPLOYMENTS_FILE: deploymentFile(31337) });
    expect(loadDeployment(config).guardianWallet).toMatch(/^0x/);
  });

  it("rejects a manifest for another chain", () => {
    const config = loadConfig({ CHAIN_BACKEND: "evm-local", CHAIN_ID: "31337", DEPLOYMENTS_FILE: deploymentFile(1337) });
    expect(() => loadDeployment(config)).toThrow(/does not match/);
  });

  it("defaults to the local FISCO backend", () => {
    const config = loadConfig({});
    expect(config.CHAIN_BACKEND).toBe("fisco");
    expect(config.CHAIN_ID).toBe(1337);
  });

  it.each([
    ["fisco", "https://node.example", "1337"],
    ["fisco", "http://127.0.0.1:8545", "31337"],
    ["evm-local", "http://127.0.0.1:8545", "1337"],
    ["evm-local", "http://192.168.1.20:8545", "31337"],
  ])("rejects non-local or mismatched chain configuration", (backend, rpcUrl, chainId) => {
    expect(() => loadConfig({ CHAIN_BACKEND: backend, RPC_URL: rpcUrl, CHAIN_ID: chainId })).toThrow();
  });

  it.each([
    ["fisco", "http://127.0.0.1:8545", "1337"],
    ["evm-local", "http://localhost:8545", "31337"],
  ])("accepts the local backend mapping", (backend, rpcUrl, chainId) => {
    expect(loadConfig({ CHAIN_BACKEND: backend, RPC_URL: rpcUrl, CHAIN_ID: chainId }).CHAIN_ID).toBe(Number(chainId));
  });
});
