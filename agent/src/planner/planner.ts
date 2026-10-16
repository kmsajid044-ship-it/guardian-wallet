import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditLog, JsonValue } from "../audit/audit.js";
import { currencyCodes } from "../currency/registry.js";
import { ActionProposalSchema, type ActionProposal } from "../llm/actionProposal.js";
import { parseWithMock, type Intake } from "../llm/mock.js";
import type { PipelineResult } from "../pipeline/pipeline.js";

export const PlanStepsSchema = z.array(ActionProposalSchema).min(1).max(20);
export type PlanStatus = "DRAFT" | "RUNNING" | "COMPLETED" | "STOPPED" | "WAITING_APPROVAL" | "CANCELLED";
export type PlanStep = { index: number; proposal: ActionProposal; status: "READY" | "EXECUTED" | "STOPPED" | "NOT_RUN"; result?: PipelineResult };
export type PlanStage = "CHECK_BALANCE" | "CHECK_LIMITS" | "SAVE" | "PAY" | "REQUEST_APPROVAL" | "EXECUTE_AFTER_APPROVAL";
export type Plan = { id: string; status: PlanStatus; source: Intake["source"]; createdAt: string; updatedAt: string; preview: PlanStage[]; steps: PlanStep[]; stoppedAt?: number };

export interface ActionRunner { run(intake: Intake): Promise<PipelineResult> }

export class PlanManager {
  private readonly plans = new Map<string, Plan>();

  constructor(private readonly runner: ActionRunner, private readonly audit: AuditLog) {}

  create(message: string, source: Intake["source"] = "trusted", sourceRefs: string[] = []): Plan {
    const cur = `(${currencyCodes().join("|")})`;
    const tuition = message.match(new RegExp(`^pay my ([a-z][a-z0-9_-]*) of ([0-9][0-9,]*(?:\\.[0-9]{1,6})?) ${cur} this month but keep ([0-9][0-9,]*(?:\\.[0-9]{1,6})?) ${cur} in savings$`, "i"));
    if (tuition) {
      const currency = tuition[3]!.toUpperCase();
      return this.storeDraft([
        { kind: "save", currency: tuition[5]!.toUpperCase(), amount: tuition[4]!.replaceAll(",", ""), reason: "Keep the requested amount in savings", sourceRefs },
        { kind: "pay", currency, recipientContactId: tuition[1]!.toLowerCase(), amount: tuition[2]!.replaceAll(",", ""), reason: "Pay the requested monthly expense", sourceRefs },
      ], source);
    }
    const clauses = message.split(/\s+(?:and\s+)?then\s+/i).map((part) => part.trim()).filter(Boolean);
    if (clauses.length < 2) throw new Error("a multi-step plan requires at least two steps separated by ‘then’");
    const proposals = PlanStepsSchema.parse(clauses.map((clause) => parseWithMock({ message: clause, source, sourceRefs })));
    assertExecutableProposals(proposals);
    return this.storeDraft(proposals, source);
  }

  edit(id: string, proposals: ActionProposal[]): Plan {
    const plan = this.require(id);
    if (plan.status !== "DRAFT") throw new Error("only a draft plan can be edited");
    const parsed = PlanStepsSchema.parse(proposals);
    assertExecutableProposals(parsed);
    const now = new Date().toISOString();
    const updated: Plan = { ...plan, updatedAt: now, steps: parsed.map((proposal, index) => ({ index, proposal, status: "READY" })) };
    this.plans.set(id, updated);
    this.log("plan_edited", updated);
    return updated;
  }

  async execute(id: string): Promise<Plan> {
    const existing = this.require(id);
    if (existing.status !== "DRAFT") throw new Error("plan has already started");
    const plan: Plan = { ...existing, status: "RUNNING", updatedAt: new Date().toISOString(), steps: existing.steps.map((step) => ({ ...step })) };
    this.plans.set(id, plan);
    for (const step of plan.steps) {
      // Steps keep the plan's source, so an untrusted plan cannot become trusted on execution.
      const result = await this.runner.run({ message: canonicalCommand(step.proposal), source: plan.source, sourceRefs: [`plan:${id}:step:${step.index}`] });
      step.result = result;
      if (result.route === "EXECUTED") {
        step.status = "EXECUTED";
        continue;
      }
      step.status = "STOPPED";
      plan.stoppedAt = step.index;
      plan.status = result.route === "NEEDS_APPROVAL" ? "WAITING_APPROVAL" : "STOPPED";
      for (const later of plan.steps.slice(step.index + 1)) later.status = "NOT_RUN";
      plan.updatedAt = new Date().toISOString();
      this.log("plan_stopped", plan);
      return plan;
    }
    plan.status = "COMPLETED";
    plan.updatedAt = new Date().toISOString();
    this.log("plan_completed", plan);
    return plan;
  }

  cancel(id: string): Plan {
    const plan = this.require(id);
    if (plan.status !== "DRAFT") throw new Error("only a draft plan can be cancelled");
    const cancelled: Plan = { ...plan, status: "CANCELLED", updatedAt: new Date().toISOString() };
    this.plans.set(id, cancelled);
    this.log("plan_cancelled", cancelled);
    return cancelled;
  }

  get(id: string): Plan { return this.require(id); }
  list(): Plan[] { return [...this.plans.values()]; }

  private storeDraft(proposals: ActionProposal[], source: Intake["source"]): Plan {
    const timestamp = new Date().toISOString();
    const preview: PlanStage[] = ["CHECK_BALANCE", "CHECK_LIMITS"];
    for (const proposal of proposals) if (proposal.kind === "save") preview.push("SAVE");
    if (proposals.some((proposal) => proposal.kind === "pay")) preview.push("REQUEST_APPROVAL", "EXECUTE_AFTER_APPROVAL");
    const plan: Plan = { id: randomUUID(), status: "DRAFT", source, createdAt: timestamp, updatedAt: timestamp, preview, steps: proposals.map((proposal, index) => ({ index, proposal, status: "READY" })) };
    this.plans.set(plan.id, plan);
    this.log("plan_created", plan);
    return plan;
  }

  private require(id: string): Plan {
    const plan = this.plans.get(id);
    if (!plan) throw new Error("plan not found");
    return plan;
  }

  private log(kind: string, plan: Plan): void {
    this.audit.append({ timestamp: new Date().toISOString(), kind, data: JSON.parse(JSON.stringify(plan)) as JsonValue });
  }
}

export function canonicalCommand(proposal: ActionProposal): string {
  if (proposal.kind === "pay") return `Pay ${proposal.recipientContactId ?? ""} ${proposal.amount ?? ""} ${proposal.currency ?? "USD"}`;
  if (proposal.kind === "save") return `Save ${proposal.amount ?? ""} ${proposal.currency ?? "USD"}`;
  throw new Error(`proposal kind ${proposal.kind} is not executable`);
}

function assertExecutableProposals(proposals: readonly ActionProposal[]): void {
  if (proposals.some((proposal) => proposal.kind === "answer_only" || proposal.kind === "schedule_recurring" || proposal.kind === "cancel_recurring")) {
    throw new Error("every plan step must be an unambiguous executable action");
  }
}
