import type { ActionProposal } from "./actionProposal.js";

/*
 * Grounding: every detail a model proposes must be written in the request itself. A model may not
 * fill in a missing currency, read an amount from words, normalise "12,50", or map a look-alike
 * name to a contact. Deterministic code checks this before the proposal reaches policy; a proposal
 * that fails is replaced by the deterministic parser's reading of the same request (which asks a
 * targeted question when the request is ambiguous). The contract still enforces everything after.
 */

export type Grounding = { ok: true } | { ok: false; reason: string };

/** Number tokens in the text: "1,200" is twelve hundred; "12,50" is not one number. */
function numbersIn(text: string): string[] {
  const tokens = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return tokens.flatMap((token) => /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token) ? [token.replaceAll(",", "")] : token.split(",").filter(Boolean));
}

/** "050.10" and "50.1" are the same decimal; anything that is not a plain decimal is not. */
function sameDecimal(left: string, right: string): boolean {
  const normalize = (value: string) => {
    if (!/^\d+(?:\.\d+)?$/.test(value)) return undefined;
    const [whole, fraction = ""] = value.split(".");
    return `${BigInt(whole!)}.${fraction.replace(/0+$/, "")}`;
  };
  const a = normalize(left); const b = normalize(right);
  return a !== undefined && a === b;
}

const CURRENCY_SYMBOLS: Record<string, string[]> = { USD: ["$"], CNY: ["¥", "￥"] };

export function groundProposal(proposal: ActionProposal, text: string, contactIds: readonly string[]): Grounding {
  if (proposal.kind === "answer_only" || proposal.kind === "cancel_recurring") return { ok: true };
  if (proposal.amount !== undefined && !numbersIn(text).some((token) => sameDecimal(token, proposal.amount!))) {
    return { ok: false, reason: `amount ${proposal.amount} is not written in the request` };
  }
  if (proposal.currency !== undefined) {
    const code = proposal.currency.toUpperCase();
    const written = new RegExp(`(^|[^A-Za-z])${code}([^A-Za-z]|$)`, "i").test(text) || (CURRENCY_SYMBOLS[code] ?? []).some((symbol) => text.includes(symbol));
    if (!written) return { ok: false, reason: `currency ${code} is not written in the request` };
  }
  if (proposal.recipientContactId !== undefined) {
    const id = proposal.recipientContactId.toLowerCase();
    if (!contactIds.includes(id)) return { ok: false, reason: `contact ${id} is not a known contact` };
    if (!new RegExp(`(^|[^A-Za-z0-9_-])${id}([^A-Za-z0-9_-]|$)`, "i").test(text)) return { ok: false, reason: `contact ${id} is not written in the request` };
  }
  return { ok: true };
}
