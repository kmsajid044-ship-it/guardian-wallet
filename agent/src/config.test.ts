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
    const config = loadConfig({ CHAIN_ID: "31337", DEPLOYMENTS_FILE: deploymentFile(31337) });
    expect(loadDeployment(config).guardianWallet).toMatch(/^0x/);
  });

  it("rejects a manifest for another chain", () => {
    const config = loadConfig({ CHAIN_ID: "31337", DEPLOYMENTS_FILE: deploymentFile(1337) });
    expect(() => loadDeployment(config)).toThrow(/does not match/);
  });
});
