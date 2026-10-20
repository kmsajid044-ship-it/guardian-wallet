import { randomUUID } from "node:crypto";
import { getAddress, keccak256, stringToHex, type Address, type Chain, type PublicClient, type Transport } from "viem";
import type { AuditLog, JsonValue } from "../audit/audit.js";
import { isCurrencyCode, toMinorUnits } from "../currency/registry.js";
import { createChainAdapter, type ChainAdapter } from "../chain/ChainAdapter.js";
import type { Config, Deployment } from "../config.js";
import { AgentExecutor } from "../exec/executor.js";
import { inspectProposal } from "../firewall/firewall.js";
import type { LlmAdapter, LlmProvider } from "../llm/adapter.js";
import type { ActionProposal } from "../llm/actionProposal.js";
import type { ApprovalCap, Intake } from "../llm/mock.js";
import { createLlmAdapter, liveAdapterLabel, MockAdapter, type ModelCallState } from "../llm/provider.js";
import { withHourlyCap } from "../llm/hourlyCap.js";
import { groundProposal } from "../llm/grounding.js";
import { precheckAction } from "../policy/precheck.js";
import type { PolicyReader } from "../policy/precheck.js";
import { tierGate, type PermissionTier } from "../policy/tierGate.js";
import type { AgentAction, PolicyVerdict } from "../policy/types.js";
import { scoreRisk } from "../risk/score.js";
import { RiskIntelClient, type PayeeRiskResult, type RiskIntelGateway } from "../riskIntel/client.js";
import { buildWhy, type WhyDecision } from "./why.js";

export type PipelineResult = {
  proposal: ActionProposal;
  route: "EXECUTED" | "NEEDS_APPROVAL" | "BLOCKED" | "ANSWER_ONLY" | "SCHEDULE_READY";
  explanation: string;
  /** `rejected`: why the model's proposal failed grounding and the deterministic parser was used. */
  llm: { requested: LlmProvider; effective: LlmProvider; fallback: boolean; rejected?: string };
  policy?: PolicyVerdict;
  risk?: ReturnType<typeof scoreRisk>;
  simulation?: { outcome: string; auxiliary: string };
  transactionHash?: string;
  pendingId?: string;
  flags?: string[];
  clarification?: { required: true; questions: string[] };
  riskIntel?: PayeeRiskResult;
  tier?: PermissionTier;
  blockNumber?: string;
  /** Explained decision for the owner console: real risk factors plus the layer that decided. */
  why?: WhyDecision;
  /** Wallet contract function the action maps to (pay, requestApproval, saveToSavings). */
  operation?: "pay" | "requestApproval" | "saveToSavings";
  /** Validation only: every check ran, nothing was signed or submitted, and `route` is the prediction. */
  dryRun?: true;
};

export const PLAN_APPROVAL_CAP_FLAG = "OWNER_PLAN_APPROVAL_CAP";
type RunContext = { adapter: LlmAdapter; fallback: boolean; dryRun: boolean; rejected?: string };

export const UNTRUSTED_APPROVAL_FLAG = "UNTRUSTED_SOURCE_REQUIRES_APPROVAL";

export class AgentPipeline {
  private readonly reader: PolicyReader;
  private readonly chainAdapter: ChainAdapter;
  private readonly executor: AgentExecutor;
  private readonly adapter: LlmAdapter;
  private readonly mockAdapter = new MockAdapter();
  /** What the last model call did, for an honest AI label in the console. */
  private modelState: ModelCallState = "unused";
  private readonly riskIntel: RiskIntelGateway | undefined;

  constructor(
    private readonly config: Config,
    private readonly deployment: Deployment,
    private readonly client: PublicClient<Transport, Chain>,
    private readonly audit: AuditLog,
    private readonly contacts: Readonly<Record<string, Address>>,
    environment: NodeJS.ProcessEnv,
    adapter?: LlmAdapter,
    riskIntel?: RiskIntelGateway,
  ) {
    this.chainAdapter = createChainAdapter(config, deployment);
    this.reader = this.chainAdapter.policyReader();
    this.executor = AgentExecutor.create(config, deployment, environment);
    this.adapter = adapter ?? withHourlyCap(createLlmAdapter(config.LLM_PROVIDER, environment), environment);
    this.riskIntel = riskIntel ?? (config.RISK_INTEL_URL
      ? new RiskIntelClient(config.RISK_INTEL_URL, config, deployment, client, this.executor, audit)
      : undefined);
  }

