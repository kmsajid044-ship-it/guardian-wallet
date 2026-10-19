import { useState } from "react";

/** Mirrors agent/src/planner/planner.ts. Every state and number here is what the agent returned. */
export type PlanStepState = "PLANNED" | "VALIDATED" | "PENDING_APPROVAL" | "EXECUTED" | "BLOCKED" | "FAILED";
type StepResult = { route: string; tier?: string; transactionHash?: string; blockNumber?: string; pendingId?: string; flags?: string[]; risk?: { score: number }; why?: { riskScore: number | null } };
export type PlanStep = {
  id: string; index: number; state: PlanStepState; status: "READY" | "EXECUTED" | "STOPPED" | "NOT_RUN"; operation: string;
  proposal: { kind: string; amount?: string; currency?: string; recipientContactId?: string };
  validation?: StepResult; result?: StepResult; error?: string; disclaimer?: string;
};
export type Plan = { id: string; status: string; request: string; approvalCap?: { currency: string; amount: string }; steps: PlanStep[] };
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Receipt = { status: string; blockNumber: string };

const stateStyle: Record<PlanStepState, string> = {
  PLANNED: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  VALIDATED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  EXECUTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  BLOCKED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  FAILED: "bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-100",
};
const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-8)}`;

/** The plan as an ordered list of steps; the owner runs it only after reviewing the checks. */
export function PlanView({ plan, api, onChange }: { plan: Plan; api: Api; onChange(plan: Plan): Promise<void> | void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function act(kind: "run" | "cancel") {
    setBusy(kind); setError("");
    try { await onChange(await api<Plan>(kind === "run" ? `/plans/${plan.id}/execute` : `/plans/${plan.id}`, { method: kind === "run" ? "POST" : "DELETE", ...(kind === "run" ? { body: "{}" } : {}) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Plan request failed"); }
    finally { setBusy(""); }
  }
  const disclaimers = [...new Set(plan.steps.flatMap((step) => step.disclaimer ? [step.disclaimer] : []))];
  return <section data-testid="plan-view" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Plan · {plan.steps.length} steps</p>
        {plan.approvalCap && <p data-testid="plan-cap" className="text-sm text-slate-600 dark:text-slate-300">Ask the owner before anything above {plan.approvalCap.amount} {plan.approvalCap.currency}</p>}</div>
      <span data-testid="plan-status" className="status-pill bg-white text-slate-700 dark:bg-white/10 dark:text-slate-200">{plan.status.replaceAll("_", " ")}</span>
    </div>
    <ol className="space-y-3">{plan.steps.map((step) => <StepRow key={step.id} step={step} api={api} />)}</ol>
    {disclaimers.map((text) => <p key={text} data-testid="currency-disclaimer" className="text-xs leading-5 text-slate-500 dark:text-slate-400">{text}</p>)}
    <p className="text-xs text-slate-500 dark:text-slate-400">States come from the agent's checks and the chain. A transaction and block appear only once the node has returned a receipt.</p>
    {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
    {plan.status === "DRAFT" && <div className="flex gap-3">
      <button data-testid="plan-run" onClick={() => void act("run")} disabled={busy !== ""} className="primary-button">{busy === "run" ? "Running…" : "Run plan"}</button>
      <button data-testid="plan-cancel" onClick={() => void act("cancel")} disabled={busy !== ""} className="secondary-button">Cancel plan</button>
    </div>}
  </section>;
}

function StepRow({ step, api }: { step: PlanStep; api: Api }) {
  const [receipt, setReceipt] = useState<string>();
  const latest = step.result ?? step.validation;
  const riskScore = latest?.why?.riskScore ?? latest?.risk?.score;
  // Only a real run carries a hash and block, and only after the executor received the receipt.
  const hash = step.result?.transactionHash;
  const block = step.result?.blockNumber;
  async function verify() {
    if (!hash) return;
    setReceipt("Fetching receipt…");
    try { const fetched = await api<Receipt>(`/receipt/${hash}`); setReceipt(`Receipt ${fetched.status} · block ${fetched.blockNumber}`); }
    catch { setReceipt("Receipt not found on the node"); }
  }
  const field = (label: string, value: string, testId: string, mono = false) => <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt><dd data-testid={testId} className={`text-sm font-semibold ${mono ? "font-mono" : ""}`}>{value}</dd></div>;
  return <li data-testid={`plan-step-${step.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[.03]">
    <div className="flex items-center justify-between gap-3">
      <b data-testid="step-id" className="font-mono text-sm">{step.id}</b>
      <span data-testid="step-state" className={`status-pill ${stateStyle[step.state]}`}>{step.state.replaceAll("_", " ")}</span>
    </div>
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 [&>div]:min-w-0 [&_dd]:break-words">
      {field("Operation", step.operation, "step-operation", true)}
      {field("Recipient", step.proposal.kind === "save" ? "Own savings" : step.proposal.recipientContactId ?? "—", "step-recipient")}
      {field("Amount", step.proposal.amount ?? "—", "step-amount")}
      {field("Currency", step.proposal.currency ?? "—", "step-currency")}
      {field("Tier", latest?.tier ?? "—", "step-tier")}
      {field("Risk score", riskScore === undefined || riskScore === null ? "Not scored" : `${riskScore}/100`, "step-risk")}
      {field("Run", step.status === "NOT_RUN" ? "Not run" : step.result ? "Ran" : "Checked only", "step-run")}
    </dl>
    {step.result?.flags?.length ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Flags: {step.result.flags.join(", ")}</p> : null}
    {!step.result && step.validation && step.state === "PLANNED" && <p data-testid="step-precheck" className="mt-2 text-xs text-amber-800 dark:text-amber-200">Pre-check predicts {step.validation.route.replaceAll("_", " ").toLowerCase()}{step.validation.flags?.length ? ` (${step.validation.flags.join(", ")})` : ""}.</p>}
    {step.error && <p data-testid="step-error" className="mt-2 text-xs text-rose-700 dark:text-rose-300">{step.error}</p>}
    {hash && block && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-white/[.04]">
      <span>Transaction <b data-testid="step-tx" className="font-mono" title={hash}>{short(hash)}</b></span>
      <span>Block <b data-testid="step-block">{block}</b></span>
      <button data-testid="step-verify" onClick={() => void verify()} className="secondary-button">Verify</button>
      {receipt && <span data-testid="step-receipt" className="font-semibold">{receipt}</span>}
    </div>}
  </li>;
}
