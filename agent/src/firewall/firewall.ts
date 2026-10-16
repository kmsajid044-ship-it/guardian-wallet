import { isAddress, type Address } from "viem";
import type { ActionProposal } from "../llm/actionProposal.js";
import type { IntakeContext } from "../llm/mock.js";

export type FirewallFlag = "ADDRESS_INJECTION" | "INSTRUCTION_INJECTION" | "UNKNOWN_CONTACT" | "INVALID_AMOUNT" | "AMOUNT_OUTLIER" | "RECIPIENT_SWAP" | "POLICY_CHANGE_ATTEMPT";
export type FirewallResult = { blocked: boolean; flags: FirewallFlag[]; injectionPatternFound: boolean; amountOutlier: boolean };

const instructionPatterns = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions|rules)/i,
  /system\s+(?:message|prompt)/i,
  /act\s+as\s+(?:the\s+)?owner/i,
  /\b(?:i am|i'm|this is|from)\s+(?:the\s+)?owner\b/i,
  /override\s+(?:the\s+)?policy/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|system)/i,
  /developer\s+message/i,
  /send\s+(?:all|everything)/i,
  /urgent.*(?:bypass|override|ignore)/i,
];
const addressPattern = /0x[0-9a-fA-F]{40}/g;
const policyChangePattern = /\b(?:change|disable|ignore|override|raise|lower|remove|set)\b.{0,40}\b(?:policy|limit|allowlist|approval|guardian)\b/i;

export function inspectProposal(
  message: string,
  source: "trusted" | "untrusted",
  proposal: ActionProposal,
  contacts: Readonly<Record<string, Address>>,
  contactHistory: readonly bigint[] = [],
  context: IntakeContext = {},
): FirewallResult {
  const flags: FirewallFlag[] = [];
  const untrustedFields = [context.memo, context.payeeName, context.fetchedContent].filter((value): value is string => value !== undefined);
  const injectionPatternFound = (source === "untrusted" && instructionPatterns.some((pattern) => pattern.test(message)))
    || untrustedFields.some((value) => instructionPatterns.some((pattern) => pattern.test(value)));
  if (injectionPatternFound) flags.push("INSTRUCTION_INJECTION");
  const knownAddresses = new Set(Object.values(contacts).map((address) => address.toLowerCase()));
  const embeddedAddresses = [context.memo, context.payeeName].flatMap((value) => value?.match(addressPattern) ?? []);
  if ((source === "untrusted" && (message.match(addressPattern) ?? []).some((address) => isAddress(address)))
    || embeddedAddresses.some((address) => isAddress(address, { strict: false }) && !knownAddresses.has(address.toLowerCase()))) flags.push("ADDRESS_INJECTION");
  if (source === "untrusted" && /\b(?:new|unknown|unapproved)\s+(?:vendor|recipient|payee)\b/i.test(message)) flags.push("UNKNOWN_CONTACT");
  if ((proposal.kind === "pay" || proposal.kind === "schedule_recurring") && (!proposal.recipientContactId || !contacts[proposal.recipientContactId])) flags.push("UNKNOWN_CONTACT");
  if (context.expectedRecipientContactId && proposal.recipientContactId !== context.expectedRecipientContactId.toLowerCase()) flags.push("RECIPIENT_SWAP");
  if (policyChangePattern.test(message) || untrustedFields.some((value) => policyChangePattern.test(value))) flags.push("POLICY_CHANGE_ATTEMPT");
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
    blocked: flags.some((flag) => flag !== "AMOUNT_OUTLIER"),
    flags,
    injectionPatternFound,
    amountOutlier,
  };
}

function decimalToBaseUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
