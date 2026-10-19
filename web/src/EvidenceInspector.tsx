import { useCallback, useEffect, useState, type ReactNode } from "react";

/** Mirrors agent/src/evidence/inspect.ts. Every value is read from evidence/evidence.json by the agent. */
type EvidenceEvent = { contract: string; address: string; name: string; args: Record<string, string | boolean> };
type InspectedTx = {
  hash: string; blockNumber: number; blockHash: string; chainId: number; label: string; fromRole: string;
  contractAddress: string | null; contractRole: string; functionName: string; call: string; status: "success" | "reverted";
  events: EvidenceEvent[]; result: string; refusal?: string;
  decision: { source: "agent pipeline" | "contract"; outcome: string; tier: string | null; rule: string };
};
type AuditEntry = { id: number; timestamp: string; kind: string; prevHash: string; hash: string };
type InspectedBlock = { scenario: string; log: string; entryId: number; entryHash: string; kind: string; outcome: string; tier: string | null; layer: string; rule: string; reason: string; audit: AuditEntry; chainValid: boolean };
type InspectedScenario = { id: string; title: string; expectation: string; passed: boolean; detail: string; executed: InspectedTx[]; refusals: InspectedTx[]; offChain: InspectedBlock[] };
type ModeResult = { verifiedAt: string; passed: boolean };
export type EvidenceInspection = {
  generatedAt: string;
  network: { backend: string; chainId: number; rpcUrl: string; clientVersion: string; firstBlock: number; lastBlock: number };
  totals: { executed: number; refusals: number; offChain: number };
  auditLogs: Record<string, { entries: number; valid: boolean }>;
  verification: { running?: ModeResult; fresh?: ModeResult & { scenariosMatched: number; scenarios: number } };
  scenarios: InspectedScenario[];
};
type VerifyResult = { match: boolean; problems: string[]; chainId: number; rpcUrl: string; receipt: { status: string; blockNumber: number } | null };
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export const EVIDENCE_INFO = "Permissioned FISCO BCOS network operated by the team. Hashes come from this network. Reviewers can re-verify with ./scripts/verify-evidence.sh --all. A fresh replay creates new hashes; mode (a) checks the original ones.";
const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";

export function EvidenceInspector({ api }: { api: Api }) {
  const [data, setData] = useState<EvidenceInspection>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await api<EvidenceInspection>("/evidence")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Evidence unavailable"); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const executed = data?.scenarios.filter((item) => item.executed.length) ?? [];
  const refusals = data?.scenarios.filter((item) => item.refusals.length) ?? [];
  const blocks = data?.scenarios.filter((item) => item.offChain.length) ?? [];
  const logs = Object.values(data?.auditLogs ?? {});
  return <div className="space-y-7">
    <section><p className="eyebrow">Execution evidence</p><h1 className="page-title">Evidence Inspector</h1>
      {data && <p data-testid="evidence-network" className="mt-2 text-slate-500 dark:text-slate-400">{data.network.backend === "fisco" ? "FISCO BCOS" : data.network.backend} · chain ID {data.network.chainId} · blocks {data.network.firstBlock}–{data.network.lastBlock} · exported {new Date(data.generatedAt).toLocaleString()}</p>}
    </section>
    <div data-testid="evidence-info" role="note" className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-6 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">{EVIDENCE_INFO}</div>
    {error && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{error}</div>}
    {data && <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Tile label="1 · Executed transactions" value={data.totals.executed} sub="Mined with status 1 and no refusal event" testId="total-executed" />
        <Tile label="2 · On-chain refusals" value={data.totals.refusals} sub="Reverted, or a recorded PolicyViolation event" testId="total-refusals" />
        <Tile label="3 · Off-chain blocks" value={data.totals.offChain} sub="Firewall, tier gate, or an allowlist read before signing; no transaction, audit record only" testId="total-offchain" />
        <Tile label="Recorded verification" value={modeSummary(data.verification)} sub={`${logs.filter((log) => log.valid).length} of ${logs.length} decision audit logs verify`} testId="total-verification" />
      </section>
      <p data-testid="currency-disclaimer" className="text-xs leading-5 text-slate-500 dark:text-slate-400">{CNY_DISCLAIMER}</p>
      <Group testId="group-executed" title="1 · Executed transactions" kicker={`${data.totals.executed} with receipts`} empty="No executed transactions in this export.">
        {executed.map((scenario) => <ScenarioBlock key={scenario.id} scenario={scenario} count={scenario.executed.length} open={false}>{scenario.executed.map((tx) => <TxCard key={tx.hash} tx={tx} api={api} />)}</ScenarioBlock>)}
      </Group>
      <Group testId="group-refusals" title="2 · On-chain refusals" kicker={`${data.totals.refusals} refused by the contract, each with a hash`} empty="No on-chain refusals in this export.">
        {refusals.map((scenario, index) => <ScenarioBlock key={scenario.id} scenario={scenario} count={scenario.refusals.length} open={index === 0}>{scenario.refusals.map((tx) => <TxCard key={tx.hash} tx={tx} api={api} />)}</ScenarioBlock>)}
      </Group>
      <Group testId="group-offchain" title="3 · Off-chain blocks" kicker={`${data.totals.offChain} stopped before signing; no hash exists`} empty="No off-chain blocks in this export.">
        {blocks.map((scenario) => <ScenarioBlock key={scenario.id} scenario={scenario} count={scenario.offChain.length} open>{scenario.offChain.map((block) => <BlockCard key={`${block.log}-${block.entryId}`} block={block} />)}</ScenarioBlock>)}
      </Group>
    </>}
  </div>;
}

