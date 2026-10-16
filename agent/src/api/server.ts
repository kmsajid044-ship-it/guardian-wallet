import Fastify, { type FastifyInstance } from "fastify";
import { getAddress, isAddress } from "viem";
import { AuditLog } from "../audit/audit.js";
import { createChainClients } from "../chain/client.js";
import { ChainStateReader } from "../chain/state.js";
import { loadDeployment, resolveRepoPath, type Config, type Deployment } from "../config.js";
import { AgentPipeline } from "../pipeline/pipeline.js";
import type { LlmAdapter } from "../llm/adapter.js";
import { PlanManager, PlanStepsSchema } from "../planner/planner.js";
import { RecurringScheduler } from "../scheduler/scheduler.js";
import type { RiskIntelGateway } from "../riskIntel/client.js";
import { z } from "zod";

type ServerOptions = {
  deployment?: Deployment;
  environment?: NodeJS.ProcessEnv;
  contacts?: Readonly<Record<string, `0x${string}`>>;
  llmAdapter?: LlmAdapter;
  riskIntel?: RiskIntelGateway;
};

const ChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  source: z.enum(["trusted", "untrusted"]).default("trusted"),
  sourceRefs: z.array(z.string().min(1)).default([]),
}).strict();
const PlanCreateSchema = ChatRequestSchema;
const PlanEditSchema = z.object({ steps: PlanStepsSchema }).strict();
const RecurringCreateSchema = z.object({
  contactId: z.string().regex(/^[a-z][a-z0-9_-]*$/i),
  amount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/),
  currency: z.enum(["USD", "BDT"]).default("USD"),
  intervalSeconds: z.number().int().min(60),
  nextRunAt: z.number().int().nonnegative().optional(),
}).strict();
const RunDueSchema = z.object({ now: z.number().int().nonnegative().optional() }).strict();

export function buildServer(config: Config, options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  const audit = new AuditLog(resolveRepoPath(config.AUDIT_DB_PATH));
  const deployment = options.deployment ?? loadDeployment(config);
  const contacts = options.contacts ?? contactsFromEnvironment(options.environment ?? process.env);
  const clients = createChainClients(config, deployment);
  const pipeline = new AgentPipeline(config, deployment, clients.publicClient, audit, contacts, options.environment ?? process.env, options.llmAdapter, options.riskIntel);
  const state = new ChainStateReader(clients.publicClient, deployment, contacts);
  const plans = new PlanManager(pipeline, audit);
  const scheduler = new RecurringScheduler(pipeline, audit);
  scheduler.start();

  app.get("/health", async () => ({
    ok: true,
    llmProvider: config.LLM_PROVIDER,
    chainId: config.CHAIN_ID,
  }));

  app.post("/chat", async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST", details: z.treeifyError(parsed.error) });
    const result = await pipeline.run(parsed.data);
    if (result.route === "SCHEDULE_READY" && result.proposal.kind === "schedule_recurring") {
      const intervalSeconds = /week/i.test(result.proposal.reason) ? 604_800 : 86_400;
      const recurring = scheduler.add({
        contactId: result.proposal.recipientContactId!,
        amount: result.proposal.amount!,
        currency: result.proposal.currency!,
        intervalSeconds,
      });
      return { ...result, route: "SCHEDULED", recurring };
    }
    return result;
  });
  app.get("/state", async () => state.state());
  app.get("/pending", async () => state.pending());
  app.get("/audit", async () => audit.list());
  app.get("/audit/verify", async () => audit.verify());
  app.post("/plans", async (request, reply) => {
    const parsed = PlanCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST", details: z.treeifyError(parsed.error) });
    try { return plans.create(parsed.data.message, parsed.data.source, parsed.data.sourceRefs); }
    catch (error) { return reply.code(400).send({ error: "INVALID_PLAN", message: errorMessage(error) }); }
  });
  app.get("/plans", async () => plans.list());
  app.get<{ Params: { id: string } }>("/plans/:id", async (request, reply) => {
    try { return plans.get(request.params.id); }
    catch (error) { return reply.code(404).send({ error: "PLAN_NOT_FOUND", message: errorMessage(error) }); }
  });
  app.patch<{ Params: { id: string } }>("/plans/:id", async (request, reply) => {
    const parsed = PlanEditSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST", details: z.treeifyError(parsed.error) });
    try { return plans.edit(request.params.id, parsed.data.steps); }
    catch (error) { return reply.code(400).send({ error: "PLAN_EDIT_FAILED", message: errorMessage(error) }); }
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

  return app;
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
