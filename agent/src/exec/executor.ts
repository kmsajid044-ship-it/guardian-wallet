import {
  getAddress,
  type Account,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { createChainAdapter, type ChainAdapter } from "../chain/ChainAdapter.js";
import type { Config, Deployment } from "../config.js";
import { AgentActionSchema, type AgentAction, type PolicyVerdict } from "../policy/types.js";
import type { SimulationResult } from "../sim/simulate.js";

const ExecutorEnvironmentSchema = z.object({
  AGENT_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export type ExecutionAuthorization = { policy: PolicyVerdict; simulation: SimulationResult };
export type ExecutionResult = { transactionHash: Hex; blockNumber: bigint; status: "success" };

export class AgentExecutor {
  private constructor(
    private readonly adapter: ChainAdapter,
    private readonly account: Account,
  ) {}

  static create(config: Config, deployment: Deployment, env: NodeJS.ProcessEnv = process.env): AgentExecutor {
    const parsed = ExecutorEnvironmentSchema.parse(env);
    const account = privateKeyToAccount(parsed.AGENT_PRIVATE_KEY as Hex);
    if (account.address !== getAddress(deployment.agent)) throw new Error("AGENT_PRIVATE_KEY does not match deployment agent");
    return new AgentExecutor(createChainAdapter(config, deployment), account);
  }

  async submit(unvalidatedAction: AgentAction, authorization: ExecutionAuthorization): Promise<ExecutionResult> {
    const action = AgentActionSchema.parse(unvalidatedAction);
    const expected = authorization.policy.route === "EXECUTE"
      ? "EXECUTED"
      : authorization.policy.route === "NEEDS_APPROVAL" ? "PENDING" : "BLOCKED";
    if (authorization.simulation.outcome !== expected) {
      throw new Error("execution authorization does not permit submission");
    }

    const transactionHash = await this.adapter.sendAgentTx(action, this.account);
    const receipt = await this.adapter.getReceipt(transactionHash);
    if (receipt.status !== "success") throw new Error(`agent transaction reverted: ${transactionHash}`);
    return { transactionHash, blockNumber: receipt.blockNumber, status: "success" };
  }

}
