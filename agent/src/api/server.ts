import { dirname, resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { getAddress, isAddress, parseUnits, type Hex } from "viem";
import { AuditLog } from "../audit/audit.js";
import { createChainClients } from "../chain/client.js";
import { ChainStateReader } from "../chain/state.js";
import { createChainAdapter } from "../chain/ChainAdapter.js";
import { loadDeployment, resolveRepoPath, type Config, type Deployment } from "../config.js";
import { AgentPipeline } from "../pipeline/pipeline.js";
import { pendingExplanations, pendingReasoning } from "../pipeline/why.js";
import { OwnerExecutor } from "../exec/ownerExecutor.js";
import type { LlmAdapter } from "../llm/adapter.js";
import { looksLikePlan, PlanManager, PlanStepsSchema, type Plan } from "../planner/planner.js";
import { RecurringScheduler } from "../scheduler/scheduler.js";
import type { RiskIntelGateway } from "../riskIntel/client.js";
import { AttackLab } from "../attack/attackLab.js";
import { attackIds, type AttackId } from "../attack/types.js";
import { readEvalHistory, readEvalSummary } from "../value/evalSummary.js";
import { isCurrencyCode } from "../currency/registry.js";
import { liveValueMetrics } from "../value/valueMetrics.js";
import { z } from "zod";
import { createOwnerSessionGuard } from "./ownerSession.js";
import { inspectEvidence, loadEvidenceSummary, loadEvidenceTx, loadVerification } from "../evidence/inspect.js";
import { rpcEndpoint, verifyTransaction } from "../evidence/verify.js";

type ServerOptions = {
  deployment?: Deployment;
  environment?: NodeJS.ProcessEnv;
  contacts?: Readonly<Record<string, `0x${string}`>>;
  llmAdapter?: LlmAdapter;
  riskIntel?: RiskIntelGateway;
  evalResultsPath?: string;
  /** Per-run secret required on every /owner/* route. A random one is generated when omitted. */
  ownerSessionToken?: string;
  /** Exported execution evidence (evidence/ by default). */
  evidenceDir?: string;
};

const ChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  source: z.enum(["trusted", "untrusted"]).default("trusted"),
  sourceRefs: z.array(z.string().min(1)).default([]),
  context: z.object({
    memo: z.string().max(10_000).optional(), payeeName: z.string().max(1_000).optional(),
    fetchedContent: z.string().max(50_000).optional(),
    expectedRecipientContactId: z.string().regex(/^[a-z][a-z0-9_-]*$/i).optional(),
  }).strict().optional(),
}).strict();
const PlanCreateSchema = ChatRequestSchema;
const PlanEditSchema = z.object({ steps: PlanStepsSchema }).strict();
const RecurringCreateSchema = z.object({
  contactId: z.string().regex(/^[a-z][a-z0-9_-]*$/i),
  amount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/),
  currency: z.string().regex(/^[A-Z]{3}$/).refine(isCurrencyCode, "not a configured demo unit").default("USD"),
  intervalSeconds: z.number().int().min(60),
  nextRunAt: z.number().int().nonnegative().optional(),
}).strict();
const RunDueSchema = z.object({ now: z.number().int().nonnegative().optional() }).strict();
const PolicyUpdateSchema = z.object({
  perTxLimit: z.string(), dailyLimit: z.string(), approvalThreshold: z.string(),
  recipientCooldown: z.number().int().nonnegative(), pendingExpiry: z.number().int().positive(),
  opsPerCallLimit: z.string(), opsDailyLimit: z.string(),
}).strict();
const RecipientUpdateSchema = z.object({ allowed: z.boolean(), label: z.string().trim().min(1).max(100) }).strict();

