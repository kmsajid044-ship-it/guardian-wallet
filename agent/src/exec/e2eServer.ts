// Real agent API on a fresh local Anvil chain, for browser end-to-end tests (web/tests/plan-view.spec.ts).
// Prints one JSON line with the API and RPC URLs once ready; stops the chain on SIGTERM or SIGINT.
// Keys are generated per run by the fixture and never printed.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../api/server.js";
import type { Config, Deployment } from "../config.js";
import { startAnvilFixture } from "../test/anvil.js";

const fixture = await startAnvilFixture();
const directory = mkdtempSync(join(tmpdir(), "guardian-e2e-"));
const config: Config = {
  CHAIN_BACKEND: "evm-local", AGENT_PORT: 0, RPC_URL: fixture.rpcUrl, CHAIN_ID: 31337, DEPLOYMENTS_FILE: "unused.json",
  AUDIT_DB_PATH: join(directory, "audit.sqlite"), LLM_PROVIDER: "mock", OWNER_TIMEZONE: "UTC", OWNER_ACTIVE_HOURS: "00-24",
};
const deployment: Deployment = {
  network: "integration", chainId: 31337, deployedAt: 1, guardianWallet: fixture.wallet, demoLedger: fixture.ledger,
  owner: fixture.owner, agent: fixture.agent, guardian: "0x0000000000000000000000000000000000000000", feeAccount: fixture.service,
};
const app = buildServer(config, {
  deployment, environment: { AGENT_PRIVATE_KEY: fixture.agentKey, OWNER_PRIVATE_KEY: fixture.ownerKey },
  contacts: { ana: fixture.activeRecipient }, evalResultsPath: join(directory, "no-eval-yet.json"),
});
app.log.level = "warn";
const apiUrl = await app.listen({ host: "127.0.0.1", port: 0 });
process.stdout.write(`${JSON.stringify({ apiUrl, rpcUrl: fixture.rpcUrl })}\n`);

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await app.close();
  await fixture.stop();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
