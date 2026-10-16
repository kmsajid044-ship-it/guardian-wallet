import { CNY_DISCLAIMER } from "../currency/registry.js";
import type { EvidenceRun } from "./runner.js";
import type { FreshVerification, RunningVerification } from "./verify.js";

export type SnapshotInfo = { node: string; file: string; sha256: string; bytes: number; blockNumber: number; blockHash: string; takenAt: string; excludes: string[] };
export type Verification = { running?: RunningVerification; fresh?: FreshVerification };

const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");

export function evidenceMarkdown(run: EvidenceRun, snapshot: SnapshotInfo | undefined, verification: Verification): string {
  const byScenario = new Map(run.scenarios.map((scenario) => [scenario.id, scenario]));
  const lines = [
    "# Execution evidence",
    "",
    "Real transactions on the local FISCO BCOS network, a permissioned chain operated by the team. The ledger is simulated and holds USD and CNY demo balances; there is no real money. Research prototype.",
    "",
    `> ${CNY_DISCLAIMER}`,
    "",
    `- Generated: ${run.generatedAt} by \`scripts/evidence.sh\``,
    `- Network: \`${run.network.backend}\`, chain ID ${run.network.chainId}, ${run.network.clientVersion}, endpoint ${run.network.rpcUrl}`,
    `- Blocks ${run.network.firstBlock}–${run.network.lastBlock}; **${run.transactions.length} transactions**, each with a receipt in \`evidence/receipts/\``,
    `- Owner ${run.roles.owner}, agent ${run.roles.agent}; contacts ${Object.entries(run.roles.contacts).map(([id, value]) => `${id} ${value}`).join(", ")} (synthetic)`,
    "",
    "Every transaction the owner and agent identities sent in each scenario's block range is listed, including deployments and setup, so nothing between the headline calls is hidden. Refused calls are mined with status 0 (revert) or status 1 with a `PolicyViolation` event (the contract returns `BLOCKED`).",
    "",
    "## Scenarios",
    "",
    "| ID | Scenario | Expected | Outcome | Transactions |",
    "|---|---|---|---|---|",
    ...run.scenarios.map((scenario) => `| ${scenario.id} | ${cell(scenario.title)} | ${cell(scenario.expectation)} | ${scenario.passed ? "✅" : "❌"} ${cell(scenario.detail)} | ${scenario.transactions.length} |`),
    "",
    "## Transactions",
    "",
    "| Scenario | Step | Tx hash | Block | Block hash | Events | Timestamp (UTC) | Result |",
    "|---|---|---|---|---|---|---|---|",
    ...run.transactions.map((tx) => {
      const events = tx.events.length ? tx.events.map((event) => event.name === "PolicyViolation" ? `PolicyViolation(${event.args.reason})` : event.name).join(", ") : "—";
      return `| ${tx.scenario} ${cell(byScenario.get(tx.scenario)?.title ?? "")} | ${cell(tx.label)} | \`${tx.hash}\` | ${tx.blockNumber} | \`${tx.blockHash}\` | ${cell(events)} | ${tx.timestamp} | ${tx.status === "reverted" ? "❌ " : ""}${cell(tx.result)} |`;
    }),
    "",
    "## Exported files",
    "",
    "- `evidence/evidence.json`: run metadata, scenarios, and every transaction with decoded call, events, roles, gas, and result.",
    "- `evidence/receipts/<tx hash>.json`: the raw `eth_getTransactionReceipt` and `eth_getTransactionByHash` responses, unmodified.",
    snapshot
      ? `- \`${snapshot.file}\`: ${snapshot.node} data directory at block ${snapshot.blockNumber} (\`${snapshot.blockHash}\`), ${(snapshot.bytes / 1_048_576).toFixed(1)} MiB, SHA-256 \`${snapshot.sha256}\`. Taken ${snapshot.takenAt} with ${snapshot.node} stopped (consensus continued on three of four nodes) and restarted afterwards. Excludes ${snapshot.excludes.join(", ")}, which hold node signing material.`
      : "- Node data snapshot: not taken in this run.",
    "",
    "## Verification",
    "",
    "`scripts/verify-evidence.sh` has two modes, and they prove different things.",
    "",
    "**Mode (a), `--running`, checks the original hashes.** For every exported transaction it asks each of the four running nodes for the receipt and the transaction by hash, requires both to equal the exported raw responses exactly (canonical JSON), and requires the block at the recorded height to carry the recorded block hash. Passing means the published hashes are on the chain, unchanged, and agreed by every node.",
    "",
    "**Mode (b), `--fresh`, proves reproducibility.** It builds a separate four-node FISCO BCOS network from the same binary on other loopback ports, deploys from scratch, replays every scenario, and compares the replay with the original. Hashes and block hashes necessarily differ (new timestamps, nonces, and random intent IDs), so the comparison is on effects: for each scenario the same number of transactions, and for each transaction the same sender and target roles, decoded call, status, gas (exact on FISCO BCOS, which does not price calldata bytes; on EVM chains the per-byte calldata charge is set aside because random intent IDs change it), result, and decoded events with identical arguments apart from intent IDs and timestamps. Passing means anyone with this repository gets the same outcomes, not just the same story.",
    "",
  ];
  if (verification.running) {
    const v = verification.running;
    lines.push(`Latest mode (a) run, ${v.verifiedAt}: **${v.passed ? "passed" : "FAILED"}**.`, "", "| Endpoint | Checked | Matched |", "|---|---|---|",
      ...v.endpoints.map((endpoint) => `| ${endpoint.rpcUrl} | ${endpoint.checked} | ${endpoint.matched} |`), "");
    for (const endpoint of v.endpoints) for (const mismatch of endpoint.mismatches.slice(0, 10)) lines.push(`- ${endpoint.rpcUrl}: ${cell(mismatch)}`);
  }
  if (verification.fresh) {
    const v = verification.fresh;
    lines.push(`Latest mode (b) run, ${v.verifiedAt}: **${v.passed ? "passed" : "FAILED"}**. Replay on ${v.replay.rpcUrl} (${v.replay.clientVersion}), blocks ${v.replay.firstBlock}–${v.replay.lastBlock}: ${v.scenariosMatched}/${v.scenarios} scenarios and ${v.transactionsMatched}/${v.original.transactions} transactions matched (${v.replay.transactions} replayed; ${v.identicalHashes} identical hashes, as expected for independent runs).`, "");
    for (const difference of v.differences.slice(0, 20)) lines.push(`- ${cell(difference)}`);
  }
  if (!verification.running && !verification.fresh) lines.push("Not yet verified. Run `scripts/verify-evidence.sh --running` and `scripts/verify-evidence.sh --fresh`.");
  return `${lines.join("\n")}\n`;
}
