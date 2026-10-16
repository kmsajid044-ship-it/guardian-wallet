import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeErrorResult, decodeEventLog, decodeFunctionData, getAddress, keccak256, stringToHex, type Abi, type Address, type Hex } from "viem";
import { AttackLab } from "../attack/attackLab.js";
import type { AttackId, AttackResult } from "../attack/types.js";
import { AuditLog } from "../audit/audit.js";
import type { Config } from "../config.js";
import { AttackExecutor, UNIT, type AttackFixture } from "../exec/attackExecutor.js";
import { MockAdapter } from "../llm/provider.js";
import { AgentPipeline, type PipelineResult } from "../pipeline/pipeline.js";
import { policyReasons } from "../policy/types.js";
import { fromCurrencyCode } from "../currency/registry.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const artifactAbi = (name: string): Abi => (JSON.parse(readFileSync(resolve(repoRoot, `contracts/out/${name}.sol/${name}.json`), "utf8")) as { abi: Abi }).abi;
const walletAbi = artifactAbi("GuardianWallet");
const ledgerAbi = artifactAbi("DemoLedger");
const actions = ["PAY", "REQUEST_APPROVAL", "SAVE_TO_SAVINGS", "PAY_SERVICE_FEE"] as const;

// Synthetic, unowned addresses used only inside evidence fixtures.
export const evidenceContacts = {
  ana: getAddress("0x00000000000000000000000000000000000000c1"),
  bob: getAddress("0x00000000000000000000000000000000000000c2"),
} as const;

export type EvidenceEvent = { contract: string; address: Address; name: string; args: Record<string, string | boolean> };
export type EvidenceTx = {
  scenario: string;
  label: string;
  hash: Hex;
  blockNumber: number;
  blockHash: Hex;
  transactionIndex: number;
  timestamp: string;
  from: Address;
  fromRole: string;
  to: Address | null;
  toRole: string;
  contractAddress: Address | null;
  call: string;
  status: "success" | "reverted";
  gasUsed: string;
  /** Zero and non-zero calldata bytes; EVM chains price them at 4 and 16 gas, FISCO BCOS does not. */
  inputBytes: { zero: number; nonzero: number };
  events: EvidenceEvent[];
  result: string;
};
export type EvidenceScenario = { id: string; title: string; expectation: string; passed: boolean; detail: string; transactions: Hex[] };
export type EvidenceRun = {
  generatedAt: string;
  network: { backend: string; chainId: number; rpcUrl: string; clientVersion: string; firstBlock: number; lastBlock: number };
  roles: { owner: Address; agent: Address; contacts: Record<string, Address> };
  scenarios: EvidenceScenario[];
  transactions: EvidenceTx[];
  rawReceipts: Record<Hex, unknown>;
  rawTransactions: Record<Hex, unknown>;
};

type Recorder = { label(hash: string | undefined, label: string): void };
type ScenarioBody = (recorder: Recorder) => Promise<{ passed: boolean; detail: string }>;

/**
 * Executes the evidence scenarios on the configured local chain and records every transaction
 * the owner and agent identities send in each scenario's block range, with receipts and events.
 */
export class EvidenceRunner {
  private readonly executor: AttackExecutor;
  private readonly lab: AttackLab;
  private readonly roles = new Map<string, string>();
  private readonly contracts = new Map<string, string>();
  private readonly counters = { GuardianWallet: 0, DemoLedger: 0 };

  constructor(private readonly config: Config, private readonly environment: NodeJS.ProcessEnv, private readonly log: (line: string) => void = () => undefined) {
    this.executor = AttackExecutor.create(config, environment);
    this.lab = new AttackLab(config, environment, { executor: this.executor });
    this.roles.set(this.executor.ownerAddress.toLowerCase(), "owner");
    this.roles.set(this.executor.agentAddress.toLowerCase(), "agent");
    this.roles.set("0x00000000000000000000000000000000000000f3", "fee account");
    this.roles.set("0x000000000000000000000000000000000000dead", "outside address");
    for (const [id, address] of Object.entries(evidenceContacts)) this.roles.set(address.toLowerCase(), `contact ${id}`);
  }

