// Evaluation runner (SPEC.md §9). Usage:
//   pnpm eval                       run every scenario on the configured local chain
//   pnpm eval N01 X03               run selected scenarios (no files written)
//   pnpm eval --llm=configured      use the configured LLM provider instead of the deterministic parser
// Writes eval/results.json and docs/EVAL_REPORT.md for a full run; exits 1 if a target is missed.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../agent/src/config.js";
import { EvalHarness, type ScenarioResult } from "./harness.js";
import { computeMetrics, targetsMet } from "./metrics.js";
import { evalMarkdown, type EvalRun } from "./report.js";
import { loadScenarios } from "./scenarios.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const selected = args.filter((arg) => !arg.startsWith("--")).map((arg) => arg.toUpperCase());
const llm = args.includes("--llm=configured") ? "configured" : "mock";
const all = loadScenarios();
const unknown = selected.filter((id) => !all.some((scenario) => scenario.id === id));
if (unknown.length) throw new Error(`Unknown scenario: ${unknown.join(", ")}`);
const scenarios = selected.length ? all.filter((scenario) => selected.includes(scenario.id)) : all;

const config = loadConfig();
const harness = new EvalHarness(config, process.env, { llm });
const results: ScenarioResult[] = [];
for (const scenario of scenarios) {
  process.stderr.write(`${scenario.id} ${scenario.title}… `);
  let result: ScenarioResult;
  try { result = await harness.run(scenario); }
  catch (error) {
    result = { id: scenario.id, suite: scenario.suite, title: scenario.title, success: false, unsafe: false, failures: [`harness error: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`], steps: [], latencyMs: 0 };
  }
  results.push(result);
  process.stderr.write(`${result.success ? "ok" : `FAIL (${result.failures.join("; ")})`}${result.unsafe ? " UNSAFE" : ""}\n`);
}

const metrics = computeMetrics(results);
const bySuite: EvalRun["bySuite"] = {};
for (const result of results) {
  const entry = bySuite[result.suite] ??= { total: 0, succeeded: 0 };
  entry.total += 1;
  if (result.success) entry.succeeded += 1;
}
const run: EvalRun = {
  generatedAt: new Date().toISOString(), backend: config.CHAIN_BACKEND, chainId: config.CHAIN_ID, commit: gitCommit(),
  llm: { requested: llm === "configured" ? config.LLM_PROVIDER : "mock", effective: harness.llm.provider },
  scenarioCount: results.length, bySuite, metrics, targetsMet: targetsMet(metrics), results,
};

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
console.log(`\nScenarios: ${results.length} on ${config.CHAIN_BACKEND}`);
console.log(`Task success ${pct(metrics.taskSuccess.value)} · unsafe actions ${pct(metrics.unsafeActionRate.value)} · attacks blocked ${pct(metrics.attackBlockRate.value)} · clarification accuracy ${pct(metrics.clarificationAccuracy.value)}`);
console.log(`Average latency ${metrics.averageLatencyMs.value} ms (p95 ${metrics.p95LatencyMs.value} ms) · estimated ${metrics.estimatedMinutesSaved.value} min saved over ${metrics.estimatedMinutesSaved.denominator} owner tasks`);

if (!selected.length) {
  writeFileSync(resolve(repoRoot, "eval/results.json"), `${JSON.stringify(run, null, 2)}\n`);
  writeFileSync(resolve(repoRoot, "docs/EVAL_REPORT.md"), evalMarkdown(run));
  console.log("Wrote eval/results.json and docs/EVAL_REPORT.md");
}
if (!run.targetsMet) { console.error("One or more targets were missed."); process.exit(1); }

function gitCommit(): string {
  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", ".", ":!:eval/results.json", ":!:docs/EVAL_REPORT.md"], { cwd: repoRoot, encoding: "utf8" }).trim() !== "";
    return dirty ? `${head}+uncommitted` : head;
  }
  catch { return "unknown"; }
}
