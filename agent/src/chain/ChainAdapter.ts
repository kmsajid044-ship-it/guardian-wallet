import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type Log,
  type PublicClient,
  type Transport,
} from "viem";
import type { Config, Deployment } from "../config.js";
import type { PolicyReader } from "../policy/precheck.js";
import { AgentActionSchema, type AgentAction, type Policy } from "../policy/types.js";
import {
  demoLedgerAbi,
  demoLedgerConstructorAbi,
  guardianWalletAbi,
  guardianWalletConstructorAbi,
} from "./abi.js";
import { GuardianReader } from "./reader.js";

export type ChainBackend = Config["CHAIN_BACKEND"];
export type BalanceSnapshot = { USD: { available: bigint; savings: bigint }; BDT: { available: bigint; savings: bigint } };
export type PolicySnapshot = Policy & { paused: boolean; spentToday: bigint; opsSpentToday: bigint };
export type Receipt = { transactionHash: Hex; blockNumber: bigint; status: "success" | "reverted"; from: Address; to: Address | null; gasUsed: bigint };
export type ChainEvent = { transactionHash: Hex | null; blockNumber: bigint | null; name: string; args: Readonly<Record<string, unknown>> };
export type AdapterSimulation = { outcome: 0 | 1 | 2; auxiliary: bigint };

export type OwnerAction =
  | { kind: "approve"; pendingId: bigint }
  | { kind: "reject"; pendingId: bigint }
  | { kind: "pause" }
  | { kind: "unpause" }
  | { kind: "withdraw_savings"; currency: 0 | 1; amount: bigint }
  | { kind: "set_policy"; policy: Policy }
  | { kind: "set_recipient"; recipient: Address; allowed: boolean; label: string }
  | { kind: "set_fee_account"; account: Address }
  | { kind: "set_agent"; account: Address }
  | { kind: "set_guardian"; account: Address }
  | { kind: "mint"; account: Address; currency: 0 | 1; amount: bigint };

export type DeployRequest = {
  owner: Account;
  agent: Address;
  guardian: Address;
  feeAccount: Address;
  policy: Policy;
};

export interface ChainAdapter {
  readonly backend: ChainBackend;
  readonly deployment: Deployment | undefined;
  deploy(request: DeployRequest): Promise<Deployment>;
  readPolicy(): Promise<PolicySnapshot>;
  readBalances(account?: Address): Promise<BalanceSnapshot>;
  sendAgentTx(action: AgentAction, signer: Account): Promise<Hex>;
  ownerTx(action: OwnerAction, signer: Account): Promise<Hex>;
  getReceipt(hash: Hex): Promise<Receipt>;
  getEvents(fromBlock?: bigint, toBlock?: bigint): Promise<ChainEvent[]>;
  simulateAgentTx(action: AgentAction, agent: Address): Promise<AdapterSimulation>;
  policyReader(): PolicyReader;
}

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function bytecode(path: string): Hex {
  const artifact = JSON.parse(readFileSync(resolve(repoRoot, path), "utf8")) as { bytecode: { object: Hex } };
  return artifact.bytecode.object;
}

class ViemChainAdapter implements ChainAdapter {
  readonly backend: ChainBackend;
  deployment: Deployment | undefined;
  private readonly chain: Chain;
  private readonly client: PublicClient<Transport, Chain>;

  constructor(private readonly config: Config, deployment?: Deployment) {
    this.backend = config.CHAIN_BACKEND;
    this.deployment = deployment;
    this.chain = defineChain({
      id: config.CHAIN_ID,
      name: this.backend,
      nativeCurrency: { name: "Local execution unit", symbol: "LEU", decimals: 18 },
      rpcUrls: { default: { http: [config.RPC_URL] } },
    });
    this.client = createPublicClient({ chain: this.chain, transport: http(config.RPC_URL), pollingInterval: this.backend === "fisco" ? 100 : 1_000 });
  }

