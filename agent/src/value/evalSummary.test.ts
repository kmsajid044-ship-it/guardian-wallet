import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readEvalHistory, readEvalSummary } from "./evalSummary.js";

const directory = mkdtempSync(join(tmpdir(), "guardian-eval-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("readEvalSummary", () => {
  it("returns null before the first evaluation and for malformed output", () => {
    expect(readEvalSummary(join(directory, "missing.json"))).toBeNull();
    writeFileSync(join(directory, "bad.json"), JSON.stringify({ metrics: 1 }));
    expect(readEvalSummary(join(directory, "bad.json"))).toBeNull();
  });

  it("reduces results to the dashboard fields", () => {
    const run = {
      generatedAt: "2026-10-16T10:00:00.000Z", backend: "fisco", chainId: 1337, commit: "abc1234", llm: { requested: "mock", effective: "mock" },
      scenarioCount: 1, bySuite: { normal: { total: 1, succeeded: 1 } }, targetsMet: true,
      metrics: { taskSuccess: { value: 1, numerator: 1, denominator: 1, target: "≥ 90%", pass: true, unit: "ratio" } },
      results: [{ id: "N01", suite: "normal", title: "Pay", success: true, unsafe: false, latencyMs: 210, minutesSaved: 2.9, steps: [{ transactionHash: "0x1" }], failures: [] }],
    };
    writeFileSync(join(directory, "results.json"), JSON.stringify(run));
    expect(readEvalSummary(join(directory, "results.json"))).toEqual({ ...run, results: undefined, scenarios: [{ id: "N01", suite: "normal", title: "Pay", success: true, unsafe: false, latencyMs: 210, minutesSaved: 2.9 }] });
  });

  it("reads labelled run history and keeps only failed scenario IDs", () => {
    expect(readEvalHistory(join(directory, "missing-history.json"))).toEqual([]);
    const metric = { value: 0.8, numerator: 16, denominator: 20, unit: "ratio" };
    writeFileSync(join(directory, "history.json"), JSON.stringify([{ label: "held-out, before fixes", generatedAt: "2026-10-19T08:46:00.000Z", commit: "0a3d437", suite: "heldout", llm: "mock", scenarioCount: 20, taskSuccess: metric, unsafeActionRate: { ...metric, value: 0, numerator: 0 }, attackBlockRate: metric, clarificationAccuracy: metric, failures: [{ id: "H01", title: "t", unsafe: false, reasons: ["route"] }] }]));
    expect(readEvalHistory(join(directory, "history.json"))).toMatchObject([{ label: "held-out, before fixes", scenarioCount: 20, failedIds: ["H01"] }]);
  });
});
