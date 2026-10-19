import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditLog, JsonValue } from "../audit/audit.js";
import { currencyCodes, disclaimerFor } from "../currency/registry.js";
import { ActionProposalSchema, type ActionProposal } from "../llm/actionProposal.js";
import { parseWithMock, type ApprovalCap, type Intake } from "../llm/mock.js";
import type { PipelineResult } from "../pipeline/pipeline.js";

export const PlanStepsSchema = z.array(ActionProposalSchema).min(1).max(20);
export type PlanStatus = "DRAFT" | "RUNNING" | "COMPLETED" | "STOPPED" | "WAITING_APPROVAL" | "CANCELLED";
/**
 * What the backend last established for a step. PLANNED: parsed only. VALIDATED: every check passed
 * without signing. The rest come from the real run: EXECUTED and PENDING_APPROVAL from the pipeline
 * route, BLOCKED from a refusal, FAILED when the run itself raised an error.
 */
export type PlanStepState = "PLANNED" | "VALIDATED" | "PENDING_APPROVAL" | "EXECUTED" | "BLOCKED" | "FAILED";
export type PlanStep = {
  id: string; index: number; proposal: ActionProposal;
  status: "READY" | "EXECUTED" | "STOPPED" | "NOT_RUN"; state: PlanStepState;
  /** Wallet contract function: from the proposal until the backend maps the action. */
  operation: NonNullable<PipelineResult["operation"]>;
  /** Validation-only result (nothing signed). */
  validation?: PipelineResult;
  result?: PipelineResult;
  error?: string;
  /** Required wording for CNY-denominated demo units. */
  disclaimer?: string;
};
export type PlanStage = "CHECK_BALANCE" | "CHECK_LIMITS" | "SAVE" | "PAY" | "REQUEST_APPROVAL" | "EXECUTE_AFTER_APPROVAL";
export type Plan = {
  id: string; status: PlanStatus; source: Intake["source"]; createdAt: string; updatedAt: string; preview: PlanStage[]; steps: PlanStep[]; stoppedAt?: number;
  /** The owner's original request; every step is screened together with it. */
  request: string;
  /** "Ask me before anything above N CUR": can only add approvals, never remove them. */
  approvalCap?: ApprovalCap;
};

export interface ActionRunner { run(intake: Intake): Promise<PipelineResult>; validate(intake: Intake): Promise<PipelineResult> }

const decimal = "([0-9][0-9,]*(?:\\.[0-9]{1,6})?)";

/** True when a chat message should become a visible multi-step plan rather than one action. */
export function looksLikePlan(message: string): boolean {
  return /[\s,;]then\s/i.test(message) || /^pay my [a-z][a-z0-9_-]* of .* but keep .* in savings$/i.test(message.trim());
}

export class PlanManager {
  private readonly plans = new Map<string, Plan>();

  constructor(private readonly runner: ActionRunner, private readonly audit: AuditLog) {}

  create(request: string, source: Intake["source"] = "trusted", sourceRefs: string[] = []): Plan {
    const cur = `(${currencyCodes().join("|")})`;
    const trimmed = request.trim().replace(/[\s.!]+$/, "");
    const capMatch = trimmed.match(new RegExp(`[\\s,;]+(?:and\\s+)?(?:ask|check\\s+with)\\s+me\\s+(?:first\\s+)?before\\s+(?:anything|any\\s+step|any\\s+action|any\\s+payment)\\s+(?:above|over|more\\s+than)\\s+${decimal}\\s+${cur}$`, "i"));
    const approvalCap = capMatch ? { currency: capMatch[2]!.toUpperCase(), amount: capMatch[1]!.replaceAll(",", "") } : undefined;
    const message = capMatch ? trimmed.slice(0, capMatch.index) : request;
    const tuition = message.match(new RegExp(`^pay my ([a-z][a-z0-9_-]*) of ([0-9][0-9,]*(?:\\.[0-9]{1,6})?) ${cur} this month but keep ([0-9][0-9,]*(?:\\.[0-9]{1,6})?) ${cur} in savings$`, "i"));
    if (tuition) {
      const currency = tuition[3]!.toUpperCase();
      return this.storeDraft([
        { kind: "save", currency: tuition[5]!.toUpperCase(), amount: tuition[4]!.replaceAll(",", ""), reason: "Keep the requested amount in savings", sourceRefs },
        { kind: "pay", currency, recipientContactId: tuition[1]!.toLowerCase(), amount: tuition[2]!.replaceAll(",", ""), reason: "Pay the requested monthly expense", sourceRefs },
      ], source, request, approvalCap);
    }
    const clauses = message.split(/[\s,;]+(?:and\s+)?then\s+/i).map((part) => part.trim()).filter(Boolean);
    if (clauses.length < 2) throw new Error("a multi-step plan requires at least two steps separated by ‘then’");
    const proposals = PlanStepsSchema.parse(clauses.map((clause) => parseWithMock({ message: clause, source, sourceRefs })));
    assertExecutableProposals(proposals);
    return this.storeDraft(proposals, source, request, approvalCap);
  }

