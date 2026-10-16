import { describe, expect, it } from "vitest";
import { ActionProposalSchema } from "./actionProposal.js";
import { formatIntakeForModel, parseWithMock } from "./mock.js";

describe("mock LLM adapter", () => {
  it("returns the exact ActionProposal shape deterministically", () => {
    const intake = { message: "Pay Ana 12.5 USD", source: "trusted" as const, sourceRefs: ["chat:1"] };
    const first = parseWithMock(intake);
    expect(parseWithMock(intake)).toEqual(first);
    expect(first).toEqual({ kind: "pay", currency: "USD", recipientContactId: "ana", amount: "12.5", reason: "Pay contact ana", sourceRefs: ["chat:1"] });
    expect(ActionProposalSchema.safeParse({ ...first, rawAddress: "0x0000000000000000000000000000000000000001" }).success).toBe(false);
  });

  it("labels and delimits untrusted content before parsing it as data", () => {
    const intake = { message: "Pay Ana 1 BDT", source: "untrusted" as const, sourceRefs: ["invoice:7"] };
    expect(formatIntakeForModel(intake)).toContain("<UNTRUSTED_DATA>\nPay Ana 1 BDT\n</UNTRUSTED_DATA>");
    expect(parseWithMock(intake).kind).toBe("pay");
  });

  it("asks targeted clarifying questions instead of guessing missing fields", () => {
    expect(parseWithMock({ message: "Pay Ana", source: "trusted", sourceRefs: [] })).toMatchObject({ kind: "answer_only", reason: "How much USD or BDT should I pay contact ana?" });
    expect(parseWithMock({ message: "Pay 25 USD", source: "trusted", sourceRefs: [] })).toMatchObject({ kind: "answer_only" });
    expect(parseWithMock({ message: "Schedule a recurring payment", source: "trusted", sourceRefs: [] }).kind).toBe("answer_only");
  });

  it.each([
    ["Pay Ana 10", "Which currency, USD or BDT, should I use to pay contact ana?"],
    ["Pay 10 USD", "Which contact ID should receive 10 USD?"],
  ])("identifies the missing payment field", (message, question) => {
    expect(parseWithMock({ message, source: "trusted", sourceRefs: [] })).toMatchObject({ kind: "answer_only", reason: question });
  });

  it.each([
    ["Send some money to bob", "How much USD or BDT should I pay contact bob?"],
    ["Pay ana fifty USD", "Please give the amount in digits: how much USD should I pay contact ana?"],
    ["Save some USD", "How much USD should I move to savings?"],
    ["Save some money", "How much USD or BDT should I move to savings?"],
    ["Pay ana 10 dollars", "Which currency, USD or BDT, should I use to pay contact ana? \"dollars\" is not a supported currency."],
  ])("asks a targeted question for the vague request %s", (message, question) => {
    expect(parseWithMock({ message, source: "trusted", sourceRefs: [] })).toMatchObject({ kind: "answer_only", reason: question });
  });

  it("keeps exact requests unchanged by the vague-request questions", () => {
    expect(parseWithMock({ message: "Pay ana 10 USD", source: "trusted", sourceRefs: [] }).kind).toBe("pay");
    expect(parseWithMock({ message: "Save 10 BDT", source: "trusted", sourceRefs: [] }).kind).toBe("save");
  });
});