  async run(): Promise<EvidenceRun> {
    const client = this.executor.publicClient;
    const firstBlock = Number(await client.getBlockNumber({ cacheTime: 0 })) + 1;
    const scenarios: EvidenceScenario[] = [];
    const transactions: EvidenceTx[] = [];
    const rawReceipts: EvidenceRun["rawReceipts"] = {};
    const rawTransactions: EvidenceRun["rawTransactions"] = {};
    let core: { fixture: AttackFixture; pipeline: AgentPipeline } | undefined;
    const coreSetup = async () => core ??= await this.coreFixture();

    const definitions: Array<[string, string, string, ScenarioBody]> = [
      ["E01", "Deployment and seeding", "GuardianWallet and DemoLedger deployed, ledger controller set, demo units minted, two contacts allowlisted", async () => {
        const { fixture } = await coreSetup();
        return { passed: true, detail: `GuardianWallet ${fixture.deployment.guardianWallet}, DemoLedger ${fixture.deployment.demoLedger}` };
      }],
      ["E02", "T1 payment", "Agent pipeline executes 50 USD to ana autonomously; PaymentCompleted", async (recorder) => {
        const result = await (await coreSetup()).pipeline.run(intake("Pay ana 50 USD"));
        recorder.label(result.transactionHash, "Agent pay(ana, 50 USD) after firewall, pre-check, simulation, risk, tier gate");
        return expectRoute(result, "EXECUTED", "T1");
      }],
      ["E03", "T2 pending, owner approval, execution", "250 USD becomes a pending approval; the owner's approve() executes it", async (recorder) => {
        const { fixture, pipeline } = await coreSetup();
        const result = await pipeline.run(intake("Pay ana 250 USD"));
        recorder.label(result.transactionHash, "Agent requestApproval(ana, 250 USD)");
        const routed = expectRoute(result, "NEEDS_APPROVAL", "T2");
        if (!routed.passed || !result.pendingId) return routed;
        const approval = await fixture.owner({ kind: "approve", pendingId: BigInt(result.pendingId) });
        recorder.label(approval.transactionHash, `Owner approve(#${result.pendingId}) executes the payment`);
        return { passed: approval.status === "success", detail: `pending #${result.pendingId} approved and executed` };
      }],
      ["E04", "Savings deposit", "Agent pipeline moves 100 USD into savings; SavingsFunded", async (recorder) => {
        const result = await (await coreSetup()).pipeline.run(intake("Save 100 USD"));
        recorder.label(result.transactionHash, "Agent saveToSavings(100 USD)");
        return expectRoute(result, "EXECUTED", "T1");
      }],
      ["E05", "Service fee", "Agent pays a 0.05 USD service fee from its separate budget; ServiceFeePaid", async (recorder) => {
        const evidence = await (await coreSetup()).fixture.agent({ kind: "service_fee", amount: 50_000n, intentId: intent("E05") });
        recorder.label(evidence.transactionHash, "Agent payServiceFee(0.05 USD)");
        return { passed: evidence.status === "success" && evidence.violations.length === 0, detail: evidence.violations.join(", ") || "fee paid" };
      }],
      ["E06", "Over-limit refusal", "600 USD is refused by the contract with PolicyViolation(OVER_PER_TX_LIMIT)", async (recorder) => {
        const result = await (await coreSetup()).pipeline.run(intake("Pay ana 600 USD"));
        recorder.label(result.transactionHash, "Agent requestApproval(ana, 600 USD) refused");
        const passed = result.route === "BLOCKED" && (result.flags ?? []).includes("OVER_PER_TX_LIMIT") && Boolean(result.transactionHash);
        return { passed, detail: `${result.route}: ${(result.flags ?? []).join(", ")}` };
      }],
      ["E07", "Pause and unpause", "Owner pauses; a payment is refused with PAUSED; owner unpauses; the next payment executes", async (recorder) => {
        const { fixture, pipeline } = await coreSetup();
        const pause = await fixture.owner({ kind: "pause" });
        recorder.label(pause.transactionHash, "Owner pause()");
        const paused = await pipeline.run(intake("Pay bob 20 USD"));
        recorder.label(paused.transactionHash, "Agent pay(bob, 20 USD) while paused");
        const resume = await fixture.owner({ kind: "unpause" });
        recorder.label(resume.transactionHash, "Owner unpause()");
        const after = await pipeline.run(intake("Pay bob 20 USD"));
        recorder.label(after.transactionHash, "Agent pay(bob, 20 USD) after resume");
        const passed = pause.status === "success" && (paused.flags ?? []).includes("PAUSED") && resume.status === "success" && after.route === "EXECUTED";
        return { passed, detail: `paused payment ${paused.route} (${(paused.flags ?? []).join(", ")}); after resume ${after.route}` };
      }],
      ...(["A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"] as AttackId[]).map((id): [string, string, string, ScenarioBody] => [
        `E-${id}`, `Attack Lab ${id}`, "Attack refused on-chain (fresh deployment per attack)", async (recorder) => {
          const result = await this.lab.run(id);
          labelAttack(recorder, result);
          return { passed: result.status === "BLOCKED", detail: `${result.title}: ${result.status} by ${result.blockedBy}; ${result.reason}` };
        },
      ]),
    ];

    for (const [id, title, expectation, body] of definitions) {
      this.log(`${id} ${title}`);
      const start = await client.getBlockNumber({ cacheTime: 0 });
      const labels = new Map<string, string>();
      const outcome = await body({ label: (hash, label) => { if (hash) labels.set(hash.toLowerCase(), label); } });
      const end = await client.getBlockNumber({ cacheTime: 0 });
      const collected = await this.collect(id, start + 1n, end, labels, rawReceipts, rawTransactions);
      transactions.push(...collected);
      const captured = new Set(collected.map((tx) => tx.hash.toLowerCase()));
      const missing = [...labels.keys()].filter((hash) => !captured.has(hash));
      if (missing.length) { outcome.passed = false; outcome.detail += `; ${missing.length} labelled transaction(s) outside the recorded block range`; }
      scenarios.push({ id, title, expectation, passed: outcome.passed, detail: outcome.detail, transactions: collected.map((tx) => tx.hash) });
      this.log(`  ${outcome.passed ? "ok" : "FAILED"}: ${collected.length} transactions; ${outcome.detail}`);
    }

    return {
      generatedAt: new Date().toISOString(),
      network: {
        backend: this.config.CHAIN_BACKEND, chainId: this.config.CHAIN_ID, rpcUrl: this.config.RPC_URL,
        clientVersion: await client.request({ method: "web3_clientVersion" }) as string,
        firstBlock, lastBlock: Number(await client.getBlockNumber({ cacheTime: 0 })),
      },
      roles: { owner: this.executor.ownerAddress, agent: this.executor.agentAddress, contacts: { ...evidenceContacts } },
      scenarios, transactions, rawReceipts, rawTransactions,
    };
  }

