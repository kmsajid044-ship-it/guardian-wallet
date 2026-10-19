// Real agent API for browser end-to-end tests (web/tests/*-live.spec.ts, web/tests/console-pages.spec.ts).
//   default            a fresh local Anvil chain with its own deployment
//   E2E_BACKEND=fisco  the configured local FISCO BCOS network and deployment from .env, with a
//                      throwaway audit log
// Prints one JSON line with the API and RPC URLs once ready; stops on SIGTERM or SIGINT. Keys come
// from the fixture or .env and are never printed. E2E_OWNER_SESSION_TOKEN sets the per-run owner
// session token so the test page can make owner decisions.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../api/server.js";
import { loadConfig, type Config, type Deployment } from "../config.js";
import { startAnvilFixture, type AnvilFixture } from "../test/anvil.js";

const directory = mkdtempSync(join(tmpdir(), "guardian-e2e-"));
const ownerSessionToken = process.env.E2E_OWNER_SESSION_TOKEN || undefined;
let fixture: AnvilFixture | undefined;
let app: ReturnType<typeof buildServer>;
let rpcUrl: string;

if (process.env.E2E_BACKEND === "fisco") {
  const config: Config = { ...loadConfig(), AGENT_PORT: 0, AUDIT_DB_PATH: join(directory, "audit.sqlite") };
  if (config.CHAIN_BACKEND !== "fisco") throw new Error("E2E_BACKEND=fisco needs CHAIN_BACKEND=fisco in .env");
  if (config.RISK_INTEL_URL && !(await reachable(`${config.RISK_INTEL_URL}/health`))) {
    process.stderr.write(`Risk Intel at ${config.RISK_INTEL_URL} is not running; payee checks are off for this run.\n`);
    delete config.RISK_INTEL_URL;
  }
  app = buildServer(config, { ...(ownerSessionToken ? { ownerSessionToken } : {}) });
  rpcUrl = config.RPC_URL;
} else {
  fixture = await startAnvilFixture();
  const config: Config = {
    CHAIN_BACKEND: "evm-local", AGENT_PORT: 0, RPC_URL: fixture.rpcUrl, CHAIN_ID: 31337, DEPLOYMENTS_FILE: "unused.json",
    AUDIT_DB_PATH: join(directory, "audit.sqlite"), LLM_PROVIDER: "mock", OWNER_TIMEZONE: "UTC", OWNER_ACTIVE_HOURS: "00-24",
  };
  const deployment: Deployment = {
    network: "integration", chainId: 31337, deployedAt: 1, guardianWallet: fixture.wallet, demoLedger: fixture.ledger,
    owner: fixture.owner, agent: fixture.agent, guardian: "0x0000000000000000000000000000000000000000", feeAccount: fixture.service,
  };
  app = buildServer(config, {
    deployment, environment: { AGENT_PRIVATE_KEY: fixture.agentKey, OWNER_PRIVATE_KEY: fixture.ownerKey },
    contacts: { ana: fixture.activeRecipient }, evalResultsPath: join(directory, "no-eval-yet.json"),
    ...(ownerSessionToken ? { ownerSessionToken } : {}),
  });
  rpcUrl = fixture.rpcUrl;
}
app.log.level = "warn";
const apiUrl = await app.listen({ host: "127.0.0.1", port: 0 });
process.stdout.write(`${JSON.stringify({ apiUrl, rpcUrl })}\n`);

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await app.close();
  await fixture?.stop();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());

async function reachable(url: string): Promise<boolean> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok; } catch { return false; }
}
