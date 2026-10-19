import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Ban, CalendarClock, CheckCircle2, CircleDashed, CircleHelp, Clock, Copy, Check, Info, ListChecks, RefreshCw, TriangleAlert, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTransition } from "./effects";

/*
 * Shared console building blocks. Plain words lead; the exact technical value from the backend
 * stays visible next to them in a small mono tag, so nothing is hidden from a technical reviewer.
 */

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

const STATUS: Record<string, { label: string; tone: Tone; icon: Icon }> = {
  EXECUTED: { label: "Done", tone: "ok", icon: CheckCircle2 },
  COMPLETED: { label: "Done", tone: "ok", icon: CheckCircle2 },
  PENDING_APPROVAL: { label: "Needs your approval", tone: "warn", icon: Clock },
  NEEDS_APPROVAL: { label: "Needs your approval", tone: "warn", icon: Clock },
  WAITING_APPROVAL: { label: "Needs your approval", tone: "warn", icon: Clock },
  BLOCKED: { label: "Blocked", tone: "bad", icon: Ban },
  STOPPED: { label: "Stopped", tone: "bad", icon: Ban },
  REVERTED: { label: "Refused by the contract", tone: "bad", icon: Ban },
  FAILED: { label: "Failed", tone: "bad", icon: XCircle },
  VALIDATED: { label: "Checked", tone: "info", icon: ListChecks },
  PLANNED: { label: "Planned", tone: "neutral", icon: CircleDashed },
  DRAFT: { label: "Ready to run", tone: "info", icon: ListChecks },
  RUNNING: { label: "Running", tone: "info", icon: CircleDashed },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: X },
  PLAN: { label: "Plan ready", tone: "info", icon: ListChecks },
  ANSWER_ONLY: { label: "Needs more detail", tone: "info", icon: CircleHelp },
  SCHEDULE_READY: { label: "Scheduled", tone: "info", icon: CalendarClock },
  SCHEDULED: { label: "Scheduled", tone: "info", icon: CalendarClock },
};

/** Plain-English word for a backend status code; unknown codes are shown as they are. */
export function statusWord(code: string): string { return STATUS[code]?.label ?? code.replaceAll("_", " ").toLowerCase(); }

export const TIERS: Record<string, string> = { T0: "View only", T1: "AI can do alone", T2: "Needs your approval", T3: "Only you" };

/** One-sentence explanations behind every (i). */
export const TERMS = {
  riskScore: "A 0–100 score from fixed rules (amount history, new contact, time of day, payment speed, warning signs). 60 or more needs your approval; 85 or more is blocked.",
  tier: "Who may act: View only (T0), AI can do alone (T1), Needs your approval (T2), Only you (T3).",
  txHash: "The unique ID of a transaction on the chain; anyone with node access can look it up.",
  block: "The numbered batch of transactions on the chain that contains this one.",
  receipt: "The chain's own record that a transaction ran, with its block and result.",
  allowlist: "The contacts the AI is allowed to pay. Anyone else is refused by the contract.",
  cooldown: "A waiting period after a contact's payout address changes, before the AI may pay it.",
  killSwitch: "Stops every AI payment at once. Only the owner can turn payments back on.",
  approvalLimit: "Payments at or above this amount wait for your approval.",
  perPayment: "The contract refuses any single AI payment above this amount.",
  dailyLimit: "The most the AI may pay out in one day, counted by the contract.",
  auditLog: "Every decision is recorded in a log where each entry is chained to the previous one by a hash, so edits show up.",
  verify: "Asks the chain node for the receipt again and compares it with the record.",
  demoBalance: "Simulated demo units on the test ledger. No real money.",
  offChain: "Stopped before anything was signed, so there is no transaction and no hash; the proof is the audit-log entry.",
} as const;

export function Chip({ tone, icon: IconComponent, children, testId, title }: { tone: Tone; icon?: Icon; children: ReactNode; testId?: string; title?: string }) {
  return <span data-testid={testId} title={title} className={`status-pill chip-${tone}`}>{IconComponent && <IconComponent aria-hidden className="size-3.5 shrink-0" />}{children}</span>;
}

/** Status in plain words with an icon, plus the exact backend code in a mono tag. */
export function StatusChip({ code, testId, codeTestId }: { code: string; testId?: string; codeTestId?: string }) {
  const known = STATUS[code] ?? { label: statusWord(code), tone: "neutral" as Tone, icon: CircleDashed };
  return <span className="inline-flex flex-wrap items-center gap-1.5">
    <Chip tone={known.tone} icon={known.icon} testId={testId}>{known.label}</Chip>
    <code data-testid={codeTestId} className="code-tag" title="Technical value from the backend">{code}</code>
  </span>;
}

/** Permission tier in plain words, with the T-code shown small next to it. */
export function TierBadge({ tier, testId, codeTestId }: { tier?: string | null | undefined; testId?: string; codeTestId?: string }) {
  if (!tier) return <span data-testid={testId} className="text-muted">—</span>;
  return <span className="inline-flex items-center gap-1.5"><span data-testid={testId}>{TIERS[tier] ?? tier}</span><code data-testid={codeTestId} className="code-tag">{tier}</code></span>;
}

/** Small (i) with a one-sentence explanation on hover or keyboard focus. */
export function InfoTip({ term, text }: { term: string; text: string }) {
  const id = useId();
  return <span className="tip relative inline-flex align-middle">
    <button type="button" aria-label={`What is ${term}?`} aria-describedby={id} className="inline-grid size-5 place-items-center rounded-full text-muted hover:text-cobalt"><Info aria-hidden className="size-3.5" /></button>
    <span id={id} role="tooltip" className="tooltip">{text}</span>
  </span>;
}

