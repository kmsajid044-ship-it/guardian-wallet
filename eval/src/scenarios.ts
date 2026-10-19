import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

const ContactId = z.enum(["ana", "bob", "cara"]);
const Route = z.enum(["EXECUTED", "NEEDS_APPROVAL", "BLOCKED", "ANSWER_ONLY", "SCHEDULE_READY"]);
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
    route: Route.optional(),
    /** Held-out format: several routes are equally safe; one of them must occur. */
    acceptableRoutes: z.array(Route).min(1).optional(),
    /** Held-out format: the detail a clarifying question must ask for. */
    questionAbout: z.enum(["amount", "currency", "contact"]).optional(),
    tier: z.enum(["T0", "T1", "T2", "T3"]).optional(),
    flags: z.array(z.string()).optional(),
    questionIncludes: z.string().optional(),
    onChain: z.boolean().optional(),
    transfers: z.array(Transfer).optional(),
    savings: z.array(Saving).optional(),
  }).strict().refine((expect) => (expect.route === undefined) !== (expect.acceptableRoutes === undefined), "set exactly one of route or acceptableRoutes"),
  owner: z.enum(["approve", "reject"]).optional(),
}).strict();

const PlanStepState = z.enum(["PLANNED", "VALIDATED", "PENDING_APPROVAL", "EXECUTED", "BLOCKED", "FAILED"]);
/** A multi-step request run as a visible plan: created, validated without signing, then executed. */
const PlanSchema = z.object({
  message: z.string().min(1),
  source: z.enum(["trusted", "untrusted"]).default("trusted"),
  expect: z.object({
    status: z.enum(["COMPLETED", "STOPPED", "WAITING_APPROVAL"]),
    approvalCap: Saving.optional(),
    /** Step states after validation and before execution. */
    validated: z.array(PlanStepState).min(1),
    steps: z.array(z.object({
      operation: z.enum(["pay", "requestApproval", "saveToSavings"]),
      state: PlanStepState,
      tier: z.enum(["T0", "T1", "T2", "T3"]).optional(),
      /** The step carries a transaction hash and block from a real receipt. */
      onChain: z.boolean(),
    }).strict()).min(1),
  }).strict().refine((expect) => expect.validated.length === expect.steps.length, "validated and steps must list every plan step"),
}).strict();

const ChatScenarioSchema = z.object({
  id: z.string().regex(/^[NCX][0-9]{2}$/),
  title: z.string().min(1),
  manualMinutes: z.number().positive().optional(),
  steps: z.array(StepSchema).default([]),
  plan: PlanSchema.optional(),
  expect: z.object({ transfers: z.array(Transfer).optional(), savings: z.array(Saving).optional() }).strict().optional(),
}).strict().refine((scenario) => (scenario.steps.length > 0) !== (scenario.plan !== undefined), "set exactly one of steps or plan");

const ChatSuiteSchema = z.object({ suite: z.enum(["normal", "clarification", "attack"]), scenarios: z.array(ChatScenarioSchema).min(1) }).strict();

/** eval/scenarios/heldout/*.yaml, written from the docs only (see heldout/README.md). */
const HeldoutScenarioSchema = z.object({
  id: z.string().regex(/^H[0-9]{2}$/),
  persona: z.enum(["student", "attacker"]),
  category: z.string().min(1),
  title: z.string().min(1),
  expectedOutcome: z.enum(["execute_T1", "require_approval", "ask_clarification", "block"]),
  steps: z.array(StepSchema).min(1),
  expect: z.object({ transfers: z.array(Transfer).optional(), savings: z.array(Saving).optional() }).strict().optional(),
  why: z.string().min(1),
}).strict();
const HeldoutSuiteSchema = z.object({ suite: z.literal("heldout"), scenarios: z.array(HeldoutScenarioSchema).min(1) }).strict();

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

export type Suite = "normal" | "clarification" | "attack" | "attack-lab" | "heldout";
export type HeldoutMeta = Pick<z.infer<typeof HeldoutScenarioSchema>, "persona" | "category" | "expectedOutcome" | "why">;
export type ChatStep = z.infer<typeof StepSchema>;
export type PlanExpectation = z.infer<typeof PlanSchema>;
export type TransferExpectation = z.infer<typeof Transfer>;
export type SavingExpectation = z.infer<typeof Saving>;
export type ChatScenario = Omit<z.infer<typeof ChatScenarioSchema>, "id"> & { id: string; suite: Exclude<Suite, "attack-lab">; heldout?: HeldoutMeta };
export type AttackLabScenario = z.infer<typeof AttackLabSuiteSchema>["scenarios"][number] & { suite: "attack-lab" };
export type Scenario = ChatScenario | AttackLabScenario;

export const scenarioDirectory = fileURLToPath(new URL("../scenarios/", import.meta.url));

export type SuiteSelection = "original" | "heldout" | "all";

/** "original": the 42 top-level scenarios; "heldout": eval/scenarios/heldout; "all": both. */
export function loadScenarios(directory = scenarioDirectory, selection: SuiteSelection = "original"): Scenario[] {
  const order: Suite[] = ["normal", "clarification", "attack", "attack-lab", "heldout"];
  const scenarios = readdirSync(directory).filter((name) => name.endsWith(".yaml")).sort().flatMap((name): Scenario[] => {
    const raw = parse(readFileSync(resolve(directory, name), "utf8")) as { suite?: unknown };
    if (raw.suite === "attack-lab") return AttackLabSuiteSchema.parse(raw).scenarios.map((scenario) => ({ ...scenario, suite: "attack-lab" as const }));
    const suite = ChatSuiteSchema.parse(raw);
    return suite.scenarios.map((scenario) => ({ ...scenario, suite: suite.suite }));
  });
  const heldoutDirectory = resolve(directory, "heldout");
  const heldout = existsSync(heldoutDirectory) ? readdirSync(heldoutDirectory).filter((name) => name.endsWith(".yaml")).sort().flatMap((name): Scenario[] =>
    HeldoutSuiteSchema.parse(parse(readFileSync(resolve(heldoutDirectory, name), "utf8"))).scenarios.map(({ persona, category, expectedOutcome, why, ...scenario }) => ({
      ...scenario, suite: "heldout" as const, heldout: { persona, category, expectedOutcome, why },
    }))).sort((left, right) => left.id.localeCompare(right.id)) : [];
  if (selection === "heldout") return heldout;
  if (selection === "all") scenarios.push(...heldout);
  const ids = scenarios.map((scenario) => scenario.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`duplicate scenario id ${duplicate}`);
  return scenarios.sort((left, right) => order.indexOf(left.suite) - order.indexOf(right.suite));
}
