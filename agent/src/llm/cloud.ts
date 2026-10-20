import { z } from "zod";
import { ActionProposalSchema, type ActionProposal } from "./actionProposal.js";
import type { ExplanationInput, Fetch, LlmAdapter } from "./adapter.js";
import type { Intake } from "./mock.js";
import { actionProposalJsonSchema, buildSystemPrompt, buildUserPrompt, explanationSystemPrompt } from "./prompt.js";

/*
 * Free cloud LLMs through their OpenAI-compatible APIs (Groq, Gemini). The model only proposes:
 * its JSON is validated with zod here, and the pipeline still runs the firewall, policy pre-check,
 * simulation, risk score, tier gate, and the contract. Failures never stop a payment flow: invalid
 * output is retried once, a rate limit (429) up to three times with backoff, and then the adapter
 * throws so the pipeline falls back to the deterministic parser and marks the result "fallback".
 * The API key is only ever sent in the Authorization header; it is never logged or traced.
 */

export type CloudProvider = "groq" | "gemini";

/** One HTTP attempt as seen by the evidence recorder; never contains the key or headers. */
export type LlmAttempt = { status: number | "error"; rawOutput?: string; error?: string; waitedMs?: number; usage?: { prompt?: number; completion?: number; total?: number } };
export type LlmTrace = {
  kind: "propose" | "explain";
  provider: CloudProvider;
  model: string;
  userText?: string;
  attempts: LlmAttempt[];
  proposal?: ActionProposal;
  validationError?: string;
  outcome: "ok" | "invalid_output" | "rate_limited" | "error";
  latencyMs: number;
};

export type CloudOptions = {
  fetcher?: Fetch;
  /** Minimum gap between requests, to stay under a free tier's tokens-per-minute limit. */
  minIntervalMs?: number;
  onTrace?: (trace: LlmTrace) => void;
  sleep?: (ms: number) => Promise<void>;
};

const ResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({ function: z.object({ name: z.string(), arguments: z.string() }).passthrough() }).passthrough()).optional(),
    }).passthrough(),
  }).passthrough()).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).passthrough().optional(),
}).passthrough();

export const PROVIDER_DEFAULTS: Record<CloudProvider, { baseUrl: string; model: string; name: string }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", name: "Groq" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", name: "Gemini" },
};

class RateLimited extends Error { constructor(readonly waitMs: number, message: string) { super(message); } }
class InvalidOutput extends Error {}

const MAX_RATE_RETRIES = 3;
const MAX_INVALID_RETRIES = 1;

export class CloudLlmAdapter implements LlmAdapter {
  private readonly fetcher: Fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextAllowedAt = 0;