  async run(intake: Intake): Promise<PipelineResult> { return this.evaluate(intake, false); }

  /** What proposes actions right now, for the console: "GPT-OSS 120B via Groq" or "offline rules". */
  llmInfo(): { provider: LlmProvider; model: string | null; label: string; status: ModelCallState } {
    return { provider: this.adapter.provider, model: this.adapter.model ?? null, label: liveAdapterLabel(this.adapter, this.modelState), status: this.modelState };
  }

  /**
   * Runs firewall, policy pre-check, simulation, risk scoring, and the tier gate without signing or
   * submitting anything. Paid payee checks are left to the real run, so its result is authoritative.
   */
  async validate(intake: Intake): Promise<PipelineResult> { return this.evaluate(intake, true); }

  private async evaluate(intake: Intake, dryRun: boolean): Promise<PipelineResult> {
    const llm: RunContext = { adapter: this.adapter, fallback: this.adapter.provider !== this.config.LLM_PROVIDER, dryRun };
    let proposal: ActionProposal;
    try {
      proposal = await llm.adapter.propose(intake, Object.keys(this.contacts).sort());
      if (llm.adapter.provider !== "mock") this.modelState = "ok";
      assertProposalSemantics(proposal);
    } catch {
      if (llm.adapter.provider !== "mock" && llm.adapter === this.adapter) this.modelState = "failed";
      llm.adapter = this.mockAdapter;
      llm.fallback = true;
      proposal = await llm.adapter.propose(intake, Object.keys(this.contacts).sort());
      assertProposalSemantics(proposal);
    }
    if (llm.adapter.provider !== "mock") {
      // A model's details must be written in the request; otherwise the deterministic parser reads it.
      const rules = await this.mockAdapter.propose(intake);
      const grounding = groundProposal(proposal, intake.message, Object.keys(this.contacts));
      if (!grounding.ok) {
        llm.adapter = this.mockAdapter;
        llm.fallback = true;
        llm.rejected = grounding.reason;
        proposal = rules;
        assertProposalSemantics(proposal);
      } else if (proposal.kind === "answer_only" && rules.kind === "answer_only") {
        // Questions shown to the owner come from deterministic code, never from model text.
        proposal = { ...proposal, reason: rules.reason };
      }
    }
    const historyAddress = proposal.kind === "pay" && proposal.recipientContactId
      ? this.contacts[proposal.recipientContactId]
      : undefined;
    const proposalHistory = historyAddress ? this.paymentHistory(getAddress(historyAddress)) : [];
    // A plan step is screened together with the full request it came from.
    const screened = intake.plan ? `${intake.message}\n${intake.plan.request}` : intake.message;
    const firewall = inspectProposal(screened, intake.source, proposal, this.contacts, proposalHistory, intake.context);
    if (firewall.blocked) {
      return this.finish({
        proposal, route: "BLOCKED", tier: firewall.flags.includes("POLICY_CHANGE_ATTEMPT") ? "T3" : "T0", flags: firewall.flags,
        why: buildWhy({ decision: "BLOCKED", layer: "firewall", rule: firewall.flags.join(", "), detail: "The firewall refused the request before policy, simulation, or risk scoring ran." }),
      }, llm);
    }
    if (proposal.kind === "answer_only") {
      return this.finish({
        proposal, route: "ANSWER_ONLY", tier: "T0", clarification: { required: true, questions: [proposal.reason] },
        why: buildWhy({ decision: "ANSWER_ONLY", layer: "pipeline", rule: "CLARIFICATION_REQUIRED", detail: "The request was missing a required detail, so the agent asked a targeted question instead of acting." }),
      }, llm);
    }
    const untrusted = intake.source === "untrusted";
    if (proposal.kind === "schedule_recurring") {
      // Scheduled runs are trusted, so an untrusted request must not create the schedule itself.
      if (untrusted) return this.finish({
        proposal, route: "NEEDS_APPROVAL", tier: "T2", flags: [UNTRUSTED_APPROVAL_FLAG],
        why: buildWhy({ decision: "NEEDS_APPROVAL", layer: "tier gate", rule: UNTRUSTED_APPROVAL_FLAG, detail: "An untrusted request never creates a recurring schedule; only the owner can approve it." }),
      }, llm);
      return this.finish({
        proposal, route: "SCHEDULE_READY", tier: "T1",
        why: buildWhy({ decision: "SCHEDULE_READY", layer: "pipeline", rule: "RECURRING_VALIDATED", detail: "The recurring request is trusted and complete; every run re-enters the full pipeline." }),
      }, llm);
    }
    if (proposal.kind === "cancel_recurring") {
      return this.finish({
        proposal, route: "ANSWER_ONLY", tier: "T0", clarification: { required: true, questions: ["Which recurring payment ID should I cancel?"] },
        why: buildWhy({ decision: "ANSWER_ONLY", layer: "pipeline", rule: "CLARIFICATION_REQUIRED", detail: "The agent needs the recurring payment ID before it can cancel anything." }),
      }, llm);
    }

    const chainPolicy = await this.reader.getPolicy();
    const action = this.toAction(proposal, chainPolicy.approvalThreshold);
    const operation = operationOf(action);
    if (action.kind === "pay" || action.kind === "request_approval") {
      const recipient = await this.reader.getRecipient(action.to);
      if (!recipient.allowed) {
        return this.finish({
          proposal, operation, route: "BLOCKED", tier: "T1", flags: ["UNKNOWN_CONTACT"],
          why: buildWhy({ decision: "BLOCKED", layer: "contract", rule: "RECIPIENT_NOT_ALLOWED", detail: "The contact is not on the owner's allowlist, so the wallet contract would refuse this recipient." }),
        }, llm);
      }
    }
    const policy = await precheckAction(this.reader, action);
    const simulation = simulationResult(await this.chainAdapter.simulateAgentTx(action, getAddress(this.deployment.agent)));
    if (policy.route === "BLOCKED") {
      if (simulation.outcome !== "BLOCKED") throw new Error("policy and contract simulation disagree");
      const why = buildWhy({ decision: "BLOCKED", layer: "contract", rule: policy.reason, detail: `Contract policy refused the action with ${policy.reason}; the refusal is recorded on chain.` });
      // Validation predicts the refusal; only the real run records it on chain.
      if (dryRun) return this.finish({ ...commonWithoutRisk(proposal, policy, simulation), operation, route: "BLOCKED", tier: "T1", flags: [policy.reason], why }, llm);
      const evidence = await this.executor.submit(action, { policy, simulation });
      return this.finish({
        ...commonWithoutRisk(proposal, policy, simulation), operation, route: "BLOCKED", tier: "T1", flags: [policy.reason], transactionHash: evidence.transactionHash, blockNumber: evidence.blockNumber.toString(),
        why,
      }, llm, { action, amount: action.amount.toString() });
    }
    const amount = action.amount;
    const spent = await this.reader.getSpentToday();
    const history = action.kind === "pay" || action.kind === "request_approval" ? proposalHistory : [];
    let riskIntelResult: PayeeRiskResult | undefined;
    if (!dryRun && (action.kind === "pay" || action.kind === "request_approval") && this.riskIntel && (history.length === 0 || action.amount >= chainPolicy.approvalThreshold)) {
      try {
        riskIntelResult = await this.riskIntel.checkPayee(action.to);
        const fetchedFirewall = inspectProposal(intake.message, intake.source, proposal, this.contacts, history, { ...intake.context, fetchedContent: JSON.stringify(riskIntelResult) });
        if (fetchedFirewall.blocked) return this.finish({
          ...commonWithoutRisk(proposal, policy, simulation), operation, route: "BLOCKED", tier: "T0", flags: fetchedFirewall.flags,
          why: buildWhy({ decision: "BLOCKED", layer: "firewall", rule: fetchedFirewall.flags.join(", "), detail: "The firewall refused content fetched for this action before risk scoring ran." }),
        }, llm);
      } catch {
        return this.finish({
          ...commonWithoutRisk(proposal, policy, simulation), operation, route: "BLOCKED", flags: ["RISK_INTEL_UNAVAILABLE"],
          why: buildWhy({ decision: "BLOCKED", layer: "risk engine", rule: "RISK_INTEL_UNAVAILABLE", detail: "The payee risk check could not complete, so the action failed closed." }),
        }, llm);
      }
    }
    const risk = scoreRisk({
      untrusted,
      injectionPatternFound: firewall.injectionPatternFound,
      contactHistory: history,
      remainingDaily: chainPolicy.dailyLimit > spent ? chainPolicy.dailyLimit - spent : 0n,
      outsideUsualHours: outsideActiveHours(new Date(), this.config.OWNER_TIMEZONE, this.config.OWNER_ACTIVE_HOURS),
      recentPaymentCount: this.recentPaymentCount(),
      ...(action.kind === "pay" || action.kind === "request_approval" ? { amount } : {}),
      ...(riskIntelResult ? { riskIntel: { score: riskIntelResult.score, sanctioned: riskIntelResult.sanctioned } } : {}),
    });

    const common = {
      proposal,
      operation,
      policy,
      risk,
      simulation: { outcome: simulation.outcome, auxiliary: simulation.auxiliary.toString() },
      ...(riskIntelResult ? { riskIntel: riskIntelResult } : {}),
    };
    const tier = tierGate({ operation: "agent", policyRoute: policy.route, riskRoute: risk.route, untrustedSource: untrusted });
    if (simulation.outcome === "BLOCKED") return this.finish({
      ...common, route: "BLOCKED", tier: tier.tier, flags: ["contract simulation"],
      why: buildWhy({ decision: "BLOCKED", risk, layer: "contract", rule: "SIMULATION_BLOCKED", detail: "Contract simulation returned a refusal, so nothing was signed." }),
    }, llm);
    if (!tier.allowed) return this.finish({
      ...common, route: "BLOCKED", tier: tier.tier, flags: [tier.reason],
      why: buildWhy({ decision: "BLOCKED", risk, layer: "risk engine", rule: "RISK_SCORE_AT_LEAST_85", detail: tier.reason }),
    }, llm);
    // A T2 action the contract would execute directly is held off-chain for the owner; nothing is signed.
    if (tier.tier === "T2" && policy.route === "EXECUTE") {
      return this.finish({
        ...common, route: "NEEDS_APPROVAL", tier: tier.tier, ...(untrusted ? { flags: [UNTRUSTED_APPROVAL_FLAG] } : {}),
        why: buildWhy({
          decision: "NEEDS_APPROVAL", risk, layer: untrusted ? "tier gate" : "risk engine",
          rule: untrusted ? UNTRUSTED_APPROVAL_FLAG : "RISK_SCORE_60_TO_84", detail: tier.reason,
        }),
      }, llm);
    }

    // The owner's plan cap can only add an approval: an action the contract would execute directly
    // is held off-chain when its nominal amount is above the cap. Nothing is signed.
    if (policy.route === "EXECUTE" && action.kind !== "service_fee" && intake.plan?.approvalCap && aboveCap(action.currency, action.amount, intake.plan.approvalCap)) {
      const cap = intake.plan.approvalCap;
      return this.finish({
        ...common, route: "NEEDS_APPROVAL", tier: "T2", flags: [PLAN_APPROVAL_CAP_FLAG],
        why: buildWhy({
          decision: "NEEDS_APPROVAL", risk, layer: "tier gate", rule: PLAN_APPROVAL_CAP_FLAG,
          detail: `The owner asked to approve anything above ${cap.amount} ${cap.currency}; amounts are compared in demo units without FX, so the cap can only add approvals.`,
        }),
      }, llm);
    }

    const decision = policy.route === "NEEDS_APPROVAL" ? "NEEDS_APPROVAL" : "EXECUTED";
    const why = policy.route === "NEEDS_APPROVAL"
      ? buildWhy({
          decision, risk, layer: "contract", rule: "APPROVAL_THRESHOLD",
          detail: risk.route === "FORCE_APPROVAL"
            ? "The amount is at or above the owner's approval threshold, and the risk score agrees; the contract created a pending item only the owner can approve."
            : "The amount is at or above the owner's approval threshold, so the contract created a pending item only the owner can approve.",
        })
      : buildWhy({ decision, risk, layer: "tier gate", rule: "WITHIN_POLICY_AND_RISK_LIMITS", detail: "Policy, simulation, risk, and tier checks all passed." });
    if (dryRun) return this.finish({ ...common, route: decision, tier: tier.tier, why }, llm);
    const execution = await this.executor.submit(action, { policy, simulation });
    const pendingId = policy.route === "NEEDS_APPROVAL" ? simulation.auxiliary.toString() : undefined;
    return this.finish({
      ...common,
      route: decision,
      tier: tier.tier,
      why,
      transactionHash: execution.transactionHash,
      blockNumber: execution.blockNumber.toString(),
      ...(pendingId === undefined ? {} : { pendingId }),
    }, llm, { action, amount: amount.toString(), transactionHash: execution.transactionHash });
  }

