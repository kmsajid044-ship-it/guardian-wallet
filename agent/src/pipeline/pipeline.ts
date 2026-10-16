import { randomUUID } from "node:crypto";
import { getAddress, keccak256, parseUnits, stringToHex, type Address, type Chain, type PublicClient, type Transport } from "viem";
import type { AuditLog, JsonValue } from "../audit/audit.js";
import { GuardianReader } from "../chain/reader.js";
import type { Config, Deployment } from "../config.js";
import { AgentExecutor } from "../exec/executor.js";
import { inspectProposal } from "../firewall/firewall.js";
import type { LlmAdapter, LlmProvider } from "../llm/adapter.js";
import type { ActionProposal } from "../llm/actionProposal.js";
import type { Intake } from "../llm/mock.js";
import { createLlmAdapter, MockAdapter } from "../llm/provider.js";
import { precheckAction } from "../policy/precheck.js";
import type { AgentAction, PolicyVerdict } from "../policy/types.js";
import { scoreRisk } from "../risk/score.js";
import { RiskIntelClient, type PayeeRiskResult, type RiskIntelGateway } from "../riskIntel/client.js";
import { simulateAgentAction } from "../sim/simulate.js";

export type PipelineResult = {
  proposal: ActionProposal;
  route: "EXECUTED" | "NEEDS_APPROVAL" | "BLOCKED" | "ANSWER_ONLY" | "SCHEDULE_READY";
  explanation: string;
  llm: { requested: LlmProvider; effective: LlmProvider; fallback: boolean };
  policy?: PolicyVerdict;
  risk?: ReturnType<typeof scoreRisk>;
  simulation?: { outcome: string; auxiliary: string };
  transactionHash?: string;
  pendingId?: string;
  flags?: string[];
  clarification?: { required: true; questions: string[] };
  riskIntel?: PayeeRiskResult;
};

