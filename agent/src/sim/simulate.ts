import { getAddress, type Address, type Chain, type PublicClient, type Transport } from "viem";
import { guardianWalletAbi } from "../chain/abi.js";
import { AgentActionSchema, type AgentAction } from "../policy/types.js";

export type ContractOutcome = "EXECUTED" | "PENDING" | "BLOCKED";
export type SimulationResult = { outcome: ContractOutcome; auxiliary: bigint };

const outcomes = ["EXECUTED", "PENDING", "BLOCKED"] as const;

function normalizeOutcome(value: number): ContractOutcome {
  const outcome = outcomes[value];
  if (!outcome) throw new Error(`unknown contract outcome ${value}`);
  return outcome;
}

export async function simulateAgentAction(
  client: PublicClient<Transport, Chain>,
  walletAddress: Address,
  agentAddress: Address,
  unvalidatedAction: AgentAction,
): Promise<SimulationResult> {
  const action = AgentActionSchema.parse(unvalidatedAction);
  const address = getAddress(walletAddress);
  const account = getAddress(agentAddress);

  if (action.kind === "pay") {
    const { result } = await client.simulateContract({
      address,
      account,
      abi: guardianWalletAbi,
      functionName: "pay",
      args: [action.to, action.currency, action.amount, action.intentId],
    });
    return { outcome: normalizeOutcome(result), auxiliary: 0n };
  }
  if (action.kind === "request_approval") {
    const { result } = await client.simulateContract({
      address,
      account,
      abi: guardianWalletAbi,
      functionName: "requestApproval",
      args: [action.to, action.currency, action.amount, action.intentId],
    });
    return { outcome: normalizeOutcome(result[0]), auxiliary: result[1] };
  }
  const functionName = action.kind === "save" ? "saveToSavings" : "payServiceFee";
  const { result } = await client.simulateContract({
    address,
    account,
    abi: guardianWalletAbi,
    functionName,
    args: action.kind === "save" ? [action.currency, action.amount, action.intentId] : [action.amount, action.intentId],
  });
  return { outcome: normalizeOutcome(result), auxiliary: 0n };
}