  private async coreFixture() {
    const fixture = await this.executor.fixture({ allowlist: Object.entries(evidenceContacts).map(([id, address]) => ({ address, label: `${id} · synthetic contact` })) });
    const pipelineConfig: Config = { ...this.config, LLM_PROVIDER: "mock", DEPLOYMENTS_FILE: "evidence", AUDIT_DB_PATH: ":memory:" };
    delete pipelineConfig.RISK_INTEL_URL;
    const pipeline = new AgentPipeline(pipelineConfig, fixture.deployment, this.executor.publicClient, new AuditLog(":memory:"), evidenceContacts, this.environment, new MockAdapter());
    return { fixture, pipeline };
  }

  private async collect(scenario: string, from: bigint, to: bigint, labels: Map<string, string>, rawReceipts: EvidenceRun["rawReceipts"], rawTransactions: EvidenceRun["rawTransactions"]): Promise<EvidenceTx[]> {
    const client = this.executor.publicClient;
    const output: EvidenceTx[] = [];
    for (let number = from; number <= to; number += 1n) {
      const block = await client.request({ method: "eth_getBlockByNumber", params: [`0x${number.toString(16)}`, true] }) as RawBlock;
      for (const tx of block.transactions) {
        const sender = this.roles.get(tx.from.toLowerCase());
        if (sender !== "owner" && sender !== "agent") continue;
        if (tx.to !== null && !this.contracts.has(tx.to.toLowerCase())) continue; // not one of this run's contracts
        const receipt = await client.request({ method: "eth_getTransactionReceipt", params: [tx.hash] }) as RawReceipt;
        rawReceipts[tx.hash] = receipt;
        rawTransactions[tx.hash] = tx;
        if (receipt.contractAddress) this.registerContract(receipt.contractAddress, tx.input);
        output.push(await this.describe(scenario, tx, receipt, block, labels.get(tx.hash.toLowerCase())));
      }
    }
    return output;
  }

