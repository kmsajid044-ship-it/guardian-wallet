import { describe, expect, it, vi } from "vitest";
import type { LlmAdapter } from "./adapter.js";
import { HourlyCappedAdapter, LlmHourlyCapReached, withHourlyCap } from "./hourlyCap.js";
import { MockAdapter } from "./provider.js";

const intake = { message: "Pay ana 5 USD", source: "trusted" as const, sourceRefs: [] };
const proposal = { kind: "pay" as const, currency: "USD", recipientContactId: "ana", amount: "5", reason: "test", sourceRefs: [] };

function fakeModel(): LlmAdapter & { propose: ReturnType<typeof vi.fn>; explain: ReturnType<typeof vi.fn> } {
  return { provider: "groq", model: "openai/gpt-oss-120b", propose: vi.fn(async () => proposal), explain: vi.fn(async () => "ok") };
}

describe("LLM hourly cap", () => {
  it("passes calls through until the cap, then refuses without calling the model", async () => {
    let now = 0;
    const inner = fakeModel();
    const capped = new HourlyCappedAdapter(inner, 2, () => now);
    await expect(capped.propose(intake, ["ana"])).resolves.toEqual(proposal);
    await expect(capped.explain({ route: "EXECUTED", structuredResult: {} })).resolves.toBe("ok");
    expect(capped.remaining()).toBe(0);
    await expect(capped.propose(intake, ["ana"])).rejects.toBeInstanceOf(LlmHourlyCapReached);
    expect(inner.propose).toHaveBeenCalledTimes(1);
    now = 60 * 60 * 1_000 + 1;
    expect(capped.remaining()).toBe(2);
    await expect(capped.propose(intake, ["ana"])).resolves.toEqual(proposal);
  });

  it("keeps the provider and model visible and wraps only when LLM_HOURLY_CAP is set", () => {
    const inner = fakeModel();
    const capped = withHourlyCap(inner, { LLM_HOURLY_CAP: "40" });
    expect(capped).toBeInstanceOf(HourlyCappedAdapter);
    expect(capped).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b" });
    expect(withHourlyCap(inner, {})).toBe(inner);
    expect(withHourlyCap(inner, { LLM_HOURLY_CAP: "zero" })).toBe(inner);
    const offline = new MockAdapter();
    expect(withHourlyCap(offline, { LLM_HOURLY_CAP: "1" })).toBe(offline);
  });
});