  private toAction(proposal: ActionProposal, approvalThreshold: bigint): AgentAction {
    if (!proposal.amount) throw new Error("proposal amount is required");
    const intentId = keccak256(stringToHex(randomUUID()));
    const currency = proposal.currency ?? "USD";
    const amount = toMinorUnits(currency, proposal.amount);
    if (proposal.kind === "pay") {
      if (!proposal.recipientContactId) throw new Error("recipient contact is required");
      const to = this.contacts[proposal.recipientContactId];
      if (!to) throw new Error("contact was not resolved");
      return { kind: amount >= approvalThreshold ? "request_approval" : "pay", currency, to: getAddress(to), amount, intentId };
    }
    if (proposal.kind === "save") return { kind: "save", currency, amount, intentId };
    throw new Error(`proposal kind ${proposal.kind} cannot become an agent action`);
  }

  private paymentHistory(recipient: Address): bigint[] {
    return this.audit.list().flatMap((entry) => {
      if (entry.kind !== "pipeline_result" || typeof entry.data !== "object" || entry.data === null || Array.isArray(entry.data)) return [];
      const action = entry.data.action;
      if (typeof action !== "object" || action === null || Array.isArray(action)) return [];
      return (action.kind === "pay" || action.kind === "request_approval") && action.to === recipient && typeof entry.data.amount === "string" ? [BigInt(entry.data.amount)] : [];
    });
  }

