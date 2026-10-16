import { useCallback, useEffect, useState } from "react";

type Step = { layer: string; outcome: string; detail: string; transactionHash?: string; blockNumber?: string; revert?: string };
type Proof = { transactionHash: string; blockNumber: string; status: string; detail: string };
export type Attack = {
  id: string; title: string; description?: string; status: "READY" | "BLOCKED" | "NOT_BLOCKED"; directProofRequired?: boolean;
  blockedBy?: string; reason?: string; backend?: string; transactionHash?: string; blockNumber?: string; revertRecord?: string;
  directProof?: Proof; steps?: Step[]; durationMs?: number;
};
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

const layerStyle: Record<string, string> = {
  firewall: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  "risk scorer": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  "tier gate": "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  "on-chain contract": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};
const statusStyle: Record<Attack["status"], string> = {
  READY: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  BLOCKED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  NOT_BLOCKED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
};
const proofLabel = (status: string) => status === "reverted" ? "reverted" : "contract returned BLOCKED";
const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-8)}`;

export function AttackLab({ api }: { api: Api }) {
  const [items, setItems] = useState<Attack[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setItems(await api<Attack[]>("/attack-lab")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Attack Lab unavailable"); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function run(id: string) {
    setBusy(id);
    try { const result = await api<Attack>(`/attack-lab/run/${id}`, { method: "POST", body: "{}" }); setItems((current) => current.map((item) => item.id === id ? result : item)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Scenario failed"); }
    finally { setBusy(""); }
  }
  async function runAll() {
    setBusy("all");
    try { setItems(await api<Attack[]>("/attack-lab/run-all", { method: "POST", body: "{}" })); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Scenarios failed"); }
    finally { setBusy(""); }
  }

  const ran = items.filter((item) => item.status !== "READY");
  const blocked = ran.filter((item) => item.status === "BLOCKED").length;
  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <p className="eyebrow">Adversarial safety harness</p>
        <h1 className="page-title">Attack Lab</h1>
        <p className="mt-2 max-w-3xl text-slate-500">Each scenario deploys a fresh wallet on the local permissioned chain, runs the attack through the agent pipeline, and where marked also sends it straight to the contract with the agent key. Demo units only.</p>
      </div>
      <button data-testid="run-all-attacks" onClick={() => void runAll()} disabled={!!busy} className="primary-button">{busy === "all" ? "Running all 11…" : "Run all 11"}</button>
    </section>
    {error && <div className="rounded-xl bg-rose-50 p-4 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}
    {ran.length > 0 && <section data-testid="attack-summary" className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">{blocked} of {ran.length} scenarios blocked</h2>
        <p className="text-sm text-slate-500">Backend: {ran[0]?.backend ?? "local"}</p>
      </div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-slate-400"><tr><th className="py-2">Attack</th><th>Blocked by</th><th>Hash</th><th>Direct-to-contract proof</th></tr></thead>
        <tbody>{ran.map((item) => <tr key={item.id} className="border-t border-slate-100 dark:border-white/10">
          <td className="py-3 font-semibold">{item.id} · {item.title}</td>
          <td><span className={`status-pill ${layerStyle[item.blockedBy ?? ""] ?? statusStyle.NOT_BLOCKED}`}>{item.status === "BLOCKED" ? item.blockedBy : "NOT BLOCKED"}</span></td>
          <td className="font-mono text-xs" title={item.transactionHash}>{item.transactionHash ? short(item.transactionHash) : "off-chain refusal"}</td>
          <td className="font-mono text-xs" title={item.directProof?.transactionHash}>{item.directProof ? `${short(item.directProof.transactionHash)} · ${proofLabel(item.directProof.status)}` : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
    <section data-testid="attack-grid" className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => <article key={item.id} data-testid={`attack-${item.id}`} className="card flex min-h-72 flex-col">
        <div className="flex items-start justify-between gap-4">
          <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-sm font-bold text-white dark:bg-emerald-500 dark:text-emerald-950">{item.id}</span>
          <div className="flex flex-wrap justify-end gap-2">
            {(item.directProofRequired || item.directProof) && <span className="status-pill bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">direct proof</span>}
            <span className={`status-pill ${statusStyle[item.status]}`}>{item.status.replace("_", " ")}</span>
          </div>
        </div>
        <h2 className="mt-5 text-lg font-bold">{item.title}</h2>
        {item.description && <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{item.description}</p>}
        {item.blockedBy && item.status === "BLOCKED" && <p className="mt-4 text-sm"><span className="mr-2 font-semibold uppercase tracking-wider text-slate-400">Stopped by</span><span className={`status-pill ${layerStyle[item.blockedBy] ?? ""}`}>{item.blockedBy}</span></p>}
        {item.reason && <p className="mt-3 text-sm leading-6">{item.reason}</p>}
        {(item.transactionHash || item.revertRecord) && <div className="mt-3 rounded-xl bg-slate-50 p-3 font-mono text-xs break-all dark:bg-white/[.04]">
          {item.transactionHash && <span className="block">{item.transactionHash}</span>}
          {item.revertRecord && <span className="mt-1 block text-rose-700 dark:text-rose-300">Revert: {item.revertRecord}</span>}
          {item.blockNumber && <span className="mt-1 block text-slate-400">Block {item.blockNumber}</span>}
        </div>}
        {item.directProof && <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-3 text-xs dark:border-white/15">
          <p className="font-semibold uppercase tracking-wider text-slate-400">Sent straight to contract</p>
          <p className="mt-1">{item.directProof.detail}</p>
          <p className="mt-1 font-mono break-all">{item.directProof.transactionHash}</p>
          <p className="mt-1 text-slate-400">Block {item.directProof.blockNumber} · {proofLabel(item.directProof.status)}</p>
        </div>}
        {item.steps && item.steps.length > 0 && <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-500">Layer trail ({item.steps.length} steps{item.durationMs !== undefined ? `, ${(item.durationMs / 1000).toFixed(1)} s` : ""})</summary>
          <ol className="mt-2 space-y-2">{item.steps.map((step, index) => <li key={index} className="rounded-lg bg-slate-50 p-2 dark:bg-white/[.04]">
            <b>{step.layer}</b> · {step.outcome}<br />{step.detail}
            {step.transactionHash && <span className="mt-1 block font-mono break-all text-slate-400">{step.transactionHash}{step.blockNumber ? ` · block ${step.blockNumber}` : ""}</span>}
          </li>)}</ol>
        </details>}
        <button data-testid={`run-${item.id}`} onClick={() => void run(item.id)} disabled={!!busy} className="secondary-button mt-auto w-full">{busy === item.id ? "Running…" : "Run scenario"}</button>
      </article>)}
    </section>
  </div>;
}