  private registerContract(address: Address, input: Hex) {
    const kind = input.includes(walletBytecodeMarker) ? "GuardianWallet" : "DemoLedger";
    this.counters[kind] += 1;
    this.contracts.set(address.toLowerCase(), `${kind} #${this.counters[kind]}`);
  }

  private async describe(scenario: string, tx: RawTx, receipt: RawReceipt, block: RawBlock, label: string | undefined): Promise<EvidenceTx> {
    const toRole = tx.to ? this.contracts.get(tx.to.toLowerCase()) ?? this.role(tx.to) : `create ${this.contracts.get(receipt.contractAddress?.toLowerCase() ?? "") ?? "contract"}`;
    const call = tx.to ? describeCall(tx.input, (value) => this.role(value)) : "constructor";
    const events = receipt.logs.map((log) => decodeLog(log, this.contracts.get(log.address.toLowerCase()) ?? log.address, (value) => this.role(value)));
    const status = receipt.status === "0x1" ? "success" : "reverted";
    let result: string;
    if (status === "reverted") result = `REVERTED ${await this.revertReason(tx, receipt)}`;
    else {
      const violation = events.find((event) => event.name === "PolicyViolation");
      result = violation ? `BLOCKED ${violation.args.reason}` : events.length ? events.map((event) => event.name).join(", ") : "success";
    }
    return {
      scenario, label: label || defaultLabel(this.role(tx.from), call, toRole), hash: tx.hash,
      blockNumber: Number(BigInt(receipt.blockNumber)), blockHash: receipt.blockHash, transactionIndex: Number(BigInt(receipt.transactionIndex)),
      timestamp: new Date(Number(BigInt(block.timestamp)) * (BigInt(block.timestamp) > 100_000_000_000n ? 1 : 1_000)).toISOString(),
      from: getAddress(tx.from), fromRole: this.role(tx.from), to: tx.to ? getAddress(tx.to) : null, toRole,
      contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
      call, status, gasUsed: BigInt(receipt.gasUsed).toString(), inputBytes: countBytes(tx.input), events, result,
    };
  }

  private async revertReason(tx: RawTx, receipt: RawReceipt): Promise<string> {
    try {
      await this.executor.publicClient.call({ account: getAddress(tx.from), to: getAddress(tx.to!), data: tx.input, blockNumber: BigInt(receipt.blockNumber) });
      return "(no reason returned)";
    } catch (error) { return decodeRevertData(error, (value) => this.role(value)); }
  }

  private role(value: string): string {
    return this.contracts.get(value.toLowerCase()) ?? this.roles.get(value.toLowerCase()) ?? getAddress(value);
  }
}

type RawTx = { hash: Hex; from: Address; to: Address | null; input: Hex; nonce: Hex };
type RawLog = { address: Address; topics: [Hex, ...Hex[]]; data: Hex };
type RawReceipt = { blockHash: Hex; blockNumber: Hex; transactionIndex: Hex; status: Hex; gasUsed: Hex; contractAddress: Address | null; logs: RawLog[] };
type RawBlock = { hash: Hex; number: Hex; timestamp: Hex; transactions: RawTx[] };

// The GuardianWallet runtime contains the PolicyViolation event topic; the ledger's does not.
const walletBytecodeMarker = "cf9e3b382b036841700598f93be9792a2f5dc66e1e0f19927d973223b4ff2556";

function intake(message: string) { return { message, source: "trusted" as const, sourceRefs: ["evidence"] }; }
function intent(label: string): Hex { return keccak256(stringToHex(`evidence:${label}:${Date.now()}`)); }

function expectRoute(result: PipelineResult, route: PipelineResult["route"], tier: string) {
  const passed = result.route === route && result.tier === tier && Boolean(result.transactionHash);
  return { passed, detail: `${result.route} ${result.tier ?? ""}${result.flags?.length ? ` (${result.flags.join(", ")})` : ""}`.trim() };
}