  private recentPaymentCount(): number {
    const cutoff = Date.now() - 60 * 60 * 1_000;
    return this.audit.list().filter((entry) => {
      if (entry.kind !== "pipeline_result" || Date.parse(entry.timestamp) < cutoff || typeof entry.data !== "object" || entry.data === null || Array.isArray(entry.data) || entry.data.route !== "EXECUTED") return false;
      const action = entry.data.action;
      return typeof action === "object" && action !== null && !Array.isArray(action) && (action.kind === "pay" || action.kind === "request_approval");
    }).length;
  }

  private async finish(
    structured: Omit<PipelineResult, "explanation" | "llm">,
    llm: RunContext,
    executionData: Record<string, JsonValue> = {},
  ): Promise<PipelineResult> {
    const structuredResult = JSON.parse(JSON.stringify(structured)) as JsonValue;
    let explanation: string;
    if (llm.dryRun) {
      // Deterministic text; the prediction is never logged as a decision the agent took.
      const result: PipelineResult = {
        ...structured, dryRun: true,
        explanation: `Validation only, nothing was signed: the checks predict ${structured.route.replaceAll("_", " ").toLowerCase()}.`,
        llm: { requested: this.config.LLM_PROVIDER, effective: llm.adapter.provider, fallback: llm.fallback, ...(llm.rejected ? { rejected: llm.rejected } : {}) },
      };
      this.audit.append({ timestamp: new Date().toISOString(), kind: "plan_step_validated", data: JSON.parse(JSON.stringify(result)) as JsonValue });
      return result;
    }
    try {
      explanation = await llm.adapter.explain({ route: structured.route, structuredResult });
      if (llm.adapter.provider !== "mock") this.modelState = "ok";
    } catch {
      if (llm.adapter.provider !== "mock") this.modelState = "failed";
      llm.adapter = this.mockAdapter;
      llm.fallback = true;
      explanation = await this.mockAdapter.explain({ route: structured.route, structuredResult });
    }
    const result: PipelineResult = {
      ...structured,
      explanation,
      llm: { requested: this.config.LLM_PROVIDER, effective: llm.adapter.provider, fallback: llm.fallback, ...(llm.rejected ? { rejected: llm.rejected } : {}) },
    };
    const serializable = JSON.parse(JSON.stringify(result)) as JsonValue;
    const decision = {
      outcome: result.route,
      reason: decisionReason(result),
      tier: result.tier ?? "T0",
      riskFactors: result.risk?.factors ?? [],
      why: result.why ?? null,
      transactionHash: result.transactionHash ?? null,
      blockNumber: result.blockNumber ?? null,
    };
    this.audit.append({
      timestamp: new Date().toISOString(),
      kind: "pipeline_result",
      data: typeof serializable === "object" && serializable !== null && !Array.isArray(serializable)
        ? { ...serializable, ...executionData, decision }
        : executionData,
    });
    return result;
  }
}

