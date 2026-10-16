import { z } from "zod";
import { ActionProposalSchema, type ActionProposal } from "./actionProposal.js";
import { fetchJson, type ExplanationInput, type Fetch, type LlmAdapter } from "./adapter.js";
import type { Intake } from "./mock.js";
import { actionProposalJsonSchema, buildSystemPrompt, buildUserPrompt, explanationSystemPrompt } from "./prompt.js";

const OpenAiResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        type: z.literal("function"),
        function: z.object({ name: z.string(), arguments: z.string() }),
      }).passthrough()).optional(),
    }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();

export class OpenAiCompatAdapter implements LlmAdapter {
  readonly provider = "openai_compat" as const;

  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly model: string, private readonly fetcher: Fetch = fetch) {}

  async propose(intake: Intake, contactIds: readonly string[]): Promise<ActionProposal> {
    const body = await this.request({
      model: this.model,
      temperature: 0,
      messages: [{ role: "system", content: buildSystemPrompt(contactIds) }, { role: "user", content: buildUserPrompt(intake) }],
      tools: [{ type: "function", function: { name: "propose_action", description: "Return the single validated wallet action proposal.", parameters: actionProposalJsonSchema } }],
      tool_choice: { type: "function", function: { name: "propose_action" } },
      parallel_tool_calls: false,
    });
    const call = body.choices[0]!.message.tool_calls?.find((item) => item.function.name === "propose_action");
    if (!call) throw new Error("OpenAI-compatible response did not call propose_action");
    return ActionProposalSchema.parse(JSON.parse(call.function.arguments) as unknown);
  }

  async explain(input: ExplanationInput): Promise<string> {
    const body = await this.request({
      model: this.model,
      temperature: 0,
      messages: [{ role: "system", content: explanationSystemPrompt }, { role: "user", content: JSON.stringify(input) }],
    });
    const text = body.choices[0]!.message.content?.trim();
    if (!text) throw new Error("OpenAI-compatible response did not contain an explanation");
    return text;
  }

  private async request(body: Record<string, unknown>): Promise<z.infer<typeof OpenAiResponseSchema>> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
    return OpenAiResponseSchema.parse(await fetchJson(this.fetcher, url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }));
  }
}