function labelAttack(recorder: Recorder, result: AttackResult) {
  for (const step of result.steps) if (step.transactionHash) recorder.label(step.transactionHash, `${result.id}: ${step.detail}`);
  if (result.directProof) recorder.label(result.directProof.transactionHash, `${result.id}: ${result.directProof.detail}`);
}

function defaultLabel(from: string, call: string, to: string) {
  if (call === "constructor") return `${from[0]!.toUpperCase()}${from.slice(1)} deploys ${to.replace(/^create /, "")}`;
  return `${from[0]!.toUpperCase()}${from.slice(1)} ${call.split("(")[0]} on ${to}`;
}

function stringify(value: unknown, role: (value: string) => string): string | boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return role(value);
  // bytes3 currency codes (ISO 4217) decode as 0x + 6 hex digits; show the code itself.
  if (typeof value === "string" && /^0x[0-9a-fA-F]{6}$/.test(value)) { const code = fromCurrencyCode(value); if (/^[A-Z]{3}$/.test(code)) return code; }
  if (typeof value === "bigint" || typeof value === "number") return value.toString();
  if (Array.isArray(value)) return `(${value.map((item) => String(stringify(item, role))).join(", ")})`;
  if (value && typeof value === "object") return `(${Object.entries(value).map(([key, item]) => `${key}: ${String(stringify(item, role))}`).join(", ")})`;
  return String(value);
}

export function decodeLog(log: RawLog, contract: string, role: (value: string) => string): EvidenceEvent {
  for (const abi of [walletAbi, ledgerAbi]) {
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      const args: Record<string, string | boolean> = {};
      for (const [key, value] of Object.entries((decoded.args ?? {}) as Record<string, unknown>)) args[key] = stringify(value, role);
      if (decoded.eventName === "PolicyViolation") {
        args.reason = policyReasons[Number(args.reason)] ?? String(args.reason);
        args.action = actions[Number(args.action)] ?? String(args.action);
      }
      if (typeof args.amount === "string" && /^[0-9]+$/.test(args.amount) && decoded.eventName !== "PolicyUpdated") args.amount = formatUnits(BigInt(args.amount));
      return { contract, address: getAddress(log.address), name: decoded.eventName ?? "unknown", args };
    } catch { /* try the next ABI */ }
  }
  return { contract, address: getAddress(log.address), name: `unknown(${log.topics[0].slice(0, 10)})`, args: {} };
}

function describeCall(input: Hex, role: (value: string) => string): string {
  for (const [name, abi] of [["GuardianWallet", walletAbi], ["DemoLedger", ledgerAbi]] as const) {
    try {
      const decoded = decodeFunctionData({ abi, data: input });
      return `${decoded.functionName}(${(decoded.args ?? []).map((arg) => String(stringify(arg, role))).join(", ")})`;
    } catch { if (name === "DemoLedger") return `call ${input.slice(0, 10)}`; }
  }
  return `call ${input.slice(0, 10)}`;
}

function decodeRevertData(error: unknown, role: (value: string) => string): string {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const data = (current as { data?: unknown }).data;
    const hex = typeof data === "string" ? data : typeof (data as { data?: unknown } | undefined)?.data === "string" ? (data as { data: string }).data : undefined;
    if (hex?.startsWith("0x") && hex.length >= 10) {
      for (const abi of [walletAbi, ledgerAbi]) {
        try {
          const decoded = decodeErrorResult({ abi, data: hex as Hex });
          return `${decoded.errorName}(${(decoded.args ?? []).map((arg) => String(stringify(arg, role))).join(", ")})`;
        } catch { /* next */ }
      }
      return `revert ${hex.slice(0, 10)}`;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return "execution reverted";
}

function countBytes(input: Hex) {
  let zero = 0;
  let nonzero = 0;
  for (let index = 2; index < input.length; index += 2) { if (input.slice(index, index + 2) === "00") zero += 1; else nonzero += 1; }
  return { zero, nonzero };
}

function formatUnits(value: bigint): string {
  const fraction = (value % UNIT).toString().padStart(6, "0").replace(/0+$/, "");
  return `${value / UNIT}${fraction ? `.${fraction}` : ""}`;
}
