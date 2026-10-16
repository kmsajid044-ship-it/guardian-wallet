import { describe, expect, it } from "vitest";
import { scoreRisk } from "./score.js";

describe("risk score", () => {
  it.each([
    ["untrusted source", { untrusted: true }, "UNTRUSTED_SOURCE", 20],
    ["injection", { injectionPatternFound: true }, "INJECTION_PATTERN", 30],
    ["amount outlier", { amount: 21n, contactHistory: [10n] }, "ABOVE_CONTACT_MEDIAN", 15],
    ["first payment", { amount: 1n, contactHistory: [] }, "FIRST_PAYMENT", 10],
    ["daily concentration", { amount: 71n, contactHistory: [100n], remainingDaily: 100n }, "MOST_OF_REMAINING_DAILY", 15],
    ["outside hours", { outsideUsualHours: true }, "OUTSIDE_USUAL_HOURS", 10],
    ["payment velocity", { recentPaymentCount: 3 }, "HIGH_VELOCITY", 20],
  ])("scores %s with its own explanation", (_name, overrides, code, points) => {
    const result = scoreRisk({ untrusted: false, injectionPatternFound: false, contactHistory: [100n], outsideUsualHours: false, ...overrides });
    expect(result.factors).toEqual([expect.objectContaining({ code, points, explanation: expect.any(String) })]);
  });

  it("explains every point and applies the specified thresholds", () => {
    const result = scoreRisk({
      untrusted: true,
      injectionPatternFound: true,
      amount: 80n,
      contactHistory: [10n],
      remainingDaily: 100n,
      outsideUsualHours: true,
    });
    expect(result.score).toBe(90);
    expect(result.route).toBe("BLOCK");
    expect(result.factors.map((factor) => factor.points)).toEqual([20, 30, 15, 15, 10]);
  });

  it("forces approval at 60 and above", () => {
    const result = scoreRisk({ untrusted: true, injectionPatternFound: true, amount: 80n, contactHistory: [], remainingDaily: 100n, outsideUsualHours: false });
    expect(result.score).toBe(75);
    expect(result.route).toBe("FORCE_APPROVAL");
  });

  it("feeds paid Risk Intel results into routing", () => {
    expect(scoreRisk({ untrusted: false, injectionPatternFound: false, amount: 1n, contactHistory: [1n], outsideUsualHours: false, riskIntel: { score: 75, sanctioned: false } })).toMatchObject({
      score: 40,
      factors: [expect.objectContaining({ code: "RISK_INTEL_HIGH", points: 40 })],
    });
    expect(scoreRisk({ untrusted: false, injectionPatternFound: false, amount: 1n, contactHistory: [1n], outsideUsualHours: false, riskIntel: { score: 1, sanctioned: true } }).route).toBe("BLOCK");
  });
});
