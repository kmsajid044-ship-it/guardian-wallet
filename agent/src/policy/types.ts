import { isAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";

const AddressSchema = z.custom<Address>((value) => typeof value === "string" && isAddress(value, { strict: true }));
const IntentSchema = z.custom<Hex>((value) => typeof value === "string" && isHex(value) && value.length === 66);
const AmountSchema = z.bigint().nonnegative();

export const AgentActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pay"), currency: z.union([z.literal(0), z.literal(1)]), to: AddressSchema, amount: AmountSchema, intentId: IntentSchema }),
  z.object({ kind: z.literal("request_approval"), currency: z.union([z.literal(0), z.literal(1)]), to: AddressSchema, amount: AmountSchema, intentId: IntentSchema }),
  z.object({ kind: z.literal("save"), currency: z.union([z.literal(0), z.literal(1)]), amount: AmountSchema, intentId: IntentSchema }),
  z.object({ kind: z.literal("service_fee"), amount: AmountSchema, intentId: IntentSchema }),
]);

export type AgentAction = z.infer<typeof AgentActionSchema>;

export type Policy = {
  perTxLimit: bigint;
  dailyLimit: bigint;
  approvalThreshold: bigint;
  recipientCooldown: bigint;
  pendingExpiry: bigint;
  opsPerCallLimit: bigint;
  opsDailyLimit: bigint;
};

export type Recipient = { allowed: boolean; activeAfter: bigint; label: string };

export const policyReasons = [
  "PAUSED",
  "ZERO_AMOUNT",
  "DUPLICATE_INTENT",
  "RECIPIENT_NOT_ALLOWED",
  "RECIPIENT_NOT_ACTIVE",
  "OVER_PER_TX_LIMIT",
  "BELOW_APPROVAL_THRESHOLD",
  "OVER_DAILY_LIMIT",
  "INSUFFICIENT_BALANCE",
  "OVER_OPS_PER_CALL",
  "OVER_OPS_DAILY",
] as const;

export type PolicyReason = (typeof policyReasons)[number];
export type PolicyVerdict = { route: "EXECUTE" | "NEEDS_APPROVAL" } | { route: "BLOCKED"; reason: PolicyReason };
