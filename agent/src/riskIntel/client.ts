import { randomUUID } from "node:crypto";
import { getAddress, keccak256, stringToHex, type Address, type Chain, type PublicClient, type Transport } from "viem";
import { z } from "zod";
import type { AuditLog } from "../audit/audit.js";
import { GuardianReader } from "../chain/reader.js";
import type { Config, Deployment } from "../config.js";
import type { AgentExecutor } from "../exec/executor.js";
import type { Fetch } from "../llm/adapter.js";
import { precheckAction } from "../policy/precheck.js";
import { simulateAgentAction } from "../sim/simulate.js";

const AddressSchema = z.string().transform((value, context) => { try { return getAddress(value); } catch { context.addIssue({ code: "custom", message: "invalid address" }); return z.NEVER; } });
const RiskResultSchema = z.object({ address: AddressSchema, score: z.number().int().min(0).max(100), level: z.enum(["low", "medium", "high"]), sanctioned: z.boolean(), reasons: z.array(z.string()) }).strict();
const FxResultSchema = z.object({ base: z.string().regex(/^[A-Z]{3}$/), quote: z.string().regex(/^[A-Z]{3}$/), rate: z.string(), asOf: z.string(), note: z.string().optional() }).strict();
export type PayeeRiskResult = z.infer<typeof RiskResultSchema>;
export type FxQuoteResult = z.infer<typeof FxResultSchema>;
export interface RiskIntelGateway { checkPayee(address: Address): Promise<PayeeRiskResult> }

export class RiskIntelClient implements RiskIntelGateway {
  private readonly reader: GuardianReader;
  constructor(private readonly baseUrl: string, private readonly config: Config, private readonly deployment: Deployment, private readonly client: PublicClient<Transport, Chain>, private readonly executor: AgentExecutor, private readonly audit: AuditLog, private readonly fetcher: Fetch = fetch) {
    this.reader = new GuardianReader(client, getAddress(deployment.guardianWallet), getAddress(deployment.demoLedger));
  }
  async checkPayee(address: Address): Promise<PayeeRiskResult> { return RiskResultSchema.parse(await this.purchase(`/risk/${getAddress(address)}`)); }
  async quoteFx(base: string, quote: string): Promise<FxQuoteResult> { return FxResultSchema.parse(await this.purchase(`/fx?base=${base}&quote=${quote}`)); }
  private async purchase(path: string): Promise<unknown> {
    const requestId = keccak256(stringToHex(randomUUID()));
    const action = { kind: "service_fee" as const, amount: 50_000n, intentId: requestId };
    const policy = await precheckAction(this.reader, action);
    const simulation = await simulateAgentAction(this.client, getAddress(this.deployment.guardianWallet), getAddress(this.deployment.agent), action);
    if (policy.route !== "EXECUTE" || simulation.outcome !== "EXECUTED") throw new Error(`Risk Intel fee blocked: ${policy.route === "BLOCKED" ? policy.reason : policy.route}`);
    const execution = await this.executor.submit(action, { policy, simulation });
    this.audit.append({ timestamp: new Date().toISOString(), kind: "risk_intel_fee", data: { requestId, amount: action.amount, transactionHash: execution.transactionHash } });
    const response = await this.fetcher(new URL(path, this.baseUrl).toString(), { headers: { "service-request-id": requestId, "service-payment-tx": execution.transactionHash } });
    if (!response.ok) throw new Error(`Risk Intel request failed with HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  }
}
