import { z } from "zod";
import { ActionProposalSchema, type ActionProposal } from "./actionProposal.js";
import { fetchJson, type ExplanationInput, type Fetch, type LlmAdapter } from "./adapter.js";
import type { Intake } from "./mock.js";
import { actionProposalJsonSchema, buildSystemPrompt, buildUserPrompt, explanationSystemPrompt } from "./prompt.js";

const AnthropicResponseSchema = z.object({
  content: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("tool_use"), name: z.string(), input: z.unknown() }).passthrough(),
    z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
  ])),
}).passthrough();

export class AnthropicAdapter implements LlmAdapter {
  readonly provider = "anthropic" as const;

  constructor(private readonly apiKey: string, private readonly model: string, private readonly fetcher: Fetch = fetch) {}

  async propose(intake: Intake, contactIds: readonly string[]): Promise<ActionProposal> {
    const body = await this.request({
      model: this.model,
      max_tokens: 700,
      system: buildSystemPrompt(contactIds),
      messages: [{ role: "user", content: buildUserPrompt(intake) }],
      tools: [{ name: "propose_action", description: "Return the single validated wallet action proposal.", input_schema: actionProposalJsonSchema() }],
      tool_choice: { type: "tool", name: "propose_action" },
    });
    const tool = body.content.find((item) => item.type === "tool_use" && item.name === "propose_action");
    if (!tool || tool.type !== "tool_use") throw new Error("Anthropic response did not call propose_action");
    return ActionProposalSchema.parse(tool.input);
  }

  async explain(input: ExplanationInput): Promise<string> {
    const body = await this.request({
      model: this.model,
      max_tokens: 180,
      system: explanationSystemPrompt,
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });
    const text = body.content.find((item) => item.type === "text");
    if (!text || text.type !== "text" || text.text.trim() === "") throw new Error("Anthropic response did not contain an explanation");
    return text.text.trim();
  }

  private async request(body: Record<string, unknown>): Promise<z.infer<typeof AnthropicResponseSchema>> {
    return AnthropicResponseSchema.parse(await fetchJson(this.fetcher, "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    }));
  }
}
