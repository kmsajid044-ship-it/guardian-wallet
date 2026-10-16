import { isAddress, type Address } from "viem";
import type { ActionProposal } from "../llm/actionProposal.js";

export type FirewallFlag = "ADDRESS_INJECTION" | "INSTRUCTION_INJECTION" | "UNKNOWN_CONTACT" | "INVALID_AMOUNT" | "AMOUNT_OUTLIER";
export type FirewallResult = { blocked: boolean; flags: FirewallFlag[]; injectionPatternFound: boolean; amountOutlier: boolean };

const instructionPatterns = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
  /system\s+(?:message|prompt)/i,
  /act\s+as\s+(?:the\s+)?owner/i,
  /override\s+(?:the\s+)?policy/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|system)/i,
  /developer\s+message/i,
  /send\s+(?:all|everything)/i,
  /urgent.*(?:bypass|override|ignore)/i,
];
const addressPattern = /0x[0-9a-fA-F]{40}/g;

export function inspectProposal(
  message: string,
  source: "trusted" | "untrusted",
  proposal: ActionProposal,
  contacts: Readonly<Record<string, Address>>,
  contactHistory: readonly bigint[] = [],
): FirewallResult {
  const flags: FirewallFlag[] = [];
  const injectionPatternFound = source === "untrusted" && instructionPatterns.some((pattern) => pattern.test(message));
  if (injectionPatternFound) flags.push("INSTRUCTION_INJECTION");
  if (source === "untrusted" && (message.match(addressPattern) ?? []).some((address) => isAddress(address))) flags.push("ADDRESS_INJECTION");
  if (source === "untrusted" && /\b(?:new|unknown|unapproved)\s+(?:vendor|recipient|payee)\b/i.test(message)) flags.push("UNKNOWN_CONTACT");
  if ((proposal.kind === "pay" || proposal.kind === "schedule_recurring") && (!proposal.recipientContactId || !contacts[proposal.recipientContactId])) flags.push("UNKNOWN_CONTACT");
  if (proposal.amount !== undefined && !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(proposal.amount)) flags.push("INVALID_AMOUNT");
  let amountOutlier = false;
  if (proposal.amount !== undefined && contactHistory.length > 0 && !flags.includes("INVALID_AMOUNT")) {
    const sorted = [...contactHistory].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const amount = decimalToBaseUnits(proposal.amount);
    amountOutlier = amount > median * 2n;
    if (amountOutlier) flags.push("AMOUNT_OUTLIER");
  }
  return {
    blocked: flags.some((flag) => flag === "ADDRESS_INJECTION" || flag === "UNKNOWN_CONTACT" || flag === "INVALID_AMOUNT"),
    flags,
    injectionPatternFound,
    amountOutlier,
  };
}

function decimalToBaseUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