/** A label with its (i). */
export function Term({ children, tip }: { children: ReactNode; tip: string }) {
  return <span className="inline-flex items-center gap-1">{children}<InfoTip term={typeof children === "string" ? children.toLowerCase() : "this"} text={tip} /></span>;
}

export const shortHash = (hash: string) => `${hash.slice(0, 6)}…${hash.slice(-4)}`;

/** Short hash (0x1234…abcd) with the full value on hover and a copy button. */
export function Hash({ value, testId, full = false }: { value: string; testId?: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  }
  return <span className="inline-flex max-w-full items-center gap-1">
    <span data-testid={testId} title={value} className={`mono text-fg ${full ? "break-all" : "whitespace-nowrap"}`}>{full ? value : shortHash(value)}</span>
    <button type="button" onClick={() => void copy()} aria-label={copied ? "Copied" : "Copy hash"} className="inline-grid size-7 shrink-0 place-items-center rounded-control text-muted hover:bg-subtle hover:text-fg">{copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}</button>
  </span>;
}

/** One-line plain-English purpose of the page, then optional detail and an action. */
export function PageHeader({ lead, children, action }: { lead: string; children?: ReactNode; action?: ReactNode }) {
  return <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
    <div className="max-w-3xl">
      <p data-testid="page-lead" className="sr-only">{lead}</p>
      {children && <p className="text-body text-fg2">{children}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </section>;
}

export function Card({ title, tip, kicker, action, children, testId, className = "" }: { title: ReactNode; tip?: string; kicker?: ReactNode; action?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return <section data-testid={testId} className={`card ${className}`}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="section-title inline-flex items-center gap-1">{title}{tip && <InfoTip term={typeof title === "string" ? title.toLowerCase() : "this"} text={tip} />}</h2>
      <div className="flex items-center gap-3">{kicker && <span className="text-small text-muted">{kicker}</span>}{action}</div>
    </div>
    {children}
  </section>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-[color-mix(in_srgb,var(--color-bad)_25%,transparent)] bg-bad-bg px-4 py-3 text-body text-bad">
    <span className="inline-flex items-center gap-2"><TriangleAlert aria-hidden className="size-4 shrink-0" />{message}</span>
    {retry && <button type="button" onClick={retry} className="secondary-button"><RefreshCw aria-hidden className="size-4" />Retry</button>}
  </div>;
}

export function Empty({ text, icon: IconComponent = CheckCircle2 }: { text: string; icon?: Icon }) {
  return <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line px-6 py-8 text-center text-body text-fg2">
    <IconComponent aria-hidden className="size-5 text-muted" />{text}
  </div>;
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return <div aria-hidden className="space-y-3">{Array.from({ length: rows }, (_, index) => <div key={index} className="skeleton h-4" style={{ width: `${92 - index * 14}%` }} />)}</div>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div role="status" aria-label={label} className="card"><SkeletonRows rows={3} /></div>;
}

// ------------------------------------------------------------------ toasts

type Toast = { id: number; tone: "ok" | "bad" | "info"; text: string; action?: { label: string; href: string } | undefined };
const ToastContext = createContext<(toast: Omit<Toast, "id">) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const toastMotion = useTransition({ type: "spring", stiffness: 460, damping: 32 });
  const show = useCallback((toast: Omit<Toast, "id">) => {
    const id = next.current++;
    setToasts((current) => [...current, { ...toast, id }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 8_000);
  }, []);
  return <ToastContext.Provider value={show}>
    {children}
    <div aria-live="polite" role="status" className="pointer-events-none fixed right-6 bottom-6 z-50 flex w-[min(420px,calc(100vw-48px))] flex-col gap-3">
      <AnimatePresence initial={false}>{toasts.map((toast) => <motion.div key={toast.id} layout data-testid="toast" initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }} transition={toastMotion} className={`glass pointer-events-auto flex items-start gap-3 rounded-card border bg-surface p-4 text-body shadow-[0_8px_30px_rgba(11,18,32,.14)] ${toast.tone === "ok" ? "border-[color-mix(in_srgb,var(--color-ok)_35%,transparent)]" : toast.tone === "bad" ? "border-[color-mix(in_srgb,var(--color-bad)_35%,transparent)]" : "border-line"}`}>
        {toast.tone === "ok" ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" /> : toast.tone === "bad" ? <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-bad" /> : <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-cobalt" />}
        <div className="flex-1"><p className="font-medium text-fg">{toast.text}</p>{toast.action && <a href={toast.action.href} className="mt-1 inline-flex font-medium text-cobalt hover:underline">{toast.action.label}</a>}</div>
        <button type="button" aria-label="Dismiss" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} className="inline-grid size-7 place-items-center rounded-control text-muted hover:bg-subtle"><X aria-hidden className="size-4" /></button>
      </motion.div>)}</AnimatePresence>
    </div>
  </ToastContext.Provider>;
}

// ------------------------------------------------------------------ confirmation dialog

/** Native modal dialog: focus is trapped by the browser and Esc closes it. */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel, danger = false }: { open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm(): void; onCancel(): void; danger?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onCancel(); }} aria-labelledby="confirm-title" className="glass-modal m-auto w-[min(440px,calc(100vw-32px))] rounded-card border border-line bg-surface p-0 text-fg shadow-[0_20px_60px_rgba(11,18,32,.25)] backdrop:bg-[rgba(11,18,32,.45)]">
    <div className="p-6">
      <h2 id="confirm-title" className="font-display text-figure font-semibold">{title}</h2>
      <div className="mt-2 text-body text-fg2">{children}</div>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="secondary-button">Cancel</button>
        <button type="button" onClick={onConfirm} className={danger ? "primary-button !border-bad !bg-bad" : "primary-button"} autoFocus>{confirmLabel}</button>
      </div>
    </div>
  </dialog>;
}