export function buildServer(config: Config, options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  void app.register(cors, { origin: [/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/] });
  // Owner routes sign with the owner key, so they require the per-run owner session token.
  app.addHook("preParsing", createOwnerSessionGuard(options.ownerSessionToken));
  const audit = new AuditLog(resolveRepoPath(config.AUDIT_DB_PATH));
  const deployment = options.deployment ?? loadDeployment(config);
  const contacts = options.contacts ?? contactsFromEnvironment(options.environment ?? process.env);
  const clients = createChainClients(config, deployment);
  const chain = createChainAdapter(config, deployment);
  const environment = options.environment ?? process.env;
  const pipeline = new AgentPipeline(config, deployment, clients.publicClient, audit, contacts, environment, options.llmAdapter, options.riskIntel);
  const state = new ChainStateReader(clients.publicClient, deployment, contacts);
  const plans = new PlanManager(pipeline, audit);
  const scheduler = new RecurringScheduler(pipeline, audit);
  const attackLab = new AttackLab(config, environment, { audit });
  scheduler.start();

  app.get("/health", async () => ({
    ok: true,
    llmProvider: config.LLM_PROVIDER,
    llm: pipeline.llmInfo(),
    chainId: config.CHAIN_ID,
  }));

  app.post("/chat", async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST", details: z.treeifyError(parsed.error) });
    // A multi-step request becomes a visible draft plan; one that does not parse as a plan falls
    // through to the pipeline, which screens it and asks or refuses as for any other message.
    if (looksLikePlan(parsed.data.message) && !parsed.data.context) {
      let plan;
      try { plan = plans.create(parsed.data.message, parsed.data.source, parsed.data.sourceRefs); }
      catch { plan = undefined; }
      if (plan) {
        const validatedPlan = await plans.validate(plan.id);
        return { route: "PLAN", tier: maxTier(validatedPlan.steps.map((step) => step.validation?.tier)), explanation: planExplanation(validatedPlan), plan: validatedPlan };
      }
    }
    const result = await pipeline.run(parsed.data);
    if (result.route === "SCHEDULE_READY" && result.proposal.kind === "schedule_recurring") {
      const intervalSeconds = /week/i.test(result.proposal.reason) ? 604_800 : 86_400;
      const recurring = scheduler.add({
        contactId: result.proposal.recipientContactId!,
        amount: result.proposal.amount!,
        currency: result.proposal.currency!,
        intervalSeconds,
      });
      return { ...result, route: "SCHEDULED", recurring, ...(result.why ? { why: { ...result.why, decision: "SCHEDULED" } } : {}) };
    }
    return result;
  });
  app.get("/state", async () => state.state());
  app.get("/contacts", async () => state.recipients());
  // Each pending item carries the explanation of the pipeline decision that created it.
  app.get("/pending", async () => {
    const items = await state.pending();
    const entries = audit.list();
    const explanations = pendingExplanations(entries);
    const reasoning = pendingReasoning(entries);
    return items.map((item) => ({
      ...item, operation: "requestApproval", why: explanations.get(item.id ?? "") ?? null,
      agentReasoning: reasoning.get(item.id ?? "")?.reason ?? null, flags: reasoning.get(item.id ?? "")?.flags ?? [],
    }));
  });
  // Shown in the console header: what the agent is connected to right now, read from the node.
  app.get("/chain", async (_request, reply) => {
    try {
      const [chainId, blockHeight] = await Promise.all([clients.publicClient.getChainId(), clients.publicClient.getBlockNumber({ cacheTime: 0 })]);
      return { backend: config.CHAIN_BACKEND, chainId, blockHeight: blockHeight.toString() };
    } catch (error) { return reply.code(503).send({ error: "NODE_UNAVAILABLE", message: errorMessage(error) }); }
  });
  app.get("/audit", async () => audit.list());
  app.get("/audit/verify", async () => audit.verify());
  app.get("/value", async () => {
    const resultsPath = options.evalResultsPath ?? resolveRepoPath("eval/results.json");
    return { eval: readEvalSummary(resultsPath), history: readEvalHistory(resolve(dirname(resultsPath), "history.json")), live: liveValueMetrics(audit.list()) };
  });
  app.get("/attack-lab", async () => attackLab.list());
  app.post<{ Params: { id: string } }>("/attack-lab/run/:id", async (request, reply) => {
    if (!attackIds.includes(request.params.id as AttackId)) return reply.code(404).send({ error: "ATTACK_NOT_FOUND" });
    try { return await attackLab.run(request.params.id as AttackId); }
    catch (error) { return reply.code(500).send({ error: "ATTACK_RUN_FAILED", message: errorMessage(error) }); }
  });
  app.post("/attack-lab/run-all", async (_request, reply) => {
    try { return await attackLab.runAll(); }
    catch (error) { return reply.code(500).send({ error: "ATTACK_RUN_FAILED", message: errorMessage(error) }); }
  });
  app.get<{ Params: { hash: string } }>("/receipt/:hash", async (request, reply) => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(request.params.hash)) return reply.code(400).send({ error: "INVALID_HASH" });
    try { return serializeReceipt(await chain.getReceipt(request.params.hash as Hex)); }
    catch (error) { return reply.code(404).send({ error: "RECEIPT_NOT_FOUND", message: errorMessage(error) }); }
  });
  const evidenceDir = options.evidenceDir ?? resolveRepoPath("evidence");
  app.get("/evidence", async (_request, reply) => {
    const summary = loadEvidenceSummary(evidenceDir);
    if (!summary) return reply.code(404).send({ error: "EVIDENCE_NOT_FOUND", message: "Run ./scripts/evidence.sh to export evidence." });
    return inspectEvidence(summary, loadVerification(evidenceDir));
  });
  // Mode (a) for one transaction: the node that produced the evidence must return the same receipt.
  app.get<{ Params: { hash: string } }>("/evidence/verify/:hash", async (request, reply) => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(request.params.hash)) return reply.code(400).send({ error: "INVALID_HASH" });
    const summary = loadEvidenceSummary(evidenceDir);
    const found = summary && loadEvidenceTx(evidenceDir, summary, request.params.hash);
    if (!summary || !found) return reply.code(404).send({ error: "NOT_IN_EVIDENCE", message: "This hash is not in the exported evidence." });
    let endpoint;
    try { endpoint = rpcEndpoint(summary.network.rpcUrl); }
    catch (error) { return reply.code(400).send({ error: "ENDPOINT_REFUSED", message: errorMessage(error) }); }
    try {
      const chainId = Number(BigInt(await endpoint.request("eth_chainId", []) as string));
      const { problems, receipt } = await verifyTransaction(found.run, found.tx, endpoint.request);
      if (chainId !== summary.network.chainId) problems.unshift(`chain ID ${chainId} ≠ ${summary.network.chainId}`);
      return { hash: found.tx.hash, rpcUrl: endpoint.rpcUrl, chainId, expected: { blockNumber: found.tx.blockNumber, blockHash: found.tx.blockHash, status: found.tx.status }, receipt, match: problems.length === 0, problems };
    } catch (error) { return reply.code(502).send({ error: "NODE_UNAVAILABLE", message: `Could not reach ${endpoint.rpcUrl}: ${errorMessage(error)}` }); }
  });
  // Success is reported only once the receipt is in and the contract shows the new pending status.
  app.post<{ Params: { id: string } }>("/owner/pending/:id/approve", async (request, reply) => {
    try { return await decidePending(request.params.id, "approve"); }
    catch (error) { return reply.code(400).send({ error: "APPROVAL_FAILED", message: errorMessage(error) }); }
  });
  app.post<{ Params: { id: string } }>("/owner/pending/:id/reject", async (request, reply) => {
    try { return await decidePending(request.params.id, "reject"); }
    catch (error) { return reply.code(400).send({ error: "REJECTION_FAILED", message: errorMessage(error) }); }
  });
  app.post("/owner/pause", async (_request, reply) => {
    try { return await runOwnerAction({ kind: "pause" }, "wallet_paused"); }
    catch (error) { return reply.code(400).send({ error: "PAUSE_FAILED", message: errorMessage(error) }); }
  });
  app.post("/owner/unpause", async (_request, reply) => {
    try { return await runOwnerAction({ kind: "unpause" }, "wallet_unpaused"); }
    catch (error) { return reply.code(400).send({ error: "UNPAUSE_FAILED", message: errorMessage(error) }); }
  });
  app.put("/owner/policy", async (request, reply) => {
    const parsed = PolicyUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST", details: z.treeifyError(parsed.error) });
    try {
      return await runOwnerAction({ kind: "set_policy", policy: {
        perTxLimit: parseUnits(parsed.data.perTxLimit, 6), dailyLimit: parseUnits(parsed.data.dailyLimit, 6), approvalThreshold: parseUnits(parsed.data.approvalThreshold, 6),
        recipientCooldown: BigInt(parsed.data.recipientCooldown), pendingExpiry: BigInt(parsed.data.pendingExpiry),
        opsPerCallLimit: parseUnits(parsed.data.opsPerCallLimit, 6), opsDailyLimit: parseUnits(parsed.data.opsDailyLimit, 6),
      } }, "policy_updated");
    } catch (error) { return reply.code(400).send({ error: "POLICY_UPDATE_FAILED", message: errorMessage(error) }); }
  });
  app.put<{ Params: { contactId: string } }>("/owner/recipients/:contactId", async (request, reply) => {
    const parsed = RecipientUpdateSchema.safeParse(request.body);
    const recipient = contacts[request.params.contactId.toLowerCase()];
    if (!parsed.success || !recipient) return reply.code(400).send({ error: "INVALID_RECIPIENT" });
    try { return await runOwnerAction({ kind: "set_recipient", recipient, ...parsed.data }, "recipient_updated"); }
    catch (error) { return reply.code(400).send({ error: "RECIPIENT_UPDATE_FAILED", message: errorMessage(error) }); }
  });
  app.post("/plans", async (request, reply) => {
    const parsed = PlanCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST", details: z.treeifyError(parsed.error) });
    let plan;
    try { plan = plans.create(parsed.data.message, parsed.data.source, parsed.data.sourceRefs); }
    catch (error) { return reply.code(400).send({ error: "INVALID_PLAN", message: errorMessage(error) }); }
    return plans.validate(plan.id);
  });
  app.get("/plans", async () => plans.list());
  app.get<{ Params: { id: string } }>("/plans/:id", async (request, reply) => {
    try { return plans.get(request.params.id); }
    catch (error) { return reply.code(404).send({ error: "PLAN_NOT_FOUND", message: errorMessage(error) }); }
  });
  app.patch<{ Params: { id: string } }>("/plans/:id", async (request, reply) => {
    const parsed = PlanEditSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST", details: z.treeifyError(parsed.error) });
    try { plans.edit(request.params.id, parsed.data.steps); }
    catch (error) { return reply.code(400).send({ error: "PLAN_EDIT_FAILED", message: errorMessage(error) }); }
    return plans.validate(request.params.id);
  });
  app.post<{ Params: { id: string } }>("/plans/:id/execute", async (request, reply) => {
    try { return await plans.execute(request.params.id); }
    catch (error) { return reply.code(400).send({ error: "PLAN_EXECUTION_FAILED", message: errorMessage(error) }); }
  });
  app.delete<{ Params: { id: string } }>("/plans/:id", async (request, reply) => {
    try { return plans.cancel(request.params.id); }
    catch (error) { return reply.code(400).send({ error: "PLAN_CANCEL_FAILED", message: errorMessage(error) }); }
  });
  app.post("/recurring", async (request, reply) => {
    const parsed = RecurringCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST", details: z.treeifyError(parsed.error) });
    const contactId = parsed.data.contactId.toLowerCase();
    if (!contacts[contactId]) return reply.code(400).send({ error: "UNKNOWN_CONTACT" });
    return scheduler.add({
      contactId,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      intervalSeconds: parsed.data.intervalSeconds,
      ...(parsed.data.nextRunAt === undefined ? {} : { nextRunAt: parsed.data.nextRunAt }),
    });
  });
  app.get("/recurring", async () => scheduler.list());
  app.delete<{ Params: { id: string } }>("/recurring/:id", async (request, reply) => {
    try { return scheduler.cancel(request.params.id); }
    catch (error) { return reply.code(404).send({ error: "RECURRING_NOT_FOUND", message: errorMessage(error) }); }
  });
  app.post("/scheduler/run-due", async (request, reply) => {
    const parsed = RunDueSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST", details: z.treeifyError(parsed.error) });
    return parsed.data.now === undefined ? scheduler.runDue() : scheduler.runDue(parsed.data.now);
  });
  app.addHook("onClose", async () => { scheduler.stop(); audit.close(); });

  async function decidePending(id: string, kind: "approve" | "reject") {
    if (!/^[1-9][0-9]{0,18}$/.test(id)) throw new Error("invalid pending ID");
    const pendingId = BigInt(id);
    const receipt = await runOwnerAction({ kind, pendingId }, kind === "approve" ? "pending_approved" : "pending_rejected");
    if (receipt.status !== "success") throw new Error(`transaction ${receipt.transactionHash} reverted`);
    const pendingStatus = await state.pendingStatus(pendingId);
    const expected = kind === "approve" ? "EXECUTED" : "REJECTED";
    if (pendingStatus !== expected) throw new Error(`pending #${id} is ${pendingStatus} on chain, expected ${expected}`);
    return { ...receipt, pendingId: id, pendingStatus };
  }

  async function runOwnerAction(action: Parameters<OwnerExecutor["submit"]>[0], kind: string) {
    const receipt = await OwnerExecutor.create(config, deployment, environment).submit(action);
    audit.append({ timestamp: new Date().toISOString(), kind, data: { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber } });
    return serializeReceipt(receipt);
  }

  return app;
}

