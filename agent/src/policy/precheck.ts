import type { Address, Hex } from "viem";
import { AgentActionSchema, type AgentAction, type Policy, type PolicyVerdict, type Recipient } from "./types.js";

export interface PolicyReader {
  isPaused(): Promise<boolean>; isIntentUsed(intentId: Hex): Promise<boolean>; getPolicy(): Promise<Policy>;
  getRecipient(recipient: Address): Promise<Recipient>; getTimestamp(): Promise<bigint>; getSpentToday(): Promise<bigint>;
  getOpsSpentToday(): Promise<bigint>; getBalance(currency: 0 | 1): Promise<bigint>; getFeeAccount(): Promise<Address>;
}
const blocked = (reason: Extract<PolicyVerdict, { route: "BLOCKED" }>["reason"]): PolicyVerdict => ({ route: "BLOCKED", reason });
export async function precheckAction(source: PolicyReader, raw: AgentAction): Promise<PolicyVerdict> {
  const action = AgentActionSchema.parse(raw);
  if (await source.isPaused()) return blocked("PAUSED");
  if (action.amount === 0n) return blocked("ZERO_AMOUNT");
  if (await source.isIntentUsed(action.intentId)) return blocked("DUPLICATE_INTENT");
  const policy = await source.getPolicy();
  if (action.kind === "pay" || action.kind === "request_approval") {
    const recipient = await source.getRecipient(action.to);
    if (!recipient.allowed) return blocked("RECIPIENT_NOT_ALLOWED");
    if ((await source.getTimestamp()) < recipient.activeAfter) return blocked("RECIPIENT_NOT_ACTIVE");
    if (action.amount > policy.perTxLimit) return blocked("OVER_PER_TX_LIMIT");
    if (action.kind === "pay" && action.amount >= policy.approvalThreshold) return blocked("BELOW_APPROVAL_THRESHOLD");
    if (action.kind === "request_approval" && action.amount < policy.approvalThreshold) return blocked("BELOW_APPROVAL_THRESHOLD");
    if (action.kind === "request_approval") return { route: "NEEDS_APPROVAL" };
    if ((await source.getSpentToday()) + action.amount > policy.dailyLimit) return blocked("OVER_DAILY_LIMIT");
    if ((await source.getBalance(action.currency)) < action.amount) return blocked("INSUFFICIENT_BALANCE");
    return { route: "EXECUTE" };
  }
  if (action.kind === "service_fee") {
    if (action.amount > policy.opsPerCallLimit) return blocked("OVER_OPS_PER_CALL");
    if ((await source.getOpsSpentToday()) + action.amount > policy.opsDailyLimit) return blocked("OVER_OPS_DAILY");
    if ((await source.getBalance(0)) < action.amount) return blocked("INSUFFICIENT_BALANCE");
    return { route: "EXECUTE" };
  }
  if ((await source.getBalance(action.currency)) < action.amount) return blocked("INSUFFICIENT_BALANCE");
  return { route: "EXECUTE" };
}
