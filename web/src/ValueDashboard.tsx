import { useCallback, useEffect, useState } from "react";
import { Ban, CircleCheck } from "lucide-react";
import { Empty, ErrorState, PageHeader, SkeletonRows } from "./ui";

type Metric = { value: number; numerator?: number; denominator?: number; target?: string; pass?: boolean; unit: string };
type EvalSummary = {
  generatedAt: string; backend: string; chainId: number; commit: string; llm: { requested: string; effective: string };
  scenarioCount: number; bySuite: Record<string, { total: number; succeeded: number }>; metrics: Record<string, Metric>; targetsMet: boolean;
  scenarios: Array<{ id: string; suite: string; title: string; success: boolean; unsafe: boolean; latencyMs: number; minutesSaved?: number }>;
};
type Live = {
  decisions: number; routes: Record<string, number>; ownerApprovals: number; pauses: number;
  currencies: Array<{ code: string; name: string; disclaimer?: string }>;
  movedOut: Record<string, string>; savedToSavings: Record<string, string>; blockedValue: Record<string, string>;
  attackLab: { runs: number; blocked: number }; estimatedMinutesSaved: number; lastActivity: string | null;
};
type HistoryRow = { label: string; generatedAt: string; commit: string; suite: string; llm: string; scenarioCount: number; taskSuccess: Metric; unsafeActionRate: Metric; attackBlockRate: Metric; clarificationAccuracy: Metric; failedIds: string[] };
export type ValueResponse = { eval: EvalSummary | null; history?: HistoryRow[]; live: Live };
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

const pct = (metric?: Metric) => metric ? `${(metric.value * 100).toFixed(metric.value === 1 || metric.value === 0 ? 0 : 1)}%` : "—";
const ratio = (metric?: Metric) => metric?.numerator !== undefined ? `${metric.numerator} of ${metric.denominator}` : "";
const suiteLabel: Record<string, string> = { normal: "Owner tasks", clarification: "Ambiguous requests", attack: "Chat attacks", "attack-lab": "Attack Lab", heldout: "Held-out (docs only)" };
/** "150 USD · 0 CNY", optionally without one code. */
const perCurrency = (values: Record<string, string>, except?: string) => Object.entries(values).filter(([code]) => code !== except).map(([code, value]) => `${value} ${code}`).join(" · ");
const minutes = (value: number) => value >= 60 ? `${(value / 60).toFixed(1)} h` : `${value.toFixed(1)} min`;

