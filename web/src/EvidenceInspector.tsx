import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Ban, CircleCheck, FileX2, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { Chip, Empty, ErrorState, PageHeader, SkeletonRows, TERMS, Term, TierBadge, statusWord } from "./ui";

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

type TabKey = "executed" | "refusals" | "offChain";
const tabs: Array<{ key: TabKey; label: string; testId: string; hint: string }> = [
  { key: "executed", label: "Done", testId: "group-executed", hint: "Transactions that ran on the chain and moved or recorded something." },
  { key: "refusals", label: "Refused on-chain", testId: "group-refusals", hint: "The wallet contract refused these: each is a reverted transaction or a recorded refusal event, with a hash." },
  { key: "offChain", label: "Blocked before the chain", testId: "group-offchain", hint: "Stopped by the AI firewall or the permission check before anything was signed. There is no transaction, so no hash: the proof is the audit-log entry." },
];

export function EvidenceInspector({ api }: { api: Api }) {
  const [data, setData] = useState<EvidenceInspection>();
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("executed");
  const load = useCallback(async () => {
    try { setData(await api<EvidenceInspection>("/evidence")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Evidence unavailable"); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const logs = Object.values(data?.auditLogs ?? {});
  const counts: Record<TabKey, number> = { executed: data?.totals.executed ?? 0, refusals: data?.totals.refusals ?? 0, offChain: data?.totals.offChain ?? 0 };
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = tabs.findIndex((item) => item.key === tab);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    setTab(next.key);
    document.getElementById(`tab-${next.key}`)?.focus();
  }
  return <div className="space-y-6">
    <PageHeader lead="Every money movement is recorded on our FISCO BCOS chain. Press Verify to check it yourself.">Every money movement is recorded on our FISCO BCOS chain. Press Verify to check it yourself.</PageHeader>
    {data && <p data-testid="evidence-network" className="-mt-4 text-small text-muted">{data.network.backend === "fisco" ? "FISCO BCOS" : data.network.backend} · chain ID {data.network.chainId} · blocks {data.network.firstBlock}–{data.network.lastBlock} · exported {new Date(data.generatedAt).toLocaleString()}</p>}
    <div role="note" className="flex gap-3 rounded-card border border-[color-mix(in_srgb,var(--color-cobalt)_25%,transparent)] bg-cobalt-soft px-5 py-4 text-body text-fg">
      <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-cobalt" /><p data-testid="evidence-info">{EVIDENCE_INFO}</p>
    </div>
    {error && <ErrorState message={`Could not load the evidence: ${error}`} retry={() => void load()} />}
    {!data && !error && <div className="grid gap-6 md:grid-cols-4">{[0, 1, 2, 3].map((key) => <div key={key} className="card"><SkeletonRows rows={2} /></div>)}</div>}
    {data && <>
      <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Tile label="Done" value={data.totals.executed} sub="Ran on the chain, with a receipt" testId="total-executed" icon={<CircleCheck aria-hidden className="size-4 text-ok" />} />
        <Tile label="Refused on-chain" value={data.totals.refusals} sub="Refused by the wallet contract, each with a hash" testId="total-refusals" icon={<Ban aria-hidden className="size-4 text-bad" />} />
        <Tile label="Blocked before the chain" value={data.totals.offChain} sub="Stopped before signing; audit-log record, no hash" testId="total-offchain" icon={<ShieldCheck aria-hidden className="size-4 text-cobalt" />} />
        <Tile label="Independent re-checks" value={modeSummary(data.verification)} sub={`Mode (a): original hashes on all nodes · mode (b): fresh replay · ${logs.filter((log) => log.valid).length} of ${logs.length} audit logs verify`} testId="total-verification" />
      </section>
      <p data-testid="currency-disclaimer" className="text-small text-muted">{CNY_DISCLAIMER}</p>

      <section className="card">
        <div role="tablist" aria-label="Evidence groups" className="flex flex-wrap gap-2 border-b border-line pb-4">
          {tabs.map((item) => <button key={item.key} id={`tab-${item.key}`} role="tab" type="button" aria-selected={tab === item.key} aria-controls={`panel-${item.key}`} tabIndex={tab === item.key ? 0 : -1} onKeyDown={onTabKey} onClick={() => setTab(item.key)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-control border px-4 text-body font-medium transition-colors ${tab === item.key ? "border-cobalt bg-cobalt-soft text-cobalt-strong" : "border-line bg-surface text-fg2 hover:bg-subtle"}`}>
            {item.label}<span className="rounded-full bg-surface px-2 text-small tabular-nums text-fg2">{counts[item.key]}</span>
          </button>)}
        </div>
        {tabs.map((item) => <div key={item.key} id={`panel-${item.key}`} role="tabpanel" aria-labelledby={`tab-${item.key}`} hidden={tab !== item.key} data-testid={item.testId} className="pt-4">
          <p className="mb-4 text-body text-fg2">{item.hint}</p>
          <GroupBody kind={item.key} scenarios={data.scenarios} api={api} />
        </div>)}
      </section>
    </>}
  </div>;
}

function GroupBody({ kind, scenarios, api }: { kind: TabKey; scenarios: InspectedScenario[]; api: Api }) {
  const shown = scenarios.filter((scenario) => scenario[kind].length > 0);
  if (shown.length === 0) return <Empty icon={FileX2} text={kind === "executed" ? "No transactions in this export yet." : kind === "refusals" ? "No on-chain refusals in this export." : "No off-chain blocks in this export."} />;
  return <div className="space-y-3">{shown.map((scenario, index) => <ScenarioBlock key={scenario.id} scenario={scenario} count={scenario[kind].length} open={kind === "offChain" || (kind === "refusals" && index === 0)}>
    {kind === "offChain" ? scenario.offChain.map((block) => <BlockCard key={`${block.log}-${block.entryId}`} block={block} />) : scenario[kind].map((tx) => <TxCard key={tx.hash} tx={tx} api={api} />)}
  </ScenarioBlock>)}</div>;
}

function modeSummary(verification: EvidenceInspection["verification"]): string {
  const mark = (result?: ModeResult) => result ? (result.passed ? "passed" : "failed") : "not run";
  return `(a) ${mark(verification.running)} · (b) ${mark(verification.fresh)}`;
}

function Tile({ label, value, sub, testId, icon }: { label: string; value: number | string; sub: string; testId: string; icon?: ReactNode }) {
  return <div className="card"><p className="label inline-flex items-center gap-2">{icon}{label}</p><p data-testid={testId} className={`figure mt-2 ${typeof value === "string" ? "text-heading" : "text-figure"}`}>{value}</p><p className="mt-1 text-small text-muted">{sub}</p></div>;
}

function ScenarioBlock({ scenario, count, open, children }: { scenario: InspectedScenario; count: number; open: boolean; children: ReactNode }) {
  return <details data-testid={`scenario-${scenario.id}`} open={open} className="rounded-control border border-line">
    <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-body"><b className="mono text-fg">{scenario.id}</b><span className="font-medium">{scenario.title}</span><span className="text-muted">{count} {count === 1 ? "record" : "records"}</span>
      <span className="ml-auto">{scenario.passed ? <Chip tone="ok" icon={CircleCheck}>As expected</Chip> : <Chip tone="bad" icon={TriangleAlert}>Not as expected</Chip>}</span></summary>
    <div className="space-y-3 border-t border-line p-4"><p className="text-small text-muted">{scenario.detail}</p>{children}</div>
  </details>;
}

const field = (label: ReactNode, value: ReactNode, testId: string, mono = false) => <div className="min-w-0"><dt className="label">{label}</dt><dd data-testid={testId} className={`break-all text-body font-medium ${mono ? "mono" : ""}`}>{value}</dd></div>;
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
  const tone = verify?.state === "match" ? "chip-ok" : verify?.state === "busy" ? "chip-neutral" : "chip-bad";
  const decisionWord = tx.decision.source === "agent pipeline" ? `AI decision: ${statusWord(tx.decision.outcome)}` : `Contract: ${statusWord(tx.decision.outcome)}`;
  return <article data-testid={`tx-${tx.hash}`} className="rounded-control border border-line bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-body font-medium">{tx.label}</p>
      {tx.refusal ? <span className="status-pill chip-bad"><Ban aria-hidden className="size-3.5" /><span data-testid="tx-status">{tx.status === "reverted" ? "Reverted" : "Refusal recorded"}</span></span>
        : <span className="status-pill chip-ok"><CircleCheck aria-hidden className="size-3.5" /><span data-testid="tx-status">Success</span></span>}</div>
    <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2">{field(<Term tip={TERMS.txHash}>Tx hash</Term>, tx.hash, "tx-hash", true)}</div>
      {field(<Term tip={TERMS.block}>Block</Term>, tx.blockNumber, "tx-block", true)}
      {field("Chain ID", tx.chainId, "tx-chain", true)}
      <div className="sm:col-span-2">{field("Contract", <>{tx.contractRole} <span className="mono font-normal text-muted">{tx.contractAddress ?? "—"}</span></>, "tx-contract")}</div>
      {field("Function", tx.functionName, "tx-function", true)}
      {field(<Term tip={TERMS.receipt}>Receipt status</Term>, tx.status, "tx-status-raw", true)}
      <div className="sm:col-span-2 lg:col-span-4">
        <dt className="label">Policy decision</dt>
        <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-body font-medium"><span>{decisionWord}</span>{tx.decision.tier && <span className="inline-flex items-center gap-1.5 text-fg2">· Permission: <TierBadge tier={tx.decision.tier} /></span>}
          <code data-testid="tx-decision" className="code-tag">{`${tx.decision.source === "agent pipeline" ? "Agent pipeline" : "Contract"}: ${tx.decision.outcome}${tx.decision.tier ? ` · ${tx.decision.tier}` : ""} · ${tx.decision.rule}`}</code></dd>
      </div>
    </dl>
    <p className="label mt-3">Decoded events</p>
    {tx.events.length ? <ul data-testid="tx-events" className="mt-1 space-y-1 break-all font-mono text-small">{tx.events.map((event, index) => <li key={index}><span className="text-muted">{event.contract}</span> {eventText(event)}</li>)}</ul> : <p data-testid="tx-events" className="mt-1 text-small text-muted">No events{tx.status === "reverted" ? `; reverted with ${tx.refusal ?? "no reason"}` : ""}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <span className="inline-flex items-center gap-1"><button data-testid="tx-verify" onClick={() => void check()} disabled={verify?.state === "busy"} className="secondary-button"><ShieldCheck aria-hidden className="size-4" />Verify</button></span>
      {verify && <span data-testid="tx-verify-result" className={`status-pill whitespace-normal ${tone}`}>{verify.text}</span>}
    </div>
  </article>;
}

/** An off-chain block has no transaction, so no hash or block is shown; its record is the audit entry. */
function BlockCard({ block }: { block: InspectedBlock }) {
  const layer = block.layer === "firewall" ? "Stopped by the AI firewall" : block.layer === "tier gate" ? "Stopped by the permission check" : `Stopped by the ${block.layer}`;
  return <article data-testid={`offchain-${block.log}-${block.entryId}`} className="rounded-control border border-line bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="inline-flex flex-wrap items-center gap-2 text-body font-medium"><ShieldCheck aria-hidden className="size-4 text-cobalt" />{layer}<code className="code-tag">{block.rule}</code></p>
      <span className="inline-flex items-center gap-2"><Chip tone="bad" icon={Ban}>{statusWord(block.outcome)}</Chip>{block.tier && <TierBadge tier={block.tier} />}</span>
    </div>
    <p className="mt-1 text-body text-fg2">{block.reason}</p>
    <p data-testid="offchain-no-tx" className="mt-2 inline-flex items-center gap-1 text-small font-medium text-muted">No transaction: nothing was sent to the chain, so there is no hash.</p>
    <p className="label mt-3 inline-flex items-center gap-1">Audit-log record</p>
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

