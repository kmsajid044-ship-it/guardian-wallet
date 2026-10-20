import { describe, expect, it } from "vitest";
import { groundProposal } from "./grounding.js";

const contacts = ["ana", "bob", "cara"];
const pay = (amount: string, currency: string, recipientContactId = "ana") => ({ kind: "pay" as const, amount, currency, recipientContactId, reason: "test", sourceRefs: [] });

describe("groundProposal", () => {
  it("accepts details written in the request, including grouped thousands and currency symbols", () => {
    expect(groundProposal(pay("50", "USD"), "Pay Ana 50 USD", contacts)).toEqual({ ok: true });
    expect(groundProposal(pay("1200", "USD"), "please pay ana 1,200 usd for rent", contacts)).toEqual({ ok: true });
    expect(groundProposal(pay("50", "USD"), "Pay Ana $50.00", contacts)).toEqual({ ok: true });
    expect(groundProposal(pay("200", "CNY"), "send ana ¥200", contacts)).toEqual({ ok: true });
    expect(groundProposal({ kind: "save", amount: "200", currency: "CNY", reason: "t", sourceRefs: [] }, "move 200 CNY to savings", contacts)).toEqual({ ok: true });
  });

  it("rejects a currency the request never names", () => {
    expect(groundProposal(pay("50", "USD"), "Pay ana 50", contacts)).toMatchObject({ ok: false, reason: "currency USD is not written in the request" });
    expect(groundProposal(pay("10", "USD"), "Pay ana 10 bucks", contacts).ok).toBe(false);
    expect(groundProposal(pay("30", "USD"), "Pay cara 30 UDS", contacts).ok).toBe(false);
  });

  it("rejects amounts written in words or as an ambiguous decimal comma", () => {
    expect(groundProposal(pay("50", "USD"), "Pay ana fifty USD", contacts)).toMatchObject({ ok: false, reason: "amount 50 is not written in the request" });
    expect(groundProposal(pay("12.5", "USD", "cara"), "Pay cara 12,50 USD", contacts).ok).toBe(false);
  });

  it("rejects a look-alike or unknown recipient", () => {
    expect(groundProposal(pay("40", "USD"), "Pay аna 40 USD", contacts)).toMatchObject({ ok: false, reason: "contact ana is not written in the request" });
    expect(groundProposal(pay("40", "USD", "mallory"), "Pay mallory 40 USD", contacts)).toMatchObject({ ok: false, reason: "contact mallory is not a known contact" });
    expect(groundProposal(pay("40", "USD"), "Pay banana 40 USD", contacts).ok).toBe(false);
  });

  it("lets questions and cancellations through, since they carry no details", () => {
    expect(groundProposal({ kind: "answer_only", reason: "Which currency?", sourceRefs: [] }, "Pay ana 50", contacts)).toEqual({ ok: true });
  });
});