function modeSummary(verification: EvidenceInspection["verification"]): string {
  const mark = (result?: ModeResult) => result ? (result.passed ? "passed" : "failed") : "not run";
  return `(a) ${mark(verification.running)} · (b) ${mark(verification.fresh)}`;
}

function Tile({ label, value, sub, testId }: { label: string; value: number | string; sub: string; testId: string }) {
  return <div className="card"><p className="eyebrow">{label}</p><p data-testid={testId} className="mt-3 text-3xl font-bold tracking-tight">{value}</p><p className="mt-2 text-sm text-slate-500">{sub}</p></div>;
}

function Group({ title, kicker, empty, testId, children }: { title: string; kicker: string; empty: string; testId: string; children: ReactNode[] }) {
  return <section data-testid={testId} className="card"><div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">{title}</h2><span className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">{kicker}</span></div>
    {children.length ? <div className="space-y-4">{children}</div> : <p className="text-sm text-slate-500">{empty}</p>}
  </section>;
}

function ScenarioBlock({ scenario, count, open, children }: { scenario: InspectedScenario; count: number; open: boolean; children: ReactNode }) {
  return <details data-testid={`scenario-${scenario.id}`} open={open} className="rounded-2xl border border-slate-200 dark:border-white/10">
    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"><b className="font-mono">{scenario.id}</b><span className="font-semibold">{scenario.title}</span><span className="text-slate-500">{count} {count === 1 ? "record" : "records"}</span><span className={`ml-auto status-pill ${scenario.passed ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"}`}>{scenario.passed ? "As expected" : "Not as expected"}</span></summary>
    <div className="space-y-3 border-t border-slate-200 p-4 dark:border-white/10"><p className="text-xs text-slate-500 dark:text-slate-400">{scenario.detail}</p>{children}</div>
  </details>;
}

const field = (label: string, value: ReactNode, testId: string, mono = false) => <div className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt><dd data-testid={testId} className={`break-all text-sm font-semibold ${mono ? "font-mono text-xs" : ""}`}>{value}</dd></div>;
const eventText = (event: EvidenceEvent) => `${event.name}(${Object.entries(event.args).map(([key, value]) => `${key}: ${String(value)}`).join(", ")})`;

function TxCard({ tx, api }: { tx: InspectedTx; api: Api }) {
  const [verify, setVerify] = useState<{ state: "busy" | "match" | "mismatch" | "error"; text: string }>();
  async function check() {
    setVerify({ state: "busy", text: "Fetching receipt from the node…" });
    try {
      const result = await api<VerifyResult>(`/evidence/verify/${tx.hash}`);
      setVerify(result.match
        ? { state: "match", text: `Match · receipt in block ${result.receipt?.blockNumber ?? "?"} on chain ${result.chainId}, equal to the export` }
        : { state: "mismatch", text: `Mismatch · ${result.problems.join("; ")}` });
    } catch (cause) { setVerify({ state: "error", text: cause instanceof Error ? cause.message : "Node unavailable" }); }
  }
  const tone = verify?.state === "match" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : verify?.state === "busy" ? "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300" : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200";
  return <article data-testid={`tx-${tx.hash}`} className="rounded-xl bg-slate-50 p-4 dark:bg-white/[.04]">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{tx.label}</p>
      <span data-testid="tx-status" className={`status-pill ${tx.refusal ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"}`}>{tx.status === "reverted" ? "Reverted" : tx.refusal ? "Refusal recorded" : "Success"}</span></div>
    <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2">{field("Tx hash", tx.hash, "tx-hash", true)}</div>
      {field("Block", tx.blockNumber, "tx-block")}
      {field("Chain ID", tx.chainId, "tx-chain")}
      <div className="sm:col-span-2">{field("Contract", <>{tx.contractRole} <span className="font-mono text-xs font-normal text-slate-500">{tx.contractAddress ?? "—"}</span></>, "tx-contract")}</div>
      {field("Function", tx.functionName, "tx-function", true)}
      {field("Status", tx.status, "tx-status-raw")}
      <div className="sm:col-span-2 lg:col-span-4">{field("Policy decision", `${tx.decision.source === "agent pipeline" ? "Agent pipeline" : "Contract"}: ${tx.decision.outcome}${tx.decision.tier ? ` · ${tx.decision.tier}` : ""} · ${tx.decision.rule}`, "tx-decision")}</div>
    </dl>
    <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Decoded events</p>
    {tx.events.length ? <ul data-testid="tx-events" className="mt-1 space-y-1 font-mono text-xs break-all">{tx.events.map((event, index) => <li key={index}><span className="text-slate-400">{event.contract}</span> {eventText(event)}</li>)}</ul> : <p data-testid="tx-events" className="mt-1 text-xs text-slate-500">No events{tx.status === "reverted" ? `; reverted with ${tx.refusal ?? "no reason"}` : ""}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3"><button data-testid="tx-verify" onClick={() => void check()} disabled={verify?.state === "busy"} className="secondary-button">Verify</button>{verify && <span data-testid="tx-verify-result" className={`status-pill ${tone}`}>{verify.text}</span>}</div>
  </article>;
}

/** An off-chain block has no transaction, so no hash or block is shown; its record is the audit entry. */
function BlockCard({ block }: { block: InspectedBlock }) {
  return <article data-testid={`offchain-${block.log}-${block.entryId}`} className="rounded-xl bg-slate-50 p-4 dark:bg-white/[.04]">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{block.layer} · {block.rule.replaceAll("_", " ")}</p><span className="status-pill bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">{block.outcome.replaceAll("_", " ")}{block.tier ? ` · ${block.tier}` : ""}</span></div>
    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{block.reason}</p>
    <p data-testid="offchain-no-tx" className="mt-2 text-xs font-semibold text-slate-500">No transaction: nothing was sent to the chain, so there is no hash.</p>
    <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Audit-log record</p>
    <dl className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {field("Log · entry", `${block.log} #${block.audit.id}`, "audit-entry")}
      {field("Kind", block.audit.kind, "audit-kind", true)}
      {field("Recorded", new Date(block.audit.timestamp).toLocaleString(), "audit-time")}
      {field("Hash chain", block.chainValid ? "Verifies" : "Broken", "audit-chain")}
      <div className="sm:col-span-2">{field("Entry hash (SHA-256)", block.audit.hash, "audit-hash", true)}</div>
      <div className="sm:col-span-2">{field("Previous entry hash", block.audit.prevHash, "audit-prev", true)}</div>
    </dl>
  </article>;
}
