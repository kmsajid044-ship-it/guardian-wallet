import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

const ContactId = z.enum(["ana", "bob", "cara"]);
/** ISO 4217 code; the harness checks every configured currency. */
const Currency = z.string().regex(/^[A-Z]{3}$/);
const Decimal = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/);
const Transfer = z.object({ contact: ContactId, currency: Currency, amount: Decimal }).strict();
const Saving = z.object({ currency: Currency, amount: Decimal }).strict();

const StepSchema = z.object({
  intake: z.object({
    message: z.string().min(1),
    source: z.enum(["trusted", "untrusted"]).default("trusted"),
    context: z.object({
      memo: z.string().optional(), payeeName: z.string().optional(), fetchedContent: z.string().optional(),
      expectedRecipientContactId: z.string().optional(),
    }).strict().optional(),
  }).strict(),
  expect: z.object({
    route: z.enum(["EXECUTED", "NEEDS_APPROVAL", "BLOCKED", "ANSWER_ONLY", "SCHEDULE_READY"]),
    tier: z.enum(["T0", "T1", "T2", "T3"]).optional(),
    flags: z.array(z.string()).optional(),
    questionIncludes: z.string().optional(),
    onChain: z.boolean().optional(),
    transfers: z.array(Transfer).optional(),
    savings: z.array(Saving).optional(),
  }).strict(),
  owner: z.enum(["approve", "reject"]).optional(),
}).strict();

const ChatScenarioSchema = z.object({
  id: z.string().regex(/^[NCX][0-9]{2}$/),
  title: z.string().min(1),
  manualMinutes: z.number().positive().optional(),
  steps: z.array(StepSchema).min(1),
  expect: z.object({ transfers: z.array(Transfer).optional(), savings: z.array(Saving).optional() }).strict().optional(),
}).strict();

const ChatSuiteSchema = z.object({ suite: z.enum(["normal", "clarification", "attack"]), scenarios: z.array(ChatScenarioSchema).min(1) }).strict();

const AttackLabSuiteSchema = z.object({
  suite: z.literal("attack-lab"),
  unsafeActionRateTarget: z.literal(0),
  scenarios: z.array(z.object({
    id: z.string().regex(/^A[0-9]{1,2}$/),
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

export type Suite = "normal" | "clarification" | "attack" | "attack-lab";
export type ChatStep = z.infer<typeof StepSchema>;
export type TransferExpectation = z.infer<typeof Transfer>;
export type SavingExpectation = z.infer<typeof Saving>;
export type ChatScenario = z.infer<typeof ChatScenarioSchema> & { suite: Exclude<Suite, "attack-lab"> };
export type AttackLabScenario = z.infer<typeof AttackLabSuiteSchema>["scenarios"][number] & { suite: "attack-lab" };
export type Scenario = ChatScenario | AttackLabScenario;

export const scenarioDirectory = fileURLToPath(new URL("../scenarios/", import.meta.url));

export function loadScenarios(directory = scenarioDirectory): Scenario[] {
  const order: Suite[] = ["normal", "clarification", "attack", "attack-lab"];
  const scenarios = readdirSync(directory).filter((name) => name.endsWith(".yaml")).sort().flatMap((name): Scenario[] => {
    const raw = parse(readFileSync(resolve(directory, name), "utf8")) as { suite?: unknown };
    if (raw.suite === "attack-lab") return AttackLabSuiteSchema.parse(raw).scenarios.map((scenario) => ({ ...scenario, suite: "attack-lab" as const }));
    const suite = ChatSuiteSchema.parse(raw);
    return suite.scenarios.map((scenario) => ({ ...scenario, suite: suite.suite }));
  });
  const ids = scenarios.map((scenario) => scenario.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`duplicate scenario id ${duplicate}`);
  return scenarios.sort((left, right) => order.indexOf(left.suite) - order.indexOf(right.suite));
}
