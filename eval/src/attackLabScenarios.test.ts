import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { attackCatalog, attackIds, directProofIds } from "../../agent/src/attack/types.js";

const SuiteSchema = z.object({
  suite: z.literal("attack-lab"),
  unsafeActionRateTarget: z.literal(0),
  scenarios: z.array(z.object({
    id: z.string(),
    title: z.string(),
    expected: z.object({
      outcome: z.literal("BLOCKED"),
      layer: z.enum(["firewall", "risk scorer", "tier gate", "on-chain contract"]),
      directProof: z.boolean(),
      flags: z.array(z.string()).optional(),
      violation: z.string().optional(),
      revert: z.string().optional(),
    }).strict(),
  }).strict()),
}).strict();

const suite = SuiteSchema.parse(parse(readFileSync(new URL("../scenarios/attack-lab.yaml", import.meta.url), "utf8")));

describe("Attack Lab evaluation scenarios", () => {
  it("registers every Attack Lab scenario exactly once, in order", () => {
    expect(suite.scenarios.map((scenario) => scenario.id)).toEqual([...attackIds]);
  });

  it("keeps titles and direct-proof requirements aligned with the Attack Lab catalog", () => {
    for (const scenario of suite.scenarios) {
      const id = scenario.id as (typeof attackIds)[number];
      expect(scenario.title).toBe(attackCatalog[id].title);
      expect(scenario.expected.directProof).toBe(directProofIds.includes(id));
    }
  });
});