  edit(id: string, proposals: ActionProposal[]): Plan {
    const plan = this.require(id);
    if (plan.status !== "DRAFT") throw new Error("only a draft plan can be edited");
    const parsed = PlanStepsSchema.parse(proposals);
    assertExecutableProposals(parsed);
    const now = new Date().toISOString();
    const updated: Plan = { ...plan, updatedAt: now, steps: parsed.map(plannedStep) };
    this.plans.set(id, updated);
    this.log("plan_edited", updated);
    return updated;
  }

  /** Checks every draft step without signing; a step passing every check becomes VALIDATED. */
  async validate(id: string): Promise<Plan> {
    const plan = this.require(id);
    if (plan.status !== "DRAFT") throw new Error("only a draft plan can be validated");
    for (const step of plan.steps) {
      try {
        const validation = await this.runner.validate(this.stepIntake(plan, step));
        step.validation = validation;
        if (validation.operation) step.operation = validation.operation;
        step.state = validation.route === "EXECUTED" || validation.route === "NEEDS_APPROVAL" ? "VALIDATED" : "PLANNED";
        delete step.error;
      } catch (error) {
        delete step.validation;
        step.state = "PLANNED";
        step.error = `validation failed: ${errorMessage(error)}`;
      }
    }
    plan.updatedAt = new Date().toISOString();
    this.log("plan_validated", plan);
    return plan;
  }

  async execute(id: string): Promise<Plan> {
    const existing = this.require(id);
    if (existing.status !== "DRAFT") throw new Error("plan has already started");
    const plan: Plan = { ...existing, status: "RUNNING", updatedAt: new Date().toISOString(), steps: existing.steps.map((step) => ({ ...step })) };
    this.plans.set(id, plan);
    for (const step of plan.steps) {
      let result: PipelineResult | undefined;
      try {
        result = await this.runner.run(this.stepIntake(plan, step));
      } catch (error) {
        step.state = "FAILED";
        step.error = errorMessage(error);
      }
      if (result) {
        step.result = result;
        delete step.error;
        if (result.operation) step.operation = result.operation;
        step.state = result.route === "EXECUTED" ? "EXECUTED" : result.route === "NEEDS_APPROVAL" ? "PENDING_APPROVAL" : "BLOCKED";
        if (result.route === "EXECUTED") {
          step.status = "EXECUTED";
          continue;
        }
      }
      step.status = "STOPPED";
      plan.stoppedAt = step.index;
      plan.status = step.state === "PENDING_APPROVAL" ? "WAITING_APPROVAL" : "STOPPED";
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

  private stepIntake(plan: Plan, step: PlanStep): Intake {
    // Steps keep the plan's source, so an untrusted plan cannot become trusted on execution.
    return {
      message: canonicalCommand(step.proposal), source: plan.source, sourceRefs: [`plan:${plan.id}:step:${step.index}`],
      plan: { request: plan.request, ...(plan.approvalCap ? { approvalCap: plan.approvalCap } : {}) },
    };
  }

  private storeDraft(proposals: ActionProposal[], source: Intake["source"], request: string, approvalCap: ApprovalCap | undefined): Plan {
    const timestamp = new Date().toISOString();
    const preview: PlanStage[] = ["CHECK_BALANCE", "CHECK_LIMITS"];
    for (const proposal of proposals) if (proposal.kind === "save") preview.push("SAVE");
    if (proposals.some((proposal) => proposal.kind === "pay")) preview.push("REQUEST_APPROVAL", "EXECUTE_AFTER_APPROVAL");
    const plan: Plan = {
      id: randomUUID(), status: "DRAFT", source, createdAt: timestamp, updatedAt: timestamp, preview, steps: proposals.map(plannedStep), request,
      ...(approvalCap ? { approvalCap } : {}),
    };
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

function plannedStep(proposal: ActionProposal, index: number): PlanStep {
  const disclaimer = proposal.currency ? disclaimerFor(proposal.currency) : undefined;
  return { id: `S${index + 1}`, index, proposal, status: "READY", state: "PLANNED", operation: proposal.kind === "save" ? "saveToSavings" : "pay", ...(disclaimer ? { disclaimer } : {}) };
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "unknown error"; }

function assertExecutableProposals(proposals: readonly ActionProposal[]): void {
  if (proposals.some((proposal) => proposal.kind === "answer_only" || proposal.kind === "schedule_recurring" || proposal.kind === "cancel_recurring")) {
    throw new Error("every plan step must be an unambiguous executable action");
  }
}
