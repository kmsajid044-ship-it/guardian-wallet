// On-chain execution evidence. Called by scripts/evidence.sh and scripts/verify-evidence.sh.
//   run [--out <dir>]              execute the scenarios and export evidence.json + receipts/
//   doc                            write docs/EXECUTION_EVIDENCE.md from evidence/
//   verify-running --rpc <urls>    mode (a): re-fetch every receipt by hash from each endpoint
//   compare <replay dir> --rpc <url>  mode (b): compare a fresh-chain replay with the original
// Research prototype: USD and CNY demo balances on a permissioned local chain, no real money.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../agent/src/config.js";
import { evidenceMarkdown, type SnapshotInfo, type Verification } from "../agent/src/evidence/doc.js";
import { EvidenceRunner, type EvidenceRun } from "../agent/src/evidence/runner.js";
import { compareRuns, rpcEndpoint, verifyRunning } from "../agent/src/evidence/verify.js";
import { loadEvidence } from "../agent/src/evidence/inspect.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const evidenceDir = resolve(repoRoot, "evidence");
const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };

if (command === "run") {
  const out = resolve(option("--out") ?? evidenceDir);
  const config = loadConfig();
  const run = await new EvidenceRunner(config, process.env, (line) => process.stderr.write(`${line}\n`)).run();
  save(run, out);
  const failed = run.scenarios.filter((scenario) => !scenario.passed);
  console.log(`${run.transactions.length} transactions in ${run.scenarios.length} scenarios, blocks ${run.network.firstBlock}-${run.network.lastBlock}, written to ${out}`);
  if (failed.length) { console.error(`Scenarios not as expected: ${failed.map((scenario) => scenario.id).join(", ")}`); process.exit(1); }
} else if (command === "doc") {
  const run = load(evidenceDir);
  const snapshotPath = resolve(evidenceDir, "node-snapshot/snapshot.json");
  const snapshot = existsSync(snapshotPath) ? JSON.parse(readFileSync(snapshotPath, "utf8")) as SnapshotInfo : undefined;
  writeFileSync(resolve(repoRoot, "docs/EXECUTION_EVIDENCE.md"), evidenceMarkdown(run, snapshot, verification()));
  console.log("Wrote docs/EXECUTION_EVIDENCE.md");
} else if (command === "verify-running") {
  const run = load(evidenceDir);
  const urls = (option("--rpc") ?? loadConfig().RPC_URL).split(",");
  const result = await verifyRunning(run, urls.map(rpcEndpoint));
  writeVerification({ ...verification(), running: result });
  for (const endpoint of result.endpoints) {
    console.log(`${endpoint.rpcUrl}: ${endpoint.matched}/${endpoint.checked} receipts, transactions, and block hashes match`);
    for (const mismatch of endpoint.mismatches.slice(0, 10)) console.log(`  MISMATCH ${mismatch}`);
  }
  console.log(`Mode (a) ${result.passed ? "PASSED" : "FAILED"}: ${result.transactions} original transaction hashes checked on ${result.endpoints.length} node(s)`);
  if (!result.passed) process.exit(1);
} else if (command === "compare") {
  const replayDir = rest[0];
  if (!replayDir) throw new Error("usage: compare <replay dir> --rpc <url>");
  const rpcUrl = option("--rpc") ?? "unknown";
  const result = compareRuns(load(evidenceDir), load(resolve(replayDir)), rpcUrl);
  writeVerification({ ...verification(), fresh: result });
  console.log(`Replay: ${result.replay.transactions} transactions in blocks ${result.replay.firstBlock}-${result.replay.lastBlock} on ${rpcUrl}`);
  console.log(`Scenarios matched ${result.scenariosMatched}/${result.scenarios}; transactions matched ${result.transactionsMatched}/${result.original.transactions}; identical hashes ${result.identicalHashes}`);
  for (const difference of result.differences.slice(0, 20)) console.log(`  DIFFERENCE ${difference}`);
  console.log(`Mode (b) ${result.passed ? "PASSED" : "FAILED"}: fresh deployment and replay reproduce the original outcomes`);
  if (!result.passed) process.exit(1);
} else {
  console.error("usage: evidence.ts run|doc|verify-running|compare");
  process.exit(2);
}

function save(run: EvidenceRun, out: string) {
  const receipts = resolve(out, "receipts");
  rmSync(receipts, { recursive: true, force: true });
  mkdirSync(receipts, { recursive: true });
  for (const tx of run.transactions) {
    writeFileSync(resolve(receipts, `${tx.hash}.json`), `${JSON.stringify({ transaction: run.rawTransactions[tx.hash], receipt: run.rawReceipts[tx.hash] }, null, 2)}\n`);
  }
  const { rawReceipts: _receipts, rawTransactions: _transactions, ...summary } = run;
  void _receipts; void _transactions;
  writeFileSync(resolve(out, "evidence.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

function load(directory: string): EvidenceRun { return loadEvidence(directory); }

function verification(): Verification {
  const path = resolve(evidenceDir, "verification.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Verification : {};
}
function writeVerification(value: Verification) { writeFileSync(resolve(evidenceDir, "verification.json"), `${JSON.stringify(value, null, 2)}\n`); }

