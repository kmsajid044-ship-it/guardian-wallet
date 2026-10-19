import { useEffect, useRef, useState, type ReactNode } from "react";
import { Play, ShieldCheck, X } from "lucide-react";
import { motion } from "motion/react";
import { useTransition } from "./effects";
import { ErrorState, Hash, InfoTip, StatusChip, TERMS, Term, TierBadge } from "./ui";

/** Mirrors agent/src/planner/planner.ts. Every state and number here is what the agent returned. */
export type PlanStepState = "PLANNED" | "VALIDATED" | "PENDING_APPROVAL" | "EXECUTED" | "BLOCKED" | "FAILED";
type StepResult = { route: string; tier?: string; transactionHash?: string; blockNumber?: string; pendingId?: string; flags?: string[]; risk?: { score: number }; why?: { riskScore: number | null } };
export type PlanStep = {
  id: string; index: number; state: PlanStepState; status: "READY" | "EXECUTED" | "STOPPED" | "NOT_RUN"; operation: string;
  proposal: { kind: string; amount?: string; currency?: string; recipientContactId?: string };
  validation?: StepResult; result?: StepResult; error?: string; disclaimer?: string;
};
export type Plan = { id: string; status: string; request: string; approvalCap?: { currency: string; amount: string }; steps: PlanStep[]; stoppedAt?: number };
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Receipt = { status: string; blockNumber: string };

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
  return <section data-testid="plan-view" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="label">Plan · {plan.steps.length} steps</p>
        {plan.approvalCap && <p data-testid="plan-cap" className="text-body text-fg">Ask the owner before anything above {plan.approvalCap.amount} {plan.approvalCap.currency}</p>}</div>
      <StatusChip code={plan.status} testId="plan-status" codeTestId="plan-status-code" />
    </div>
    <ol className="space-y-3">{plan.steps.map((step) => <StepRow key={step.id} step={step} api={api} />)}</ol>
    {disclaimers.map((text) => <p key={text} data-testid="currency-disclaimer" className="text-small text-muted">{text}</p>)}
    <p className="text-small text-muted">States come from the agent's checks and the chain. A transaction and block appear only once the node has returned a receipt.</p>
    {error && <ErrorState message={error} retry={() => void act("run")} />}
    {plan.status === "DRAFT" && <div className="flex flex-wrap gap-3">
      <button data-testid="plan-run" onClick={() => void act("run")} disabled={busy !== ""} className="primary-button"><Play aria-hidden className="size-4" />{busy === "run" ? "Running…" : "Run plan"}</button>
      <button data-testid="plan-cancel" onClick={() => void act("cancel")} disabled={busy !== ""} className="secondary-button"><X aria-hidden className="size-4" />Cancel plan</button>
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
  const field = (label: ReactNode, value: ReactNode, testId: string, mono = false) => <div className="min-w-0"><dt className="label">{label}</dt><dd data-testid={testId} className={`break-words text-body font-medium ${mono ? "mono" : ""}`}>{value}</dd></div>;
  return <li data-testid={`plan-step-${step.id}`} className="rounded-control border border-line bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="inline-flex items-center gap-2"><b data-testid="step-id" className="mono text-fg">{step.id}</b><span className="text-body text-fg">{step.proposal.kind === "save" ? `Move ${step.proposal.amount ?? "?"} ${step.proposal.currency ?? ""} to savings` : `Pay ${step.proposal.recipientContactId ?? "?"} ${step.proposal.amount ?? "?"} ${step.proposal.currency ?? ""}`}</span></span>
      <StateChip code={step.state} />
    </div>
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {field("Operation", step.operation, "step-operation", true)}
      {field("Recipient", step.proposal.kind === "save" ? "Own savings" : step.proposal.recipientContactId ?? "—", "step-recipient")}
      {field("Amount", step.proposal.amount ?? "—", "step-amount")}
      {field("Currency", step.proposal.currency ?? "—", "step-currency")}
      {field(<Term tip={TERMS.tier}>Permission</Term>, <TierBadge tier={latest?.tier} testId="step-tier" codeTestId="step-tier-code" />, "step-permission")}
      {field(<Term tip={TERMS.riskScore}>Risk score</Term>, riskScore === undefined || riskScore === null ? "Not scored" : `${riskScore}/100`, "step-risk")}
      {field("Run", step.status === "NOT_RUN" ? "Not run" : step.result ? "Ran" : "Checked only", "step-run")}
    </dl>
    {step.result?.flags?.length ? <p className="mt-2 text-small text-muted">Rules: {step.result.flags.map((flag) => <code key={flag} className="code-tag mr-1">{flag}</code>)}</p> : null}
    {!step.result && step.validation && step.state === "PLANNED" && <p data-testid="step-precheck" className="mt-2 text-small text-warn">Pre-check predicts {step.validation.route.replaceAll("_", " ").toLowerCase()}{step.validation.flags?.length ? ` (${step.validation.flags.join(", ")})` : ""}.</p>}
    {step.error && <p data-testid="step-error" className="mt-2 text-small text-bad">{step.error}</p>}
    {hash && block && <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-control bg-subtle p-3 text-body">
      <span className="inline-flex items-center gap-2"><Term tip={TERMS.txHash}>Transaction</Term><Hash value={hash} testId="step-tx" /></span>
      <span className="inline-flex items-center gap-1"><Term tip={TERMS.block}>Block</Term><span className="mono">#<span data-testid="step-block">{block}</span></span></span>
      <span className="inline-flex items-center gap-1"><button data-testid="step-verify" onClick={() => void verify()} className="secondary-button"><ShieldCheck aria-hidden className="size-4" />Verify</button><InfoTip term="verify" text={TERMS.verify} /></span>
      {receipt && <span data-testid="step-receipt" className="font-medium">{receipt}</span>}
    </div>}
  </li>;
}

/** Step state chip that morphs Planned → Checked → Done, drawing a small check when a step is done. */
function StateChip({ code }: { code: string }) {
  const morph = useTransition({ type: "spring", stiffness: 420, damping: 34 });
  const draw = useTransition({ duration: 0.32, ease: "easeOut", delay: 0.08 });
  // No entrance on first render; only a change of state animates.
  const first = useRef(true);
  useEffect(() => { first.current = false; }, []);
  return <motion.span layout="position" transition={morph} className="inline-flex items-center gap-1.5">
    {code === "EXECUTED" && <svg aria-hidden viewBox="0 0 16 16" className="size-4 text-ok"><motion.path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={draw} /></svg>}
    {/* Keyed by state: a new state pops in; the old chip is gone at once, so there is only ever one. */}
    <motion.span key={code} className="inline-flex" initial={first.current ? false : { opacity: 0, scale: 0.85, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={morph}>
      <StatusChip code={code} testId="step-state" codeTestId="step-state-code" />
    </motion.span>
  </motion.span>;
}
