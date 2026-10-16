import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const MetricSchema = z.object({ value: z.number(), numerator: z.number().optional(), denominator: z.number().optional(), target: z.string().optional(), pass: z.boolean().optional(), unit: z.string() });
const EvalRunSchema = z.object({
  generatedAt: z.string(),
  backend: z.string(),
  chainId: z.number(),
  commit: z.string(),
  llm: z.object({ requested: z.string(), effective: z.string() }),
  scenarioCount: z.number(),
  bySuite: z.record(z.string(), z.object({ total: z.number(), succeeded: z.number() })),
  metrics: z.record(z.string(), MetricSchema),
  targetsMet: z.boolean(),
  results: z.array(z.object({ id: z.string(), suite: z.string(), title: z.string(), success: z.boolean(), unsafe: z.boolean(), latencyMs: z.number(), minutesSaved: z.number().optional() })),
});

export type EvalSummary = Omit<z.infer<typeof EvalRunSchema>, "results"> & { scenarios: z.infer<typeof EvalRunSchema>["results"] };

/** Latest `pnpm eval` output, reduced to what the Value Dashboard shows; null before the first run. */
export function readEvalSummary(path: string): EvalSummary | null {
  if (!existsSync(path)) return null;
  const parsed = EvalRunSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) return null;
  const { results, ...rest } = parsed.data;
  return { ...rest, scenarios: results.map(({ id, suite, title, success, unsafe, latencyMs, minutesSaved }) => ({ id, suite, title, success, unsafe, latencyMs, ...(minutesSaved === undefined ? {} : { minutesSaved }) })) };
}
