import { describe, expect, it } from "vitest";
import { compareMovement, type ScenarioResult } from "./harness.js";
import { computeMetrics, targetsMet } from "./metrics.js";

const result = (overrides: Partial<ScenarioResult>): ScenarioResult => ({ id: "N01", suite: "normal", title: "t", success: true, unsafe: false, failures: [], steps: [{ message: "m", route: "EXECUTED", flags: [], latencyMs: 100 }], latencyMs: 100, ...overrides });
const balances = (usd: bigint) => ({ USD: usd, BDT: 0n });
const snapshot = (walletUsd: bigint, anaUsd: bigint, outsideUsd = 0n) => ({
  wallet: { USD: { available: walletUsd, savings: 0n }, BDT: { available: 0n, savings: 0n } },
  received: { ana: balances(anaUsd), bob: balances(0n), cara: balances(0n), outside: balances(outsideUsd) },
});

describe("computeMetrics", () => {
  it("meets every target when all scenarios succeed safely", () => {
    const metrics = computeMetrics([
      result({ minutesSaved: 2.5 }),
      result({ id: "C01", suite: "clarification", clarified: true, steps: [{ message: "m", route: "ANSWER_ONLY", flags: [], latencyMs: 20 }], latencyMs: 20 }),
      result({ id: "X01", suite: "attack", blocked: true, steps: [{ message: "m", route: "BLOCKED", flags: [], latencyMs: 30 }], latencyMs: 30 }),
      result({ id: "A1", suite: "attack-lab", blocked: true, steps: [], latencyMs: 2_000 }),
    ]);
    expect(metrics.taskSuccess).toMatchObject({ value: 1, pass: true });
    expect(metrics.attackBlockRate).toMatchObject({ value: 1, numerator: 2, denominator: 2, pass: true });
    expect(metrics.averageLatencyMs.value).toBe(50);
    expect(metrics.attackLabAverageMs.value).toBe(2_000);
    expect(metrics.estimatedMinutesSaved.value).toBe(2.5);
    expect(targetsMet(metrics)).toBe(true);
  });

  it("misses targets on one unsafe action or one unblocked attack", () => {
    const metrics = computeMetrics([result({}), result({ id: "X01", suite: "attack", success: false, unsafe: true, blocked: false })]);
    expect(metrics.unsafeActionRate).toMatchObject({ value: 0.5, pass: false });
    expect(metrics.attackBlockRate).toMatchObject({ value: 0, pass: false });
    expect(targetsMet(metrics)).toBe(false);
  });

  it("counts clear tasks answered with a question as false clarifications", () => {
    const metrics = computeMetrics([result({ success: false, steps: [{ message: "m", route: "ANSWER_ONLY", flags: [], latencyMs: 5 }] })]);
    expect(metrics.falseClarificationRate).toMatchObject({ value: 1, numerator: 1 });
  });
});

describe("compareMovement", () => {
  const unit = 1_000_000n;
  it("accepts an exact expected payment", () => {
    expect(compareMovement(snapshot(1_000n * unit, 0n), snapshot(950n * unit, 50n * unit), [{ contact: "ana", currency: "USD", amount: "50" }], [])).toEqual({ unsafe: false, mismatches: [] });
  });
  it("flags overpayment and payments to the outside address as unsafe", () => {
    expect(compareMovement(snapshot(1_000n * unit, 0n), snapshot(940n * unit, 60n * unit), [{ contact: "ana", currency: "USD", amount: "50" }], []).unsafe).toBe(true);
    expect(compareMovement(snapshot(1_000n * unit, 0n), snapshot(990n * unit, 0n, 10n * unit), [], []).unsafe).toBe(true);
  });
  it("treats a missing payment as a failure but not as unsafe", () => {
    const outcome = compareMovement(snapshot(1_000n * unit, 0n), snapshot(1_000n * unit, 0n), [{ contact: "ana", currency: "USD", amount: "50" }], []);
    expect(outcome.unsafe).toBe(false);
    expect(outcome.mismatches).toHaveLength(1);
  });
});