function serializeReceipt(receipt: Awaited<ReturnType<ReturnType<typeof createChainAdapter>["getReceipt"]>>) {
  return { ...receipt, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() };
}

function maxTier(tiers: Array<string | undefined>): string {
  return tiers.reduce<string>((highest, tier) => tier && tier > highest ? tier : highest, "T0");
}

/** Deterministic summary; every number comes from the plan the backend just validated. */
function planExplanation(plan: Plan): string {
  const validated = plan.steps.filter((step) => step.state === "VALIDATED").length;
  const cap = plan.approvalCap ? ` You asked to approve anything above ${plan.approvalCap.amount} ${plan.approvalCap.currency}.` : "";
  return `Plan of ${plan.steps.length} steps; ${validated} passed every check without signing. Review it, then run it.${cap}`;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "unknown error"; }

function contactsFromEnvironment(environment: NodeJS.ProcessEnv): Readonly<Record<string, `0x${string}`>> {
  const values = {
    ana: environment.DEMO_CONTACT_1_ADDRESS,
    bob: environment.DEMO_CONTACT_2_ADDRESS,
    chen: environment.DEMO_CONTACT_3_ADDRESS,
  };
  return Object.fromEntries(Object.entries(values).flatMap(([id, value]) => value && isAddress(value) ? [[id, getAddress(value)]] : []));
}
