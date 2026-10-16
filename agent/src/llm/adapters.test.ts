import { describe, expect, it, vi } from "vitest";
import { AnthropicAdapter } from "./anthropic.js";
import type { Fetch } from "./adapter.js";
import { OpenAiCompatAdapter } from "./openaiCompat.js";

const intake = { message: "Pay Ana 12 USD", source: "untrusted" as const, sourceRefs: ["invoice:1"] };
const proposal = { kind: "pay", currency: "USD", recipientContactId: "ana", amount: "12", reason: "invoice", sourceRefs: ["invoice:1"] };

describe("provider adapters", () => {
  it("forces Anthropic tool use without exposing contact addresses", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(jsonResponse({ content: [{ type: "tool_use", name: "propose_action", input: proposal }] }));
    const result = await new AnthropicAdapter("secret", "model", fetcher).propose(intake, ["ana", "bob"]);
    expect(result).toEqual(proposal);
    const [url, init] = fetcher.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.tool_choice).toEqual({ type: "tool", name: "propose_action" });
    expect(body.system).toContain("Known contact IDs: ana, bob");
    expect(body.messages[0].content).toContain("<UNTRUSTED_DATA>");
    expect(JSON.stringify(body)).not.toContain("0x");
  });

  it("forces OpenAI-compatible function calling and validates arguments", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: null, tool_calls: [{ type: "function", function: { name: "propose_action", arguments: JSON.stringify(proposal) } }] } }] }));
    const result = await new OpenAiCompatAdapter("https://llm.example/v1/", "secret", "model", fetcher).propose(intake, ["ana"]);
    expect(result).toEqual(proposal);
    const [url, init] = fetcher.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "propose_action" } });
    expect(body.parallel_tool_calls).toBe(false);
  });

  it("sends only structured results to the explanation step", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "Executed safely." } }] }));
    await new OpenAiCompatAdapter("https://llm.example/v1", "secret", "model", fetcher).explain({ route: "EXECUTED", structuredResult: { route: "EXECUTED", amount: "12" } });
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(body.messages[1].content).toBe('{"route":"EXECUTED","structuredResult":{"route":"EXECUTED","amount":"12"}}');
    expect(body.messages[1].content).not.toContain(intake.message);
    expect(body.tools).toBeUndefined();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