function operationOf(action: AgentAction): NonNullable<PipelineResult["operation"]> {
  if (action.kind === "pay") return "pay";
  if (action.kind === "request_approval") return "requestApproval";
  if (action.kind === "save") return "saveToSavings";
  throw new Error(`action ${action.kind} is not available to the agent pipeline`);
}

/** Nominal comparison in the action's own demo units, as the wallet contract compares its limits. */
export function aboveCap(currency: string, amount: bigint, cap: ApprovalCap): boolean {
  return amount > toMinorUnits(currency, cap.amount);
}

function commonWithoutRisk(proposal: ActionProposal, policy: PolicyVerdict, simulation: { outcome: string; auxiliary: bigint }) {
  return { proposal, policy, simulation: { outcome: simulation.outcome, auxiliary: simulation.auxiliary.toString() } };
}

function simulationResult(result: { outcome: 0 | 1 | 2; auxiliary: bigint }): { outcome: "EXECUTED" | "PENDING" | "BLOCKED"; auxiliary: bigint } {
  return { outcome: result.outcome === 0 ? "EXECUTED" : result.outcome === 1 ? "PENDING" : "BLOCKED", auxiliary: result.auxiliary };
}

function decisionReason(result: PipelineResult): string {
  if (result.flags?.length) return result.flags.join(", ");
  if (result.policy?.route === "NEEDS_APPROVAL") return "Contract policy requires owner approval";
  if (result.risk?.route === "FORCE_APPROVAL") return "Risk score requires owner approval";
  if (result.route === "EXECUTED") return "Policy, simulation, risk, and tier checks passed";
  if (result.route === "ANSWER_ONLY") return result.clarification?.questions.join(" ") ?? "No action was executed";
  if (result.route === "SCHEDULE_READY") return "Recurring action validated for scheduling";
  return "Action was blocked by the pipeline";
}

function outsideActiveHours(now: Date, timezone: string, range: string): boolean {
  const [startText, endText] = range.split("-");
  const start = Number(startText);
  const end = Number(endText);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  return end === 24 ? hour < start : hour < start || hour >= end;
}

function assertProposalSemantics(proposal: ActionProposal): void {
  if (proposal.currency !== undefined && !isCurrencyCode(proposal.currency)) {
    throw new Error(`currency ${proposal.currency} is not a configured demo unit`);
  }
  if (proposal.kind === "pay" && (!proposal.currency || !proposal.recipientContactId || !proposal.amount)) {
    throw new Error("payment proposal is missing currency, recipientContactId, or amount");
  }
  if (proposal.kind === "save" && (!proposal.currency || !proposal.amount)) {
    throw new Error("savings proposal is missing currency or amount");
  }
  if (proposal.kind === "schedule_recurring" && (!proposal.currency || !proposal.recipientContactId || !proposal.amount)) {
    throw new Error("recurring proposal is missing currency, recipientContactId, or amount");
  }
}
