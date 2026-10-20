import { z } from "zod";
import type { JsonValue } from "../audit/audit.js";
import type { ActionProposal } from "./actionProposal.js";
import type { Intake } from "./mock.js";

export type LlmProvider = "anthropic" | "openai_compat" | "groq" | "gemini" | "mistral" | "mock";
export type ExplanationInput = { route: string; structuredResult: JsonValue };

export interface LlmAdapter {
  readonly provider: LlmProvider;
  /** Model name for display and evidence; absent for the offline rules. */
  readonly model?: string;
  propose(intake: Intake, contactIds: readonly string[]): Promise<ActionProposal>;
  explain(input: ExplanationInput): Promise<string>;
}

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function fetchJson(fetcher: Fetch, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const body: unknown = await response.json();
  if (!response.ok) {
    const errorShape = z.object({ error: z.object({ message: z.string() }).optional() }).safeParse(body);
    throw new Error(`LLM request failed (${response.status}): ${errorShape.success ? errorShape.data.error?.message ?? "unknown error" : "invalid error response"}`);
  }
  return body;
}
