import { describe, expect, it } from "vitest";
import { CloudLlmAdapter, modelLabel, retryAfterMs, type LlmTrace } from "./cloud.js";
import { adapterLabel, createLlmAdapter } from "./provider.js";

const intake = { message: "Pay Ana 50 USD", source: "trusted" as const, sourceRefs: ["test"] };
const proposal = { kind: "pay", currency: "USD", recipientContactId: "ana", amount: "50", reason: "Pay Ana", sourceRefs: ["test"] };
const toolReply = (args: string) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "propose_action", arguments: args } }] } }], usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 } });
const response = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function adapter(replies: Response[], traces: LlmTrace[] = [], waits: number[] = []) {
  const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = replies.shift();
    if (!next) throw new Error("no more replies");
    return next;
  };
  const instance = new CloudLlmAdapter("groq", "https://api.groq.com/openai/v1", "test-key-not-real", "openai/gpt-oss-120b", { fetcher, onTrace: (trace) => traces.push(trace), sleep: async (ms) => { waits.push(ms); } });
  return { instance, requests };
}

describe("CloudLlmAdapter", () => {
  it("returns a zod-validated proposal from the forced tool call and traces the raw output without the key", async () => {
    const traces: LlmTrace[] = [];
    const { instance, requests } = adapter([response(200, toolReply(JSON.stringify(proposal)))], traces);
    expect(await instance.propose(intake, ["ana"])).toEqual(proposal);
    expect(requests[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(requests[0]!.body).toMatchObject({ model: "openai/gpt-oss-120b", temperature: 0, reasoning_effort: "low", tool_choice: { type: "function", function: { name: "propose_action" } } });
    expect(traces[0]).toMatchObject({ kind: "propose", outcome: "ok", userText: "Pay Ana 50 USD", proposal, attempts: [{ status: 200, usage: { total: 380 } }] });
    expect(JSON.stringify(traces)).not.toContain("test-key-not-real");
  });

  it("retries invalid output once, then throws so the pipeline falls back", async () => {
    const traces: LlmTrace[] = [];
    const { instance, requests } = adapter([response(200, toolReply("{not json")), response(200, toolReply(JSON.stringify({ kind: "transfer" })))], traces);
    await expect(instance.propose(intake, ["ana"])).rejects.toThrow(/did not match the proposal schema/);
    expect(requests).toHaveLength(2);
    expect(traces[0]).toMatchObject({ outcome: "invalid_output", attempts: [{ rawOutput: "{not json" }, { status: 200 }] });
  });

  it("recovers when the retry after invalid output is valid", async () => {
    const { instance } = adapter([response(200, toolReply("oops")), response(200, toolReply(JSON.stringify(proposal)))]);
    expect(await instance.propose(intake, ["ana"])).toEqual(proposal);
  });

  it("backs off on 429 up to three times, then gives up", async () => {
    const traces: LlmTrace[] = []; const waits: number[] = [];
    const limited = () => response(429, { error: { message: "rate limit" } }, { "retry-after": "1" });
    const { instance, requests } = adapter([limited(), limited(), limited(), limited()], traces, waits);
    await expect(instance.propose(intake, ["ana"])).rejects.toThrow(/rate limit/);
    expect(requests).toHaveLength(4);
    expect(waits).toEqual([2_000, 4_000, 8_000]);
    expect(traces[0]!.outcome).toBe("rate_limited");
  });

  it("succeeds after a 429 and honours the server's reset hint", async () => {
    const waits: number[] = [];
    const { instance } = adapter([response(429, {}, { "x-ratelimit-reset-tokens": "7.5s" }), response(200, toolReply(JSON.stringify(proposal)))], [], waits);
    expect(await instance.propose(intake, ["ana"])).toEqual(proposal);
    expect(waits).toEqual([7_500]);
  });

  it("reads reset hints in Groq's formats", () => {
    const headers = (value: Record<string, string>) => ({ headers: new Headers(value) });
    expect(retryAfterMs(headers({ "x-ratelimit-reset-tokens": "1m26.4s" }))).toBe(86_400);
    expect(retryAfterMs(headers({ "x-ratelimit-reset-tokens": "705ms" }))).toBe(705);
    expect(retryAfterMs(headers({}))).toBe(0);
  });
});

describe("provider selection", () => {
  it("uses Groq with the default model when GROQ_API_KEY is set, and offline rules without a key", () => {
    const groq = createLlmAdapter("groq", { GROQ_API_KEY: "test-key-not-real" });
    expect(groq.provider).toBe("groq");
    expect(groq.model).toBe("openai/gpt-oss-120b");
    expect(adapterLabel(groq)).toBe("GPT-OSS 120B via Groq");
    expect(createLlmAdapter("groq", { GROQ_API_KEY: "k", GROQ_MODEL: "llama-3.3-70b-versatile" }).model).toBe("llama-3.3-70b-versatile");
    expect(adapterLabel(createLlmAdapter("groq", {}))).toBe("offline rules");
    expect(adapterLabel(createLlmAdapter("gemini", { GEMINI_API_KEY: "k" }))).toBe("Gemini 2.5 Flash via Gemini");
    expect(createLlmAdapter("gemini", {}).provider).toBe("mock");
  });

  it("labels models for people", () => {
    expect(modelLabel("llama-3.3-70b-versatile")).toBe("Llama 3.3 70B");
    expect(modelLabel("openai/gpt-oss-120b")).toBe("GPT-OSS 120B");
  });
});