export class AgentPipeline {
  private readonly reader: GuardianReader;
  private readonly executor: AgentExecutor;
  private readonly adapter: LlmAdapter;
  private readonly mockAdapter = new MockAdapter();
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
    this.reader = new GuardianReader(client, getAddress(deployment.guardianWallet), getAddress(deployment.demoLedger));
    this.executor = AgentExecutor.create(config, deployment, environment);
    this.adapter = adapter ?? createLlmAdapter(config.LLM_PROVIDER, environment);
    this.riskIntel = riskIntel ?? (config.RISK_INTEL_URL
      ? new RiskIntelClient(config.RISK_INTEL_URL, config, deployment, client, this.executor, audit)
      : undefined);
  }

  async run(intake: Intake): Promise<PipelineResult> {
    const llm = { adapter: this.adapter, fallback: this.adapter.provider !== this.config.LLM_PROVIDER };
    let proposal: ActionProposal;
    try {
      proposal = await llm.adapter.propose(intake, Object.keys(this.contacts).sort());
      assertProposalSemantics(proposal);
    } catch {
      llm.adapter = this.mockAdapter;
      llm.fallback = true;
      proposal = await llm.adapter.propose(intake, Object.keys(this.contacts).sort());
      assertProposalSemantics(proposal);
    }
    const historyAddress = proposal.kind === "pay" && proposal.recipientContactId
      ? this.contacts[proposal.recipientContactId]
      : undefined;
    const proposalHistory = historyAddress ? this.paymentHistory(getAddress(historyAddress)) : [];
    const firewall = inspectProposal(intake.message, intake.source, proposal, this.contacts, proposalHistory);
    if (firewall.blocked) {
      return this.finish({ proposal, route: "BLOCKED", flags: firewall.flags }, llm);
    }
    if (proposal.kind === "answer_only") {
      return this.finish({ proposal, route: "ANSWER_ONLY", clarification: { required: true, questions: [proposal.reason] } }, llm);
    }
    if (proposal.kind === "schedule_recurring") {
      return this.finish({ proposal, route: "SCHEDULE_READY" }, llm);
    }
    if (proposal.kind === "cancel_recurring") {
      return this.finish({ proposal, route: "ANSWER_ONLY", clarification: { required: true, questions: ["Which recurring payment ID should I cancel?"] } }, llm);
    }

    const chainPolicy = await this.reader.getPolicy();
    const action = this.toAction(proposal, chainPolicy.approvalThreshold);
    if (action.kind === "pay" || action.kind === "request_approval") {
      const recipient = await this.reader.getRecipient(action.to);
      if (!recipient.allowed) {
        return this.finish({ proposal, route: "BLOCKED", flags: ["UNKNOWN_CONTACT"] }, llm);
      }
    }
    const policy = await precheckAction(this.reader, action);
    const simulation = await simulateAgentAction(this.client, getAddress(this.deployment.guardianWallet), getAddress(this.deployment.agent), action);
    if (policy.route === "BLOCKED") {
      if (simulation.outcome !== "BLOCKED") throw new Error("policy and contract simulation disagree");
      const evidence = await this.executor.submit(action, { policy, simulation });
      return this.finish({ ...commonWithoutRisk(proposal, policy, simulation), route: "BLOCKED", flags: [policy.reason], transactionHash: evidence.transactionHash }, llm, { action, amount: action.amount.toString(), transactionHash: evidence.transactionHash });
    }
    const amount = action.amount;
    const spent = await this.reader.getSpentToday();
    const history = action.kind === "pay" || action.kind === "request_approval" ? proposalHistory : [];
    let riskIntelResult: PayeeRiskResult | undefined;
    if ((action.kind === "pay" || action.kind === "request_approval") && this.riskIntel && (history.length === 0 || action.amount >= chainPolicy.approvalThreshold)) {
      try {
        riskIntelResult = await this.riskIntel.checkPayee(action.to);
      } catch {
        return this.finish({ ...commonWithoutRisk(proposal, policy, simulation), route: "BLOCKED", flags: ["RISK_INTEL_UNAVAILABLE"] }, llm);
      }
    }
    const risk = scoreRisk({
      untrusted: intake.source === "untrusted",
      injectionPatternFound: firewall.injectionPatternFound,
      contactHistory: history,
      remainingDaily: chainPolicy.dailyLimit > spent ? chainPolicy.dailyLimit - spent : 0n,
      outsideUsualHours: outsideActiveHours(new Date(), this.config.OWNER_TIMEZONE, this.config.OWNER_ACTIVE_HOURS),
      ...(action.kind === "pay" || action.kind === "request_approval" ? { amount } : {}),
      ...(riskIntelResult ? { riskIntel: { score: riskIntelResult.score, sanctioned: riskIntelResult.sanctioned } } : {}),
    });

    const common = {
      proposal,
      policy,
      risk,
      simulation: { outcome: simulation.outcome, auxiliary: simulation.auxiliary.toString() },
      ...(riskIntelResult ? { riskIntel: riskIntelResult } : {}),
    };
    if (simulation.outcome === "BLOCKED") return this.finish({ ...common, route: "BLOCKED", flags: ["contract simulation"] }, llm);
    if (risk.route === "BLOCK") return this.finish({ ...common, route: "BLOCKED" }, llm);
    if (risk.route === "FORCE_APPROVAL" && policy.route === "EXECUTE") {
      return this.finish({ ...common, route: "NEEDS_APPROVAL" }, llm);
    }

    const execution = await this.executor.submit(action, { policy, simulation });
    const pendingId = policy.route === "NEEDS_APPROVAL" ? simulation.auxiliary.toString() : undefined;
    return this.finish({
      ...common,
      route: policy.route === "NEEDS_APPROVAL" ? "NEEDS_APPROVAL" : "EXECUTED",
      transactionHash: execution.transactionHash,
      ...(pendingId === undefined ? {} : { pendingId }),
    }, llm, { action, amount: amount.toString(), transactionHash: execution.transactionHash });
  }

  private toAction(proposal: ActionProposal, approvalThreshold: bigint): AgentAction {
    if (!proposal.amount) throw new Error("proposal amount is required");
    const intentId = keccak256(stringToHex(randomUUID()));
    const amount = parseUnits(proposal.amount, 6);
    const currency = proposal.currency === "BDT" ? 1 as const : 0 as const;
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

  private async finish(
    structured: Omit<PipelineResult, "explanation" | "llm">,
    llm: { adapter: LlmAdapter; fallback: boolean },
    executionData: Record<string, JsonValue> = {},
  ): Promise<PipelineResult> {
    const structuredResult = JSON.parse(JSON.stringify(structured)) as JsonValue;
    let explanation: string;
    try {
      explanation = await llm.adapter.explain({ route: structured.route, structuredResult });
    } catch {
      llm.adapter = this.mockAdapter;
      llm.fallback = true;
      explanation = await this.mockAdapter.explain({ route: structured.route, structuredResult });
    }
    const result: PipelineResult = {
      ...structured,
      explanation,
      llm: { requested: this.config.LLM_PROVIDER, effective: llm.adapter.provider, fallback: llm.fallback },
    };
    const serializable = JSON.parse(JSON.stringify(result)) as JsonValue;
    this.audit.append({
      timestamp: new Date().toISOString(),
      kind: "pipeline_result",
      data: typeof serializable === "object" && serializable !== null && !Array.isArray(serializable)
        ? { ...serializable, ...executionData }
        : executionData,
    });
    return result;
  }
}

function commonWithoutRisk(proposal: ActionProposal, policy: PolicyVerdict, simulation: { outcome: string; auxiliary: bigint }) {
  return { proposal, policy, simulation: { outcome: simulation.outcome, auxiliary: simulation.auxiliary.toString() } };
}

function outsideActiveHours(now: Date, timezone: string, range: string): boolean {
  const [startText, endText] = range.split("-");
  const start = Number(startText);
  const end = Number(endText);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  return end === 24 ? hour < start : hour < start || hour >= end;
}

function assertProposalSemantics(proposal: ActionProposal): void {
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
