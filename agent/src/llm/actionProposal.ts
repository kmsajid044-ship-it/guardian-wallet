import { z } from "zod";

export const ActionProposalSchema = z.object({
  kind: z.enum(["pay", "save", "schedule_recurring", "cancel_recurring", "answer_only"]),
  /** ISO 4217 code; must also be a configured currency (checked in the pipeline). */
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  recipientContactId: z.string().optional(),
  amount: z.string().optional(),
  reason: z.string(),
  sourceRefs: z.array(z.string()),
}).strict();

export type ActionProposal = z.infer<typeof ActionProposalSchema>;
