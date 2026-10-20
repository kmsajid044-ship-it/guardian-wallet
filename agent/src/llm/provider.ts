import { z } from "zod";
import type { JsonValue } from "../audit/audit.js";
import { AnthropicAdapter } from "./anthropic.js";
import type { ExplanationInput, Fetch, LlmAdapter, LlmProvider } from "./adapter.js";
import { parseWithMock, type Intake } from "./mock.js";
import { OpenAiCompatAdapter } from "./openaiCompat.js";
import { CloudLlmAdapter, PROVIDER_DEFAULTS, modelLabel, type CloudOptions } from "./cloud.js";

const AnthropicEnvironmentSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1),
});
const OpenAiEnvironmentSchema = z.object({
  OPENAI_COMPAT_BASE_URL: z.string().url(),
  OPENAI_COMPAT_API_KEY: z.string().min(1),
  OPENAI_COMPAT_MODEL: z.string().min(1),
});

export class MockAdapter implements LlmAdapter {
  readonly provider = "mock" as const;
  async propose(intake: Intake): Promise<ReturnType<typeof parseWithMock>> { return parseWithMock(intake); }
  async explain(input: ExplanationInput): Promise<string> { return deterministicExplanation(input.structuredResult); }
}

const GroqEnvironmentSchema = z.object({ GROQ_API_KEY: z.string().min(1), GROQ_MODEL: z.string().min(1).optional() });
const GeminiEnvironmentSchema = z.object({ GEMINI_API_KEY: z.string().min(1), GEMINI_MODEL: z.string().min(1).optional() });

/**
 * The configured adapter, or the offline rules when its key is missing: the app always runs.
 * `cloud` passes pacing and an evidence hook to the Groq and Gemini adapters.
 */
export function createLlmAdapter(provider: LlmProvider, environment: NodeJS.ProcessEnv = process.env, fetcher: Fetch = fetch, cloud: Omit<CloudOptions, "fetcher"> = {}): LlmAdapter {
  if (provider === "mock") return new MockAdapter();
  try {
    if (provider === "groq") {
      const value = GroqEnvironmentSchema.parse(environment);
      return new CloudLlmAdapter("groq", PROVIDER_DEFAULTS.groq.baseUrl, value.GROQ_API_KEY, value.GROQ_MODEL ?? PROVIDER_DEFAULTS.groq.model, { ...cloud, fetcher });
    }
    if (provider === "gemini") {
      const value = GeminiEnvironmentSchema.parse(environment);
      return new CloudLlmAdapter("gemini", PROVIDER_DEFAULTS.gemini.baseUrl, value.GEMINI_API_KEY, value.GEMINI_MODEL ?? PROVIDER_DEFAULTS.gemini.model, { ...cloud, fetcher });
    }
    if (provider === "anthropic") {
      const value = AnthropicEnvironmentSchema.parse(environment);
      return new AnthropicAdapter(value.ANTHROPIC_API_KEY, value.ANTHROPIC_MODEL, fetcher);
    }
    const value = OpenAiEnvironmentSchema.parse(environment);
    return new OpenAiCompatAdapter(value.OPENAI_COMPAT_BASE_URL, value.OPENAI_COMPAT_API_KEY, value.OPENAI_COMPAT_MODEL, fetcher);
  } catch {
    return new MockAdapter();
  }
}

/** "AI: GPT-OSS 120B via Groq", or "AI: offline rules" when no model is in use. */
export function adapterLabel(adapter: LlmAdapter): string {
  if (adapter.provider === "mock" || !adapter.model) return adapter.provider === "mock" ? "offline rules" : adapter.provider;
  const via = adapter.provider === "groq" || adapter.provider === "gemini" ? PROVIDER_DEFAULTS[adapter.provider].name : adapter.provider === "anthropic" ? "Anthropic" : "OpenAI-compatible API";
  return `${modelLabel(adapter.model)} via ${via}`;
}

function deterministicExplanation(value: JsonValue): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "The request was processed from the structured result.";
  const route = typeof value.route === "string" ? value.route : "UNKNOWN";
  const proposal = typeof value.proposal === "object" && value.proposal !== null && !Array.isArray(value.proposal) ? value.proposal : {};
  const kind = typeof proposal.kind === "string" ? proposal.kind : "request";
  const amount = typeof proposal.amount === "string" ? ` for ${proposal.amount} ${proposal.currency ?? "demo units"}` : "";
  const contact = typeof proposal.recipientContactId === "string" ? ` to contact ${proposal.recipientContactId}` : "";
  if (route === "EXECUTED") return `Executed ${kind}${amount}${contact} after policy, simulation, and risk checks.`;
  if (route === "NEEDS_APPROVAL") return `Routed ${kind}${amount}${contact} for owner approval.`;
  if (route === "BLOCKED") return `Blocked ${kind}${amount}${contact} based on the structured safety checks.`;
  if (route === "SCHEDULE_READY") return `Validated ${kind}${amount}${contact} for recurring scheduling; each occurrence will run through the full pipeline.`;
  return typeof proposal.reason === "string" ? proposal.reason : "No ledger action was proposed.";
}