  async deploy(request: DeployRequest): Promise<Deployment> {
    const wallet = this.wallet(request.owner);
    const transactionOptions = this.transactionOptions();
    const ledgerHash = await this.withNonceRetry(() => wallet.deployContract({
      abi: demoLedgerConstructorAbi,
      bytecode: bytecode("contracts/out/DemoLedger.sol/DemoLedger.json"),
      args: [request.owner.address],
      ...transactionOptions,
    }));
    const ledgerReceipt = await this.client.waitForTransactionReceipt({ hash: ledgerHash });
    if (!ledgerReceipt.contractAddress || ledgerReceipt.status !== "success") throw new Error("DemoLedger deployment failed");
    const ledgerAddress = getAddress(ledgerReceipt.contractAddress);
    const walletHash = await this.withNonceRetry(() => wallet.deployContract({
      abi: guardianWalletConstructorAbi,
      bytecode: bytecode("contracts/out/GuardianWallet.sol/GuardianWallet.json"),
      args: [request.owner.address, request.agent, request.guardian, ledgerAddress, request.feeAccount, request.policy],
      ...transactionOptions,
    }));
    const walletReceipt = await this.client.waitForTransactionReceipt({ hash: walletHash });
    if (!walletReceipt.contractAddress || walletReceipt.status !== "success") throw new Error("GuardianWallet deployment failed");
    const block = await this.client.getBlock({ blockNumber: walletReceipt.blockNumber });
    this.deployment = {
      network: this.backend,
      chainId: this.config.CHAIN_ID,
      deployedAt: Number(block.timestamp),
      guardianWallet: getAddress(walletReceipt.contractAddress),
      demoLedger: ledgerAddress,
      owner: request.owner.address,
      agent: getAddress(request.agent),
      guardian: getAddress(request.guardian),
      feeAccount: getAddress(request.feeAccount),
    };
    await this.writeLedger("setController", [getAddress(this.deployment.guardianWallet)], request.owner);
    return this.deployment;
  }

  async readPolicy(): Promise<PolicySnapshot> {
    const reader = this.policyReader();
    return { ...await reader.getPolicy(), paused: await reader.isPaused(), spentToday: await reader.getSpentToday(), opsSpentToday: await reader.getOpsSpentToday() };
  }

  async readBalances(account?: Address): Promise<BalanceSnapshot> {
    const deployment = this.requireDeployment();
    const target = getAddress(account ?? deployment.guardianWallet);
    const read = async (functionName: "balanceOf" | "savingsBalance", currency: 0 | 1) => this.client.readContract({
      address: getAddress(deployment.demoLedger), abi: demoLedgerAbi, functionName, args: [target, currency],
    });
    return {
      USD: { available: await read("balanceOf", 0), savings: await read("savingsBalance", 0) },
      BDT: { available: await read("balanceOf", 1), savings: await read("savingsBalance", 1) },
    };
  }

  async sendAgentTx(rawAction: AgentAction, signer: Account): Promise<Hex> {
    const action = AgentActionSchema.parse(rawAction);
    const deployment = this.requireDeployment();
    if (getAddress(signer.address) !== getAddress(deployment.agent)) throw new Error("signer is not the configured agent");
    const call = agentCall(action);
    const data = encodeFunctionData({ abi: guardianWalletAbi, ...call });
    return this.withNonceRetry(() => this.wallet(signer).sendTransaction({ to: getAddress(deployment.guardianWallet), data, ...this.transactionOptions() }));
  }

  async ownerTx(action: OwnerAction, signer: Account): Promise<Hex> {
    const deployment = this.requireDeployment();
    if (getAddress(signer.address) !== getAddress(deployment.owner)) throw new Error("signer is not the configured owner");
    if (action.kind === "mint") return this.writeLedger("mint", [action.account, action.currency, action.amount], signer);
    const call = ownerCall(action);
    const data = encodeFunctionData({ abi: guardianWalletAbi, ...call });
    return this.withNonceRetry(() => this.wallet(signer).sendTransaction({ to: getAddress(deployment.guardianWallet), data, ...this.transactionOptions() }));
  }

  async getReceipt(hash: Hex): Promise<Receipt> {
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    return { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, status: receipt.status, from: getAddress(receipt.from), to: receipt.to ? getAddress(receipt.to) : null, gasUsed: receipt.gasUsed };
  }

  async getEvents(fromBlock: bigint = 0n, toBlock?: bigint): Promise<ChainEvent[]> {
    const deployment = this.requireDeployment();
    const logs = await this.client.getLogs({ address: getAddress(deployment.guardianWallet), fromBlock, ...(toBlock === undefined ? {} : { toBlock }) });
    return logs.flatMap((log: Log) => {
      try {
        const decoded = decodeEventLog({ abi: guardianWalletAbi, data: log.data, topics: log.topics, strict: false });
        return [{ transactionHash: log.transactionHash, blockNumber: log.blockNumber, name: decoded.eventName, args: decoded.args as Readonly<Record<string, unknown>> }];
      } catch { return []; }
    });
  }

