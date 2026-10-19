import { describe, expect, it } from "vitest";
import { attackCatalog, attackIds, directProofIds } from "../../agent/src/attack/types.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { loadScenarios, type AttackLabScenario, type ChatScenario } from "./scenarios.js";

const scenarios = loadScenarios();

describe("evaluation scenarios", () => {
  it("has at least 30 scenarios across normal, clarification, and attack suites", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(30);
    const suites = new Set(scenarios.map((scenario) => scenario.suite));
    expect([...suites].sort()).toEqual(["attack", "attack-lab", "clarification", "normal"]);
    expect(scenarios.filter((scenario) => scenario.suite === "normal").every((scenario) => "manualMinutes" in scenario && scenario.manualMinutes! > 0)).toBe(true);
  });

  it("registers every Attack Lab scenario exactly once, in order", () => {
    expect(scenarios.filter((scenario) => scenario.suite === "attack-lab").map((scenario) => scenario.id)).toEqual([...attackIds]);
  });

  it("keeps titles and direct-proof requirements aligned with the Attack Lab catalog", () => {
    for (const scenario of scenarios.filter((item): item is AttackLabScenario => item.suite === "attack-lab")) {
      const id = scenario.id as (typeof attackIds)[number];
      expect(scenario.title).toBe(attackCatalog[id].title);
      expect(scenario.expected.directProof).toBe(directProofIds.includes(id));
    }
  });

  it("expects nothing to move in clarification and attack scenarios", () => {
    for (const scenario of scenarios) {
      if (scenario.suite !== "clarification" && scenario.suite !== "attack") continue;
      for (const step of scenario.steps) expect(step.expect.transfers ?? []).toEqual([]);
    }
  });

  it("loads N13 as a plan scenario for the exact multi-step request and rejects mixed forms", () => {
    const n13 = scenarios.find((scenario) => scenario.id === "N13") as ChatScenario;
    expect(n13.steps).toEqual([]);
    expect(n13.plan?.message).toBe("Pay Ana 50 USD, then move 200 CNY to savings, and ask me before anything above 300 USD.");
    expect(n13.plan?.expect.steps.map((step) => step.state)).toEqual(["EXECUTED", "EXECUTED"]);
    const directory = mkdtempSync(join(tmpdir(), "guardian-scenarios-"));
    try {
      const plan = { message: "Save 1 USD then Save 2 USD", expect: { status: "COMPLETED", validated: ["VALIDATED", "VALIDATED"], steps: [{ operation: "saveToSavings", state: "EXECUTED", onChain: true }, { operation: "saveToSavings", state: "EXECUTED", onChain: true }] } };
      writeFileSync(join(directory, "mixed.yaml"), stringify({ suite: "normal", scenarios: [{ id: "N99", title: "mixed", plan, steps: [{ intake: { message: "Save 1 USD" }, expect: { route: "EXECUTED" } }] }] }));
      expect(() => loadScenarios(directory)).toThrow(/exactly one of steps or plan/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("loads the 20 held-out scenarios in their documented format without changing the original scenarios", () => {
    const heldout = loadScenarios(undefined, "heldout");
    expect(heldout.map((scenario) => scenario.id)).toEqual(Array.from({ length: 20 }, (_, index) => `H${String(index + 1).padStart(2, "0")}`));
    expect(heldout.every((scenario) => scenario.suite === "heldout" && "heldout" in scenario && scenario.heldout !== undefined)).toBe(true);
    expect(loadScenarios(undefined, "all")).toHaveLength(scenarios.length + 20);
  });
});
