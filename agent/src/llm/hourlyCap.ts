import { z } from "zod";
import type { ExplanationInput, LlmAdapter } from "./adapter.js";
import type { Intake } from "./mock.js";

const HOUR_MS = 60 * 60 * 1_000;
const CapEnvironmentSchema = z.object({ LLM_HOURLY_CAP: z.coerce.number().int().positive().optional() });

export class LlmHourlyCapReached extends Error {
  constructor() { super("LLM hourly call cap reached; the offline rules answer until the hour rolls over"); }
}

/**
 * Hosted demo only: at most `limit` model calls in any rolling hour, so a public page cannot drain a
 * free API quota. Over the cap the call throws, and the pipeline falls back to the offline rules.
 */
export class HourlyCappedAdapter implements LlmAdapter {
  readonly provider: LlmAdapter["provider"];
  readonly model?: string;
  private readonly calls: number[] = [];

  constructor(private readonly inner: LlmAdapter, private readonly limit: number, private readonly now: () => number = Date.now) {
    this.provider = inner.provider;
    if (inner.model !== undefined) this.model = inner.model;
  }

  /** Calls left in the current rolling hour. */
  remaining(): number {
    this.prune();
    return Math.max(0, this.limit - this.calls.length);
  }

  async propose(intake: Intake, contactIds: readonly string[]) {
    this.take();
    return this.inner.propose(intake, contactIds);
  }

  async explain(input: ExplanationInput): Promise<string> {
    this.take();
    return this.inner.explain(input);
  }

  private take(): void {
    this.prune();
    if (this.calls.length >= this.limit) throw new LlmHourlyCapReached();
    this.calls.push(this.now());
  }

  private prune(): void {
    const cutoff = this.now() - HOUR_MS;
    while (this.calls.length > 0 && this.calls[0]! <= cutoff) this.calls.shift();
  }
}

/** Wraps a model adapter when LLM_HOURLY_CAP is set; the offline rules are never capped. */
export function withHourlyCap(adapter: LlmAdapter, environment: NodeJS.ProcessEnv = process.env): LlmAdapter {
  const parsed = CapEnvironmentSchema.safeParse(environment);
  const limit = parsed.success ? parsed.data.LLM_HOURLY_CAP : undefined;
  if (adapter.provider === "mock" || limit === undefined) return adapter;
  return new HourlyCappedAdapter(adapter, limit);
}
