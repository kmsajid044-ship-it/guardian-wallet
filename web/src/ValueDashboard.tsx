import { useCallback, useEffect, useState } from "react";

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

  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <p className="eyebrow">Outcome reporting</p>
        <h1 className="page-title">Evaluation</h1>
        <p className="mt-2 max-w-3xl text-slate-500">Evaluation results from the latest <code>pnpm eval</code> run, and live counts from the hash-chained audit log. Demo units only; time saved is an estimate.</p>
      </div>
      {run && <span data-testid="eval-verdict" className={`status-pill ${run.targetsMet ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"}`}>{run.targetsMet ? "All targets met" : "Targets missed"}</span>}
    </section>
    {error && <div className="rounded-xl bg-rose-50 p-4 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}

    {run ? <>
      <section data-testid="eval-targets" className="grid gap-4 md:grid-cols-3">
        <Target label="Task success" metric={m.taskSuccess} />
        <Target label="Unsafe action rate" metric={m.unsafeActionRate} />
        <Target label="Attack block rate" metric={m.attackBlockRate} />
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <Tile label="Clarification accuracy" value={pct(m.clarificationAccuracy)} sub={`${ratio(m.clarificationAccuracy)} ambiguous requests got a targeted question · ${pct(m.falseClarificationRate)} false questions on clear tasks`} />
        <Tile label="Average latency" value={`${m.averageLatencyMs?.value ?? "—"} ms`} sub={`p95 ${m.p95LatencyMs?.value ?? "—"} ms over ${m.averageLatencyMs?.denominator ?? 0} agent requests, including on-chain confirmation`} />
        <Tile label="Estimated time saved" value={minutes(m.estimatedMinutesSaved?.value ?? 0)} sub={`${m.estimatedMinutesSavedPerTask?.value ?? 0} min per owner task vs doing it by hand (${m.estimatedMinutesSaved?.denominator ?? 0} tasks)`} />
      </section>
      <section className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">{run.scenarioCount} evaluation scenarios</h2>
          <p className="text-sm text-slate-500">{new Date(run.generatedAt).toLocaleString()} · {run.backend} (chain {run.chainId}) · commit {run.commit} · {run.llm.effective} proposals</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(run.bySuite).map(([suite, value]) => <div key={suite} className="rounded-xl bg-slate-50 p-4 dark:bg-white/[.04]">
            <p className="text-sm font-semibold text-slate-500">{suiteLabel[suite] ?? suite}</p>
            <p className="mt-1 text-2xl font-bold">{value.succeeded}/{value.total}</p>
          </div>)}
        </div>
        <div data-testid="eval-scenarios" className="mt-4 flex flex-wrap gap-2">
          {run.scenarios.map((scenario) => <span key={scenario.id} title={`${scenario.title} · ${scenario.latencyMs} ms`} className={`status-pill ${scenario.success ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"}`}>{scenario.id}{scenario.unsafe ? " · unsafe" : ""}</span>)}
        </div>
      </section>
      {data?.history && data.history.length > 0 && <section data-testid="eval-history" className="card">
        <h2 className="text-lg font-bold">Run history</h2>
        <p className="mt-1 text-sm text-slate-500">Labelled runs from <code>eval/history.json</code>; rows are added, never replaced.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-slate-400"><tr><th className="py-2">Run</th><th>Scenarios</th><th>Task success</th><th>Unsafe</th><th>Attacks blocked</th><th>Clarification</th><th>Failed</th></tr></thead>
          <tbody>{data.history.map((row) => <tr key={`${row.label}-${row.generatedAt}`} className="border-t border-slate-100 dark:border-white/10">
            <td className="py-3 font-semibold">{row.label}<span className="block text-xs font-normal text-slate-500">{new Date(row.generatedAt).toLocaleString()} · commit {row.commit} · {row.llm}</span></td>
            <td>{row.scenarioCount}</td><td>{pct(row.taskSuccess)} <span className="text-xs text-slate-500">{ratio(row.taskSuccess)}</span></td>
            <td>{pct(row.unsafeActionRate)}</td><td>{pct(row.attackBlockRate)} <span className="text-xs text-slate-500">{ratio(row.attackBlockRate)}</span></td>
            <td>{pct(row.clarificationAccuracy)}</td><td className="font-mono text-xs">{row.failedIds.length ? row.failedIds.join(", ") : "none"}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}
    </> : data && <section className="card text-slate-500">No evaluation results yet. Run <code>pnpm eval</code> to produce them.</section>}

    {live && <section data-testid="live-metrics" className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">Live from the audit log</h2>
        <p className="text-sm text-slate-500">{live.lastActivity ? `Last entry ${new Date(live.lastActivity).toLocaleString()}` : "No entries yet"} · refreshes every 5 s</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Count label="Agent decisions" value={live.decisions} sub={`${live.routes.EXECUTED ?? 0} executed · ${live.routes.SCHEDULE_READY ?? 0} scheduled`} />
        <Count label="Sent for approval" value={live.routes.NEEDS_APPROVAL ?? 0} sub={`${live.ownerApprovals} approved by the owner`} />
        <Count label="Blocked" value={live.routes.BLOCKED ?? 0} sub={`${perCurrency(live.blockedValue)} stopped`} />
        <Count label="Clarifications" value={live.routes.ANSWER_ONLY ?? 0} sub="questions instead of guesses" />
        <Count label="Paid out" value={`${live.movedOut.USD ?? "0"} USD`} sub={perCurrency(live.movedOut, "USD") || "—"} />
        <Count label="Moved to savings" value={`${live.savedToSavings.USD ?? "0"} USD`} sub={perCurrency(live.savedToSavings, "USD") || "—"} />
        <Count label="Attack Lab runs blocked" value={`${live.attackLab.blocked}/${live.attackLab.runs}`} sub={`${live.pauses} kill-switch activations`} />
        <Count label="Estimated time saved" value={minutes(live.estimatedMinutesSaved)} sub="from executed, approval, and scheduled work" />
      </div>
      {live.currencies.filter((unit) => unit.disclaimer).map((unit) => <p key={unit.code} data-testid="currency-disclaimer" className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">{unit.disclaimer}</p>)}
    </section>}
  </div>;
}

function Target({ label, metric }: { label: string; metric?: Metric }) {
  return <div className="card">
    <div className="flex items-start justify-between gap-3">
      <p className="eyebrow">{label}</p>
      {metric?.pass !== undefined && <span className={`status-pill ${metric.pass ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"}`}>{metric.pass ? "met" : "missed"}</span>}
    </div>
    <p className="mt-3 text-4xl font-bold tracking-tight">{pct(metric)}</p>
    <p className="mt-3 text-sm text-slate-500">{ratio(metric)} · target {metric?.target ?? "—"}</p>
  </div>;
}
function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="card"><p className="eyebrow">{label}</p><p className="mt-3 text-3xl font-bold">{value}</p><p className="mt-3 text-sm text-slate-500">{sub}</p></div>;
}
function Count({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return <div className="rounded-xl bg-slate-50 p-4 dark:bg-white/[.04]"><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-slate-500">{sub}</p></div>;
}