  constructor(readonly provider: CloudProvider, private readonly baseUrl: string, private readonly apiKey: string, readonly model: string, private readonly options: CloudOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async propose(intake: Intake, contactIds: readonly string[]): Promise<ActionProposal> {
    const started = Date.now();
    const trace: LlmTrace = { kind: "propose", provider: this.provider, model: this.model, userText: intake.message, attempts: [], outcome: "error", latencyMs: 0 };
    try {
      for (let invalid = 0; ; invalid += 1) {
        const body = await this.request({
          messages: [{ role: "system", content: buildSystemPrompt(contactIds) }, { role: "user", content: buildUserPrompt(intake) }],
          tools: [{ type: "function", function: { name: "propose_action", description: "Return the single validated wallet action proposal.", parameters: actionProposalJsonSchema() } }],
          tool_choice: { type: "function", function: { name: "propose_action" } },
        }, trace);
        const message = body.choices[0]!.message;
        const raw = message.tool_calls?.find((call) => call.function.name === "propose_action")?.function.arguments ?? message.content ?? "";
        trace.attempts.at(-1)!.rawOutput = raw.slice(0, 4_000);
        try {
          const proposal = ActionProposalSchema.parse(JSON.parse(extractJson(raw)) as unknown);
          trace.proposal = proposal; trace.outcome = "ok";
          return proposal;
        } catch (error) {
          trace.validationError = error instanceof Error ? error.message.slice(0, 1_000) : "invalid output";
          if (invalid >= MAX_INVALID_RETRIES) { trace.outcome = "invalid_output"; throw new InvalidOutput(`model output did not match the proposal schema: ${trace.validationError}`); }
        }
      }
    } catch (error) {
      if (error instanceof RateLimited) trace.outcome = "rate_limited";
      throw error;
    } finally {
      trace.latencyMs = Date.now() - started;
      this.options.onTrace?.(trace);
    }
  }

  async explain(input: ExplanationInput): Promise<string> {
    const started = Date.now();
    const trace: LlmTrace = { kind: "explain", provider: this.provider, model: this.model, attempts: [], outcome: "error", latencyMs: 0 };
    try {
      const body = await this.request({ messages: [{ role: "system", content: explanationSystemPrompt }, { role: "user", content: JSON.stringify(input) }] }, trace);
      const text = body.choices[0]!.message.content?.trim() ?? "";
      trace.attempts.at(-1)!.rawOutput = text.slice(0, 2_000);
      if (!text) throw new InvalidOutput("model returned no explanation");
      trace.outcome = "ok";
      return text;
    } catch (error) {
      if (error instanceof RateLimited) trace.outcome = "rate_limited";
      else if (error instanceof InvalidOutput) trace.outcome = "invalid_output";
      throw error;
    } finally {
      trace.latencyMs = Date.now() - started;
      this.options.onTrace?.(trace);
    }
  }

  /** One logical request with up to three backoff retries on 429. */
  private async request(payload: Record<string, unknown>, trace: LlmTrace): Promise<z.infer<typeof ResponseSchema>> {
    for (let retry = 0; ; retry += 1) {
      await this.pace();
      const attempt: LlmAttempt = { status: "error" };
      trace.attempts.push(attempt);
      try {
        return await this.send(payload, attempt);
      } catch (error) {
        if (!(error instanceof RateLimited) || retry >= MAX_RATE_RETRIES) throw error;
        const wait = Math.min(Math.max(error.waitMs, 2_000 * 2 ** retry), 60_000);
        attempt.waitedMs = wait;
        await this.sleep(wait);
      }
    }
  }

  private async pace(): Promise<void> {
    const gap = this.options.minIntervalMs ?? 0;
    const now = Date.now();
    if (gap > 0 && now < this.nextAllowedAt) await this.sleep(this.nextAllowedAt - now);
    this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + gap;
  }

  private async send(payload: Record<string, unknown>, attempt: LlmAttempt): Promise<z.infer<typeof ResponseSchema>> {
    const body: Record<string, unknown> = { model: this.model, temperature: 0, ...payload };
    // Reasoning models on Groq spend output tokens thinking; keep that short under the free limit.
    if (this.provider === "groq" && this.model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      attempt.error = error instanceof Error ? error.message : "network error";
      throw error;
    }
    attempt.status = response.status;
    const json: unknown = await response.json().catch(() => ({}));
    if (response.status === 429) {
      attempt.error = "rate limited";
      throw new RateLimited(retryAfterMs(response), `${this.provider} rate limit (429)`);
    }
    if (!response.ok) {
      const message = z.object({ error: z.object({ message: z.string() }).partial() }).partial().safeParse(json);
      attempt.error = (message.success ? message.data.error?.message : undefined) ?? `HTTP ${response.status}`;
      // A model that cannot follow the forced tool call is invalid output, retried once above.
      if (response.status === 400 && /tool|function|json/i.test(attempt.error)) throw new InvalidOutput(attempt.error);
      throw new Error(`LLM request failed (${response.status}): ${attempt.error}`);
    }
    const parsed = ResponseSchema.parse(json);
    if (parsed.usage) attempt.usage = { ...(parsed.usage.prompt_tokens === undefined ? {} : { prompt: parsed.usage.prompt_tokens }), ...(parsed.usage.completion_tokens === undefined ? {} : { completion: parsed.usage.completion_tokens }), ...(parsed.usage.total_tokens === undefined ? {} : { total: parsed.usage.total_tokens }) };
    return parsed;
  }
}

/** Retry-After (seconds), or Groq's x-ratelimit-reset-* ("1m26.4s", "705ms"); 0 when absent. */
export function retryAfterMs(response: Pick<Response, "headers">): number {
  const header = response.headers.get("retry-after");
  if (header && Number.isFinite(Number(header))) return Number(header) * 1_000;
  const reset = response.headers.get("x-ratelimit-reset-tokens") ?? response.headers.get("x-ratelimit-reset-requests");
  if (!reset) return 0;
  const match = /^(?:(\d+)m)?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/.exec(reset.trim());
  if (!match) return 0;
  return Math.ceil(Number(match[1] ?? 0) * 60_000 + Number(match[2] ?? 0) * 1_000 + Number(match[3] ?? 0));
}

/** Accepts bare JSON or JSON inside a ```json fence (content fallback when no tool call came back). */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

/** "openai/gpt-oss-120b" → "GPT-OSS 120B"; "llama-3.3-70b-versatile" → "Llama 3.3 70B". */
export function modelLabel(model: string): string {
  const id = model.split("/").pop()!.toLowerCase();
  const oss = /^gpt-oss-(\d+)b/.exec(id);
  if (oss) return `GPT-OSS ${oss[1]}B`;
  const llama = /^llama-?([\d.]+)-(\d+)b/.exec(id);
  if (llama) return `Llama ${llama[1]} ${llama[2]}B`;
  const gemini = /^gemini-([\d.]+)-(\w+)/.exec(id);
  if (gemini) return `Gemini ${gemini[1]} ${gemini[2]![0]!.toUpperCase()}${gemini[2]!.slice(1)}`;
  return model;
}