  async simulateAgentTx(rawAction: AgentAction, agent: Address): Promise<AdapterSimulation> {
    const action = AgentActionSchema.parse(rawAction);
    const deployment = this.requireDeployment();
    const call = agentCall(action);
    const data = encodeFunctionData({ abi: guardianWalletAbi, ...call });
    const result = await this.client.call({ account: agent, to: getAddress(deployment.guardianWallet), data });
    if (!result.data) throw new Error("simulation returned no data");
    const decoded = decodeFunctionResult({ abi: guardianWalletAbi, functionName: call.functionName, data: result.data });
    if (Array.isArray(decoded)) return { outcome: decoded[0] as 0 | 1 | 2, auxiliary: decoded[1] as bigint };
    return { outcome: decoded as 0 | 1 | 2, auxiliary: 0n };
  }

  policyReader(): PolicyReader {
    const deployment = this.requireDeployment();
    // FISCO BCOS reports block timestamps in milliseconds and only seals blocks for new
    // transactions, so the latest block can be stale. The contracts divide by their clockScale
    // and keep time in seconds; mirror that with wall-clock seconds.
    const timestampSource = this.backend === "fisco" ? () => BigInt(Math.floor(Date.now() / 1_000)) : undefined;
    return new GuardianReader(this.client, getAddress(deployment.guardianWallet), getAddress(deployment.demoLedger), timestampSource);
  }

  private requireDeployment(): Deployment {
    if (!this.deployment) throw new Error("contracts are not deployed");
    return this.deployment;
  }

  private wallet(account: Account) {
    return createWalletClient({ account, chain: this.chain, transport: http(this.config.RPC_URL) });
  }

  private transactionOptions(): { gasPrice?: bigint } {
    return this.backend === "fisco" ? { gasPrice: 0n } : {};
  }

  private async writeLedger(functionName: "setController" | "mint", args: readonly [Address] | readonly [Address, 0 | 1, bigint], signer: Account): Promise<Hex> {
    const deployment = this.requireDeployment();
    return this.withNonceRetry(() => this.wallet(signer).writeContract({ address: getAddress(deployment.demoLedger), abi: demoLedgerAbi, functionName, args: args as never, ...this.transactionOptions() }));
  }

  // FISCO BCOS can report a just-mined nonce as unused for a moment; it then rejects the
  // transaction with NonceCheckFail before accepting it, so resending cannot duplicate it.
  private async withNonceRetry<T>(send: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try { return await send(); }
      catch (error) {
        if (this.backend !== "fisco" || attempt >= 6 || !isNonceRejection(error)) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 150 * attempt));
      }
    }
  }
}

export function isNonceRejection(error: unknown): boolean {
  return error instanceof Error && /NonceCheckFail/i.test(error.message);
}

function agentCall(action: AgentAction) {
  if (action.kind === "pay") return { functionName: "pay" as const, args: [action.to, action.currency, action.amount, action.intentId] as const };
  if (action.kind === "request_approval") return { functionName: "requestApproval" as const, args: [action.to, action.currency, action.amount, action.intentId] as const };
  if (action.kind === "save") return { functionName: "saveToSavings" as const, args: [action.currency, action.amount, action.intentId] as const };
  return { functionName: "payServiceFee" as const, args: [action.amount, action.intentId] as const };
}

function ownerCall(action: Exclude<OwnerAction, { kind: "mint" }>) {
  switch (action.kind) {
    case "approve": return { functionName: "approve" as const, args: [action.pendingId] as const };
    case "reject": return { functionName: "reject" as const, args: [action.pendingId] as const };
    case "pause": return { functionName: "pause" as const, args: [] as const };
    case "unpause": return { functionName: "unpause" as const, args: [] as const };
    case "withdraw_savings": return { functionName: "withdrawSavings" as const, args: [action.currency, action.amount] as const };
    case "set_policy": return { functionName: "setPolicy" as const, args: [action.policy] as const };
    case "set_recipient": return { functionName: "setRecipient" as const, args: [action.recipient, action.allowed, action.label] as const };
    case "set_fee_account": return { functionName: "setFeeAccount" as const, args: [action.account] as const };
    case "set_agent": return { functionName: "setAgent" as const, args: [action.account] as const };
    case "set_guardian": return { functionName: "setGuardian" as const, args: [action.account] as const };
  }
}

export function createChainAdapter(config: Config, deployment?: Deployment): ChainAdapter {
  return new ViemChainAdapter(config, deployment);
}
