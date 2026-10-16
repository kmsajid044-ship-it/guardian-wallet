import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  decodeEventLog,
  defineChain,
  getAddress,
  http,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { guardianWalletAbi } from "../chain/abi.js";
import { createChainAdapter, isNonceRejection, type ChainAdapter, type OwnerAction } from "../chain/ChainAdapter.js";
import type { Config, Deployment } from "../config.js";
import { policyReasons, type AgentAction, type Policy } from "../policy/types.js";

const EnvironmentSchema = z.object({
  AGENT_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  OWNER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export const UNIT = 1_000_000n;
const zero = "0x0000000000000000000000000000000000000000" as Address;
const feeAccount = getAddress("0x00000000000000000000000000000000000000f3");
// Gas ceiling for probes that are expected to revert. Supplying it skips gas
// estimation, so the refused call is still packaged into a block and receives a hash.
const PROBE_GAS = 3_000_000n;

const refusalAbi = [
  { type: "error", name: "NotAgent", inputs: [] },
  { type: "error", name: "NotOwnerOrGuardian", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "InvalidPolicy", inputs: [] },
  { type: "error", name: "PendingNotActive", inputs: [{ name: "pendingId", type: "uint256" }] },
  { type: "error", name: "PendingHasExpired", inputs: [{ name: "pendingId", type: "uint256" }] },
  { type: "error", name: "PendingNotExpired", inputs: [{ name: "pendingId", type: "uint256" }] },
  { type: "error", name: "PendingNoLongerValid", inputs: [{ name: "pendingId", type: "uint256" }, { name: "reason", type: "uint8" }] },
  { type: "error", name: "RenounceDisabled", inputs: [] },
  { type: "error", name: "NotController", inputs: [] },
  { type: "error", name: "InsufficientBalance", inputs: [] },
  { type: "error", name: "OwnableUnauthorizedAccount", inputs: [{ name: "account", type: "address" }] },
] as const;

export type ChainEvidence = {
  transactionHash: Hex;
  blockNumber: string;
  status: "success" | "reverted";
  violations: string[];
  revert?: string;
};

export type AttackFixtureOptions = {
  allowlist: ReadonlyArray<{ address: Address; label: string }>;
  pendingExpiry?: bigint;
  /** Applied after the initial allowlist, so only recipients added later start in cooldown. */
  recipientCooldown?: bigint;
};

/**
 * Restricted signer for Attack Lab scenarios. Each scenario gets a fresh pair of
 * contracts on the configured local chain so shared demo balances are never touched.
 * Signing values are parsed here and never leave this module.
 */
export class AttackExecutor {
  private readonly owner: Account;
  private readonly agent: Account;
  private readonly chain: Chain;
  private readonly client: PublicClient<Transport, Chain>;

  private constructor(private readonly config: Config, environment: NodeJS.ProcessEnv) {
    const parsed = EnvironmentSchema.parse(environment);
    this.owner = privateKeyToAccount(parsed.OWNER_PRIVATE_KEY as Hex);
    this.agent = privateKeyToAccount(parsed.AGENT_PRIVATE_KEY as Hex);
    this.chain = defineChain({ id: config.CHAIN_ID, name: config.CHAIN_BACKEND, nativeCurrency: { name: "Local execution unit", symbol: "LEU", decimals: 18 }, rpcUrls: { default: { http: [config.RPC_URL] } } });
    this.client = createPublicClient({ chain: this.chain, transport: http(config.RPC_URL), pollingInterval: config.CHAIN_BACKEND === "fisco" ? 100 : 50 });
  }

  static create(config: Config, environment: NodeJS.ProcessEnv = process.env): AttackExecutor {
    return new AttackExecutor(config, environment);
  }

  get publicClient(): PublicClient<Transport, Chain> { return this.client; }

  /** Block timestamps on the local FISCO BCOS network are in milliseconds. */
  get timeUnit(): bigint { return this.config.CHAIN_BACKEND === "fisco" ? 1_000n : 1n; }

  async fixture(options: AttackFixtureOptions): Promise<AttackFixture> {
    const base: Policy = {
      perTxLimit: 500n * UNIT, dailyLimit: 1_000n * UNIT, approvalThreshold: 200n * UNIT,
      recipientCooldown: 0n, pendingExpiry: options.pendingExpiry ?? 86_400n * this.timeUnit,
      opsPerCallLimit: UNIT / 10n, opsDailyLimit: 5n * UNIT,
    };
    const policy: Policy = { ...base, recipientCooldown: options.recipientCooldown ?? 0n };
    const adapter = createChainAdapter(this.config);
    const deployment = await adapter.deploy({ owner: this.owner, agent: this.agent.address, guardian: zero, feeAccount, policy: base });
    const fixture = new AttackFixture(adapter, deployment, policy, this.client, this.chain, this.config, this.owner, this.agent);
    await fixture.owner({ kind: "mint", account: getAddress(deployment.guardianWallet), currency: 0, amount: 2_000n * UNIT });
    await fixture.owner({ kind: "mint", account: getAddress(deployment.guardianWallet), currency: 1, amount: 200_000n * UNIT });
    for (const entry of options.allowlist) await fixture.owner({ kind: "set_recipient", recipient: entry.address, allowed: true, label: entry.label });
    if (policy.recipientCooldown !== base.recipientCooldown) await fixture.owner({ kind: "set_policy", policy });
    return fixture;
  }
}

export class AttackFixture {
  constructor(
    private readonly adapter: ChainAdapter,
    readonly deployment: Deployment,
    readonly policy: Policy,
    private readonly client: PublicClient<Transport, Chain>,
    private readonly chain: Chain,
    private readonly config: Config,
    private readonly ownerAccount: Account,
    private readonly agentAccount: Account,
  ) {}

  /** Owner-signed configuration on the fixture deployment. */
  async owner(action: OwnerAction): Promise<ChainEvidence> {
    return this.evidence(await this.adapter.ownerTx(action, this.ownerAccount));
  }

  /** One of the four agent functions, through the restricted adapter. */
  async agent(action: AgentAction): Promise<ChainEvidence> {
    return this.evidence(await this.adapter.sendAgentTx(action, this.agentAccount));
  }

  /**
   * Raw call sent straight to a contract, outside the agent pipeline. The revert
   * reason is read with a local call first, then the call is broadcast with a fixed
   * gas ceiling so the refusal is recorded on-chain with its own hash.
   */
  async probe(signer: "agent" | "owner", to: Address, data: Hex): Promise<ChainEvidence> {
    const account = signer === "agent" ? this.agentAccount : this.ownerAccount;
    let revert: string | undefined;
    try { await this.client.call({ account, to: getAddress(to), data }); }
    catch (error) { revert = decodeRevert(error); }
    const wallet = createWalletClient({ account, chain: this.chain, transport: http(this.config.RPC_URL) });
    const send = () => wallet.sendTransaction({ to: getAddress(to), data, gas: PROBE_GAS, ...(this.config.CHAIN_BACKEND === "fisco" ? { gasPrice: 0n } : {}) });
    let hash: Hex | undefined;
    for (let attempt = 1; hash === undefined; attempt += 1) {
      try { hash = await send(); }
      catch (error) {
        if (attempt >= 6 || !isNonceRejection(error)) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 150 * attempt));
      }
    }
    const evidence = await this.evidence(hash);
    if (evidence.status === "reverted" && revert === undefined) {
      // Time-dependent refusals (expiry) may only fail in the block that packaged the call;
      // replay it against that block's state to read the reason.
      try { await this.client.call({ account, to: getAddress(to), data, blockNumber: BigInt(evidence.blockNumber) }); }
      catch (error) { revert = decodeRevert(error); }
    }
    return revert === undefined ? evidence : { ...evidence, revert };
  }

  async readPending(pendingId: bigint) {
    return this.client.readContract({ address: getAddress(this.deployment.guardianWallet), abi: guardianWalletAbi, functionName: "getPending", args: [pendingId] });
  }

  async readPolicy() { return this.adapter.readPolicy(); }
  async readBalances(account?: Address) { return this.adapter.readBalances(account); }

  private async evidence(hash: Hex): Promise<ChainEvidence> {
    const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    const violations = receipt.logs.flatMap((log) => {
      try {
        const decoded = decodeEventLog({ abi: guardianWalletAbi, data: log.data, topics: log.topics });
        return decoded.eventName === "PolicyViolation" ? [policyReasons[Number(decoded.args.reason)] ?? "UNKNOWN"] : [];
      } catch { return []; }
    });
    return { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, violations };
  }
}

function decodeRevert(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const data = (current as { data?: unknown }).data;
    const hex = typeof data === "string" ? data : typeof (data as { data?: unknown } | undefined)?.data === "string" ? (data as { data: string }).data : undefined;
    if (hex?.startsWith("0x") && hex.length >= 10) {
      try {
        const decoded = decodeErrorResult({ abi: refusalAbi, data: hex as Hex });
        return decoded.args?.length ? `${decoded.errorName}(${decoded.args.map(String).join(", ")})` : decoded.errorName;
      } catch { return `revert ${hex.slice(0, 10)}`; }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return "execution reverted";
}
