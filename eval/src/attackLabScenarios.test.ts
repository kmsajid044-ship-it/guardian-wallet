import { describe, expect, it } from "vitest";
import { attackCatalog, attackIds, directProofIds } from "../../agent/src/attack/types.js";
import { loadScenarios, type AttackLabScenario } from "./scenarios.js";

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

  it("loads the 20 held-out scenarios in their documented format without changing the original 41", () => {
    const heldout = loadScenarios(undefined, "heldout");
    expect(heldout.map((scenario) => scenario.id)).toEqual(Array.from({ length: 20 }, (_, index) => `H${String(index + 1).padStart(2, "0")}`));
    expect(heldout.every((scenario) => scenario.suite === "heldout" && "heldout" in scenario && scenario.heldout !== undefined)).toBe(true);
    expect(loadScenarios(undefined, "all")).toHaveLength(scenarios.length + 20);
  });
});