export function ValueDashboard({ api }: { api: Api }) {
  const [data, setData] = useState<ValueResponse | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await api<ValueResponse>("/value")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Value metrics unavailable"); }
  }, [api]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 5_000); return () => clearInterval(timer); }, [load]);
  const run = data?.eval ?? null;
  const live = data?.live;
  const m = run?.metrics ?? {};

  return <div className="space-y-6">
    <PageHeader lead="How well the AI did on its test scenarios, and what it has done live." action={run && <span data-testid="eval-verdict" className={`status-pill ${run.targetsMet ? "chip-ok" : "chip-bad"}`}>{run.targetsMet ? <CircleCheck aria-hidden className="size-3.5" /> : <Ban aria-hidden className="size-3.5" />}{run.targetsMet ? "All targets met" : "Targets missed"}</span>}>Results from the latest <code>pnpm eval</code> run on the chain, plus live counts from the audit log. Demo units only; time saved is an estimate.</PageHeader>
    {error && <ErrorState message={error} retry={() => void load()} />}
    {!data && !error && <div className="grid gap-6 md:grid-cols-4">{[0, 1, 2, 3].map((key) => <div key={key} className="card"><SkeletonRows rows={2} /></div>)}</div>}

    {run ? <>
      <section data-testid="eval-targets" className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Target label="Task success" metric={m.taskSuccess} />
        <Target label="Unsafe action rate" metric={m.unsafeActionRate} />
        <Target label="Attack block rate" metric={m.attackBlockRate} />
        <Tile label="Average latency" value={`${m.averageLatencyMs?.value ?? "—"} ms`} sub={`p95 ${m.p95LatencyMs?.value ?? "—"} ms over ${m.averageLatencyMs?.denominator ?? 0} agent requests, including on-chain confirmation`} />
      </section>
      <section className="grid gap-6 md:grid-cols-2">
        <Tile label="Clarification accuracy" value={pct(m.clarificationAccuracy)} sub={`${ratio(m.clarificationAccuracy)} ambiguous requests got a targeted question · ${pct(m.falseClarificationRate)} false questions on clear tasks`} />
        <Tile label="Estimated time saved" value={minutes(m.estimatedMinutesSaved?.value ?? 0)} sub={`${m.estimatedMinutesSavedPerTask?.value ?? 0} min per owner task vs doing it by hand (${m.estimatedMinutesSaved?.denominator ?? 0} tasks)`} />
      </section>
      <section className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="section-title">{run.scenarioCount} evaluation scenarios</h2>
          <p className="text-small text-muted">{new Date(run.generatedAt).toLocaleString()} · {run.backend} (chain {run.chainId}) · commit <span className="mono">{run.commit}</span> · {run.llm.effective} proposals</p>
        </div>
        <table className="mt-4 w-full text-body">
          <thead className="table-head"><tr><th>Suite</th><th className="text-right">Succeeded</th><th className="text-right">Total</th><th className="w-1/3">Pass rate</th></tr></thead>
          <tbody>{Object.entries(run.bySuite).map(([suite, value]) => <tr key={suite} className="table-row">
            <td className="font-medium">{suiteLabel[suite] ?? suite}</td><td className="text-right figure">{value.succeeded}</td><td className="text-right text-fg2">{value.total}</td>
            <td><div className="flex items-center gap-3"><div aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-subtle"><div className={value.succeeded === value.total ? "h-2 bg-ok" : "h-2 bg-warn"} style={{ width: `${value.total ? (value.succeeded / value.total) * 100 : 0}%` }} /></div><span className="w-12 text-right text-small tabular-nums text-fg2">{value.total ? Math.round((value.succeeded / value.total) * 100) : 0}%</span></div></td>
          </tr>)}</tbody>
        </table>
        <p className="label mt-5">Scenarios</p>
        <div data-testid="eval-scenarios" className="mt-2 flex flex-wrap gap-1.5">
          {run.scenarios.map((scenario) => <span key={scenario.id} title={`${scenario.title} · ${scenario.latencyMs} ms`} className={`status-pill font-mono ${scenario.success ? "chip-ok" : "chip-bad"}`}>{scenario.success ? <CircleCheck aria-hidden className="size-3" /> : <Ban aria-hidden className="size-3" />}{scenario.id}{scenario.unsafe ? " · unsafe" : ""}</span>)}
        </div>
      </section>
      {data?.history && data.history.length > 0 && <section data-testid="eval-history" className="card">
        <h2 className="section-title">Run history</h2>
        <p className="mt-1 text-small text-muted">Labelled runs from <code>eval/history.json</code>; rows are added, never replaced.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-body">
          <thead className="table-head"><tr><th>Run</th><th>Scenarios</th><th>Task success</th><th>Unsafe</th><th>Attacks blocked</th><th>Clarification</th><th>Failed</th></tr></thead>
          <tbody>{data.history.map((row) => <tr key={`${row.label}-${row.generatedAt}`} className="table-row">
            <td className="font-medium">{row.label}<span className="block text-small font-normal text-muted">{new Date(row.generatedAt).toLocaleString()} · commit <span className="mono">{row.commit}</span> · {row.llm}</span></td>
            <td>{row.scenarioCount}</td><td>{pct(row.taskSuccess)} <span className="text-small text-muted">{ratio(row.taskSuccess)}</span></td>
            <td>{pct(row.unsafeActionRate)}</td><td>{pct(row.attackBlockRate)} <span className="text-small text-muted">{ratio(row.attackBlockRate)}</span></td>
            <td>{pct(row.clarificationAccuracy)}</td><td className="mono">{row.failedIds.length ? row.failedIds.join(", ") : "none"}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}
    </> : data && <Empty text="No evaluation results yet. Run pnpm eval to produce them." />}

    {live && <section data-testid="live-metrics" className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="section-title">Live from the audit log</h2>
        <p className="text-small text-muted">{live.lastActivity ? `Last entry ${new Date(live.lastActivity).toLocaleString()}` : "No entries yet"} · refreshes every 5 s</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Count label="Agent decisions" value={live.decisions} sub={`${live.routes.EXECUTED ?? 0} executed · ${live.routes.SCHEDULE_READY ?? 0} scheduled`} />
        <Count label="Sent for approval" value={live.routes.NEEDS_APPROVAL ?? 0} sub={`${live.ownerApprovals} approved by the owner`} />
        <Count label="Blocked" value={live.routes.BLOCKED ?? 0} sub={`${perCurrency(live.blockedValue)} stopped`} />
        <Count label="Clarifications" value={live.routes.ANSWER_ONLY ?? 0} sub="questions instead of guesses" />
        <Count label="Paid out" value={`${live.movedOut.USD ?? "0"} USD`} sub={perCurrency(live.movedOut, "USD") || "—"} />
        <Count label="Moved to savings" value={`${live.savedToSavings.USD ?? "0"} USD`} sub={perCurrency(live.savedToSavings, "USD") || "—"} />
        <Count label="Attack Lab runs blocked" value={`${live.attackLab.blocked}/${live.attackLab.runs}`} sub={`${live.pauses} kill-switch activations`} />
        <Count label="Estimated time saved" value={minutes(live.estimatedMinutesSaved)} sub="from executed, approval, and scheduled work" />
      </div>
      {live.currencies.filter((unit) => unit.disclaimer).map((unit) => <p key={unit.code} data-testid="currency-disclaimer" className="mt-4 text-small text-muted">{unit.disclaimer}</p>)}
    </section>}
  </div>;
}

function Target({ label, metric }: { label: string; metric?: Metric }) {
  return <div className="card">
    <div className="flex items-start justify-between gap-3">
      <p className="label">{label}</p>
      {metric?.pass !== undefined && <span className={`status-pill ${metric.pass ? "chip-ok" : "chip-bad"}`}>{metric.pass ? <CircleCheck aria-hidden className="size-3.5" /> : <Ban aria-hidden className="size-3.5" />}{metric.pass ? "met" : "missed"}</span>}
    </div>
    <p className="figure mt-2 text-display">{pct(metric)}</p>
    <p className="mt-1 text-small text-muted">{ratio(metric)} · target {metric?.target ?? "—"}</p>
  </div>;
}
function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="card"><p className="label">{label}</p><p className="figure mt-2 text-display">{value}</p><p className="mt-1 text-small text-muted">{sub}</p></div>;
}
function Count({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return <div className="rounded-control border border-line bg-subtle p-4"><p className="label">{label}</p><p className="figure mt-1 text-figure">{value}</p><p className="mt-1 text-small text-muted">{sub}</p></div>;
}
