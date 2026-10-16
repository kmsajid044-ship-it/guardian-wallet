import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { guardianWalletAbi } from "../chain/abi.js";
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
    private readonly walletAddress: Address,
    private readonly publicClient: PublicClient<Transport, Chain>,
    private readonly walletClient: WalletClient<Transport, Chain, Account>,
  ) {}

  static create(config: Config, deployment: Deployment, env: NodeJS.ProcessEnv = process.env): AgentExecutor {
    const parsed = ExecutorEnvironmentSchema.parse(env);
    const account = privateKeyToAccount(parsed.AGENT_PRIVATE_KEY as Hex);
    if (account.address !== getAddress(deployment.agent)) throw new Error("AGENT_PRIVATE_KEY does not match deployment agent");
    const chain = defineChain({
      id: config.CHAIN_ID,
      name: deployment.network,
      nativeCurrency: { name: "Local execution unit", symbol: "LEU", decimals: 18 },
      rpcUrls: { default: { http: [config.RPC_URL] } },
    });
    return new AgentExecutor(
      getAddress(deployment.guardianWallet),
      createPublicClient({ chain, transport: http(config.RPC_URL) }),
      createWalletClient({ account, chain, transport: http(config.RPC_URL) }),
    );
  }

  async submit(unvalidatedAction: AgentAction, authorization: ExecutionAuthorization): Promise<ExecutionResult> {
    const action = AgentActionSchema.parse(unvalidatedAction);
    const expected = authorization.policy.route === "EXECUTE"
      ? "EXECUTED"
      : authorization.policy.route === "NEEDS_APPROVAL" ? "PENDING" : "BLOCKED";
    if (authorization.simulation.outcome !== expected) {
      throw new Error("execution authorization does not permit submission");
    }

    const transactionHash = await this.write(action);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== "success") throw new Error(`agent transaction reverted: ${transactionHash}`);
    return { transactionHash, blockNumber: receipt.blockNumber, status: "success" };
  }

  private async write(action: AgentAction): Promise<Hex> {
    if (action.kind === "pay") {
      return this.walletClient.writeContract({
        address: this.walletAddress,
        abi: guardianWalletAbi,
        functionName: "pay",
        args: [action.to, action.currency, action.amount, action.intentId],
      });
    }
    if (action.kind === "request_approval") {
      return this.walletClient.writeContract({
        address: this.walletAddress,
        abi: guardianWalletAbi,
        functionName: "requestApproval",
        args: [action.to, action.currency, action.amount, action.intentId],
      });
    }
    const functionName = action.kind === "save" ? "saveToSavings" : "payServiceFee";
    return this.walletClient.writeContract({
      address: this.walletAddress,
      abi: guardianWalletAbi,
      functionName,
      args: action.kind === "save" ? [action.currency, action.amount, action.intentId] : [action.amount, action.intentId],
    });
  }
}
