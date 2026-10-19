import { useCallback, useEffect, useMemo, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { ArrowRight, BarChart3, Bot, CheckCircle2, CircleCheck, CircleDot, FileCheck2, Hand, House, ListChecks, Moon, Pause, Play, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, Sun, UserRound, Wallet as WalletIcon } from "lucide-react";
import { AttackLab } from "./AttackLab";
import { EvidenceInspector } from "./EvidenceInspector";
import { PlanView, type Plan } from "./PlanView";
import { ValueDashboard } from "./ValueDashboard";
import { Card, Chip, ConfirmDialog, Empty, ErrorState, Hash, InfoTip, PageHeader, SkeletonRows, StatusChip, TERMS, Term, TierBadge, ToastProvider, statusWord, useToast } from "./ui";

const API = import.meta.env.VITE_AGENT_API_URL ?? "http://127.0.0.1:8787";
export const POSITIONING = "Guardian Wallet: a trust and control layer for autonomous AI finance. Let AI handle your financial tasks, without giving up control of your money.";
const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";
const backendNames: Record<string, string> = { fisco: "FISCO BCOS", "evm-local": "Local Anvil (dev fallback)" };

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
type Page = { href: string; label: string; icon: IconType; lead: string };
/** Hash routes in navigation order; older routes still open the page they were merged into. */
const pages: Page[] = [
  { href: "/", label: "Home", icon: House, lead: "Your AI money assistant at a glance." },
  { href: "/agent", label: "AI Agent", icon: Bot, lead: "Ask the AI to pay, save, or plan in plain words. It acts only within your rules." },
  { href: "/wallet", label: "Wallet", icon: WalletIcon, lead: "See your demo balances and everything the AI has done." },
  { href: "/control", label: "Control Center", icon: SlidersHorizontal, lead: "Set what your AI may do on its own, and approve what it may not." },
  { href: "/attack-lab", label: "Attack Lab", icon: ShieldAlert, lead: "Watch eleven real attacks try to misuse the AI, and see what stops each one." },
  { href: "/evidence", label: "Evidence Inspector", icon: FileCheck2, lead: "Every money movement is recorded on our FISCO BCOS chain. Press Verify to check it yourself." },
  { href: "/evaluation", label: "Evaluation", icon: BarChart3, lead: "How well the AI did on its test scenarios, and what it has done live." },
];
export const pageLead = (href: string) => pages.find((page) => page.href === href)!.lead;
const aliases: Record<string, string> = { "/policy": "/control", "/value": "/evaluation" };

/** One configured demo unit (config/currencies.json); CNY entries carry the required disclaimer. */
type Balance = { code: string; name: string; available: string; savings: string; disclaimer?: string };
type State = { paused: boolean; balances: Balance[]; spentToday: string; remainingDaily: string; perTxLimit: string; dailyLimit: string; approvalThreshold: string; recipientCooldown: string; pendingExpiry: string; opsPerCallLimit: string; opsDailyLimit: string };
type Pending = { id: string; recipientContactId: string; amount: string; currency: string; status: string; expiresAt: string; disclaimer?: string; why?: WhyDecision | null; operation?: string; agentReasoning?: string | null; flags?: string[] };
/** Read from the node by the agent: what the console is connected to. */
type Chain = { backend: string; chainId: number; blockHeight: string };
/** Owner decision on a pending item, returned only after the receipt and the contract's new status. */
type PendingDecision = { transactionHash: string; blockNumber: string; status: string; pendingId: string; pendingStatus: string };
type Contact = { id: string; address: string; label: string; allowed: boolean; activeAfter: string };
type AuditEntry = { id: number; timestamp: string; kind: string; hash: string; data: Record<string, unknown> };
/** Explained decision from the agent pipeline; factors are exactly what the risk engine computed. */
type WhyDecision = { decision: string; riskScore: number | null; riskClass: string; factors: Array<{ code: string; points: number; explanation: string }>; decidedBy: { layer: string; rule: string; detail: string; ownerApprovalRequired: boolean } };
type Proposal = { kind: string; amount?: string; currency?: string; recipientContactId?: string };
type ChatResult = { route: string; tier?: string; explanation: string; transactionHash?: string; blockNumber?: string; pendingId?: string; proposal?: Proposal; flags?: string[]; clarification?: { questions: string[] }; risk?: { score: number; factors: Array<{ code: string; explanation: string }> }; why?: WhyDecision; plan?: Plan };

const initialState: State = { paused: false, balances: [], spentToday: "—", remainingDaily: "—", perTxLimit: "500", dailyLimit: "1000", approvalThreshold: "200", recipientCooldown: "600", pendingExpiry: "86400", opsPerCallLimit: "0.1", opsDailyLimit: "5" };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

// Local demo: the agent signs owner actions and requires its per-run owner session token,
// which the Vite dev server hands only to this same-origin page (web/owner-session.ts).
// Production builds sign owner actions in the injected browser wallet instead.
async function ownerApi<T>(path: string, init: RequestInit): Promise<T> {
  if (!import.meta.env.DEV) throw new Error("Owner actions are signed in the browser wallet outside local development");
  const session = await fetch("/__owner-session", { cache: "no-store", credentials: "same-origin" });
  const body = await session.json() as { token?: string };
  if (!session.ok || !body.token) throw new Error("Owner session unavailable; restart the demo with pnpm demo");
  return api<T>(path, { ...init, headers: { "x-owner-session": body.token } });
}

/** "Ana - synthetic designer" becomes "Ana"; an unknown contact ID is shown capitalised. */
const contactName = (contacts: Contact[], id?: string) => {
  if (!id) return "—";
  const label = contacts.find((contact) => contact.id === id)?.label;
  return label ? label.split(/\s+[-–·]\s+/)[0]! : id.charAt(0).toUpperCase() + id.slice(1);
};

export default function App() {
  return <ToastProvider><Console /></ToastProvider>;
}

function Console() {
  const toast = useToast();
  const [dark, setDark] = useState(false);
  const [hashRoute, setRoute] = useState(location.hash.slice(1) || "/");
  const route = aliases[hashRoute] ?? hashRoute;
  const page = pages.find((item) => item.href === route) ?? pages[0]!;
  const [state, setState] = useState<State>(initialState);
  const [pending, setPending] = useState<Pending[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [chain, setChain] = useState<Chain>();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [confirmPause, setConfirmPause] = useState(false);
  const [switching, setSwitching] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [nextState, nextPending, nextContacts, nextAudit] = await Promise.all([api<State>("/state"), api<Pending[]>("/pending"), api<Contact[]>("/contacts"), api<AuditEntry[]>("/audit")]);
      setState(nextState); setPending(nextPending.filter((item) => item.status === "PENDING")); setContacts(nextContacts); setAudit(nextAudit.slice().reverse()); setError(""); setLoaded(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent service unavailable"); }
    try { setChain(await api<Chain>("/chain")); } catch { setChain(undefined); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5_000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const change = () => { setRoute(location.hash.slice(1) || "/"); scrollTo(0, 0); }; addEventListener("hashchange", change); return () => removeEventListener("hashchange", change); }, []);
  useEffect(() => { document.title = `${page.label} · Guardian Wallet`; }, [page.label]);
  // On the root element so the page background and dialogs follow the theme too.
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);

  async function setPaused(paused: boolean) {
    setConfirmPause(false); setSwitching(true);
    try {
      await ownerApi(paused ? "/owner/pause" : "/owner/unpause", { method: "POST", body: "{}" });
      await refresh();
      toast({ tone: "ok", text: paused ? "All AI payments are paused. Confirmed on chain." : "AI payments resumed. Confirmed on chain." });
    } catch (cause) { toast({ tone: "bad", text: `Could not ${paused ? "pause" : "resume"}: ${cause instanceof Error ? cause.message : "request failed"}` }); }
    finally { setSwitching(false); }
  }
  const askPause = () => setConfirmPause(true);
  const resume = () => void setPaused(false);

  return <div>
    <div className="min-h-screen bg-page text-fg lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <Sidebar route={route} />
      <div className="flex min-h-screen min-w-0 flex-col">
        <TopBar page={page} chain={chain} paused={state.paused} switching={switching} dark={dark} setDark={setDark} askPause={askPause} resume={resume} />
        {state.paused && <div data-testid="paused-banner" role="status" className="border-b border-[color-mix(in_srgb,var(--color-warn)_30%,transparent)] bg-warn-bg">
          <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3 px-6 py-3 text-body font-medium text-warn lg:px-10">
            <span className="inline-flex items-center gap-2"><Hand aria-hidden className="size-4" />All AI payments are paused. Only the owner can resume.</span>
            <button data-testid="banner-resume" onClick={resume} disabled={switching} className="secondary-button"><Play aria-hidden className="size-4" />Resume</button>
          </div>
        </div>}
        <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-6 px-6 py-8 lg:px-10">
          {error && <ErrorState message={`Cannot reach the agent service: ${error}`} retry={() => void refresh()} />}
          {route === "/" && <Home state={state} pending={pending} loaded={loaded} askPause={askPause} resume={resume} />}
          {route === "/agent" && <AgentPage state={state} contacts={contacts} refresh={refresh} />}
          {route === "/wallet" && <Wallet state={state} audit={audit} loaded={loaded} />}
          {route === "/control" && <ControlCenter state={state} pending={pending} contacts={contacts} loaded={loaded} refresh={refresh} askPause={askPause} resume={resume} switching={switching} />}
          {route === "/attack-lab" && <AttackLab api={api} />}
          {route === "/evaluation" && <ValueDashboard api={api} />}
          {route === "/evidence" && <EvidenceInspector api={api} />}
        </main>
        <Footer />
      </div>
    </div>
    <ConfirmDialog open={confirmPause} title="Pause all AI payments?" confirmLabel="Pause everything" danger onCancel={() => setConfirmPause(false)} onConfirm={() => void setPaused(true)}>
      The AI will not be able to pay, save, or request anything until you resume. The wallet contract enforces the pause, and only you can resume.
    </ConfirmDialog>
  </div>;
}

function Sidebar({ route }: { route: string }) {
  return <aside className="bg-ink text-white lg:min-h-screen">
    <div className="lg:sticky lg:top-0">
    <div className="flex items-center gap-3 px-6 py-5 lg:py-7">
      <span aria-hidden className="grid size-9 place-items-center rounded-control bg-cobalt"><ShieldCheck className="size-5 text-white" /></span>
      <span><b className="block font-display text-heading leading-tight">Guardian Wallet</b><span className="text-small text-[#A9B3C7]">Owner console</span></span>
    </div>
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
      {pages.map(({ href, label, icon: Icon }) => {
        const active = route === href;
        return <a key={href} href={`#${href}`} aria-current={active ? "page" : undefined} className={`flex min-h-10 shrink-0 items-center gap-3 rounded-control px-3 py-2 text-body font-medium transition-colors ${active ? "bg-[#1C2740] text-white" : "text-[#C3CAD8] hover:bg-[#151F33] hover:text-white"}`}>
          <Icon aria-hidden className={`size-[18px] shrink-0 ${active ? "text-[#8FB0F5]" : ""}`} />{label}
        </a>;
      })}
    </nav>
    <p className="hidden px-6 pt-8 text-small leading-5 text-[#A9B3C7] lg:block">Research prototype. Demo units on a simulated ledger; no real money.</p>
    </div>
  </aside>;
}

function TopBar({ page, chain, paused, switching, dark, setDark, askPause, resume }: { page: Page; chain: Chain | undefined; paused: boolean; switching: boolean; dark: boolean; setDark(value: boolean): void; askPause(): void; resume(): void }) {
  return <header className="sticky top-0 z-20 border-b border-line bg-page">
    <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-3 px-6 py-4 lg:px-10">
      <h1 data-testid="page-title" className="mr-auto font-display text-figure font-semibold">{page.label}</h1>
      <span className="status-pill border-line bg-surface text-fg2" title="Read from the node by the agent">
        <span aria-hidden className={`size-2 rounded-full ${chain ? "bg-ok" : "bg-muted"}`} />
        <span data-testid="chain-badge" className="mono">{chain ? `${backendNames[chain.backend] ?? chain.backend} · chain ${chain.chainId} · block #${chain.blockHeight}` : "Disconnected"}</span>
        <InfoTip term="block" text={TERMS.block} />
      </span>
      <span className="status-pill border-line bg-surface text-fg2"><UserRound aria-hidden className="size-3.5" />Owner<InfoTip term="role" text="You are signed in as the wallet owner: you approve requests, change limits, and can pause or resume. A guardian may only pause." /></span>
      <button aria-label="Toggle color mode" className="icon-button" onClick={() => setDark(!dark)}>{dark ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}</button>
      <span className="inline-flex items-center gap-1">
        {paused
          ? <button data-testid="kill-switch" onClick={resume} disabled={switching} className="primary-button"><Play aria-hidden className="size-4" />{switching ? "Resuming…" : "Resume AI"}</button>
          : <button data-testid="kill-switch" onClick={askPause} disabled={switching} className="danger-button"><Pause aria-hidden className="size-4" />{switching ? "Pausing…" : "Pause AI"}</button>}
        <InfoTip term="kill switch" text={TERMS.killSwitch} />
      </span>
    </div>
  </header>;
}

function Footer() {
  return <footer className="border-t border-line px-6 py-5 text-small text-muted lg:px-10">
    <div className="mx-auto max-w-[1440px] space-y-1">
      <p>Research prototype. Simulated ledger with USD and CNY demo units; no real money. Permissioned FISCO BCOS chain operated by the team.</p>
      <p data-testid="footer-disclaimer">{CNY_DISCLAIMER}</p>
    </div>
  </footer>;
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

// ------------------------------------------------------------------ Home

function Home({ state, pending, loaded, askPause, resume }: { state: State; pending: Pending[]; loaded: boolean; askPause(): void; resume(): void }) {
  const split = POSITIONING.indexOf(". ") + 1;
  return <div className="space-y-6">
    <section className="card">
      <p className="eyebrow">{greeting()}, owner</p>
      <p data-testid="positioning" className="mt-2"><span className="text-body text-fg2">{POSITIONING.slice(0, split)}</span>{" "}<span className="mt-1 block font-display text-display font-semibold tracking-tight text-fg">{POSITIONING.slice(split + 1)}</span></p>
      <p className="mt-3 text-body text-fg2">This is a research prototype: balances are simulated demo units. No real money and no customer funds are involved.</p>
    </section>

    <section className="grid gap-6 lg:grid-cols-3">
      <Card title="Balances" tip={TERMS.demoBalance} action={<a href="#/wallet" className="link-button">Wallet<ArrowRight aria-hidden className="size-4" /></a>}>
        {!loaded ? <SkeletonRows rows={2} /> : state.balances.length === 0 ? <Empty text="No balances yet. Seed the demo ledger to see them here." /> : <ul className="space-y-3">
          {state.balances.map((balance) => <li key={balance.code} data-testid="home-balance">
            <div className="flex items-center justify-between gap-3"><span className="label">{balance.code} available</span><span className="code-tag">DEMO BALANCE</span></div>
            <p className="figure whitespace-nowrap text-figure">{balance.available} <span className="text-heading text-fg2">{balance.code}</span></p>
            <p className="text-small text-muted">{balance.savings} {balance.code} in savings</p>
            {balance.disclaimer && <p className="mt-1 text-small text-muted">{balance.disclaimer}</p>}
          </li>)}
        </ul>}
      </Card>
      <Card title="Needs your approval">
        <a href="#/control" data-testid="glance-pending" className="block">
          <span className="figure text-display">{pending.length}</span>
          <span className="ml-2 text-body text-fg2">{pending.length === 1 ? "request is waiting" : "requests are waiting"}</span>
        </a>
        <p className="mt-2 text-body text-fg2">{pending.length ? "The AI stopped and is waiting for your decision." : "No approvals waiting. Your AI is working within its limits."}</p>
        <a href="#/control" className="primary-button mt-4 w-full">Review approvals<ArrowRight aria-hidden className="size-4" /></a>
      </Card>
      <Card title="AI payments" tip={TERMS.killSwitch}>
        {state.paused ? <Chip tone="warn" icon={Hand} testId="home-switch">Paused</Chip> : <Chip tone="ok" icon={CircleCheck} testId="home-switch">On</Chip>}
        <p className="mt-3 text-body text-fg2">{state.paused ? "Nothing moves until you resume. The contract enforces this." : `The AI may pay allowlisted contacts below ${state.approvalThreshold} USD on its own; ${state.remainingDaily} USD of today's limit is left.`}</p>
        {state.paused
          ? <button onClick={resume} className="primary-button mt-4 w-full"><Play aria-hidden className="size-4" />Resume</button>
          : <button onClick={askPause} className="danger-button mt-4 w-full"><Pause aria-hidden className="size-4" />Pause everything</button>}
      </Card>
    </section>

    <section aria-label="Quick actions" className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
      <QuickAction href="#/agent" icon={Sparkles} title="Ask the AI" text="Pay, save, or plan in plain words." />
      <QuickAction href="#/control" icon={CheckCircle2} title="Approve requests" text={`${pending.length} waiting for you.`} />
      <QuickAction onClick={askPause} icon={Pause} title="Pause everything" text={state.paused ? "Already paused." : "Stop all AI payments at once."} disabled={state.paused} />
      <QuickAction href="#/evidence" icon={FileCheck2} title="See proof" text="Check every transaction on chain." />
    </section>

    <section className="card">
      <h2 className="section-title">How Guardian Wallet protects you</h2>
      <ol className="mt-4 grid gap-4 md:grid-cols-3">
        <ProtectStep n={1} icon={Bot} title="AI plans" text="You ask in plain words. The AI turns it into a proposal using contact names, never raw addresses." />
        <ProtectStep n={2} icon={ListChecks} title="Rules check" text="A firewall, your limits, a simulation and a risk score check every step. The wallet contract checks again." />
        <ProtectStep n={3} icon={ShieldCheck} title="You stay in control" text="Anything above your limits waits for you, and you can pause everything at any time." />
      </ol>
    </section>
  </div>;
}

function QuickAction({ href, onClick, icon: Icon, title, text, disabled = false }: { href?: string; onClick?: () => void; icon: IconType; title: string; text: string; disabled?: boolean }) {
  const body = <><span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-control bg-cobalt-soft text-cobalt"><Icon className="size-5" /></span><span><b className="block font-display text-heading font-semibold">{title}</b><span className="text-body text-fg2">{text}</span></span></>;
  const style = "card flex min-h-24 items-center gap-4 text-left transition-colors hover:border-cobalt";
  return href ? <a href={href} className={style}>{body}</a> : <button type="button" onClick={onClick} disabled={disabled} className={`${style} w-full`}>{body}</button>;
}

function ProtectStep({ n, icon: Icon, title, text }: { n: number; icon: IconType; title: string; text: string }) {
  return <li className="flex gap-3 rounded-control border border-line p-4">
    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-ink font-display text-body font-semibold text-white">{n}</span>
    <div><p className="inline-flex items-center gap-2 font-display text-heading font-semibold"><Icon aria-hidden className="size-4 text-cobalt" />{title}</p><p className="mt-1 text-body text-fg2">{text}</p></div>
  </li>;
}

// ------------------------------------------------------------------ AI Agent

/** Example requests the deterministic parser understands; each runs the real pipeline. */
const EXAMPLES = ["Pay Ana 50 USD", "Pay Ana 50 USD, then move 200 CNY to savings, and ask me before anything above 300 USD", "Pay Ana 250 USD", "Send Ana 600 USD"];

function AgentPage({ state, contacts, refresh }: { state: State; contacts: Contact[]; refresh(): Promise<void> }) {
  return <div className="space-y-6">
    <PageHeader lead={pageLead("/agent")}>Every request goes through the firewall, your limits, a simulation and a risk check before anything is signed.</PageHeader>
    <Chat state={state} contacts={contacts} refresh={refresh} />
  </div>;
}

/** One plain sentence about the outcome, built only from values the backend returned. */
function outcomeSentence(result: ChatResult, state: State, contacts: Contact[]): string {
  const proposal = result.proposal;
  const who = contactName(contacts, proposal?.recipientContactId);
  const what = proposal?.amount && proposal.currency ? `${proposal.amount} ${proposal.currency}` : "the amount";
  const flags = result.flags ?? [];
  const rule = result.why?.decidedBy.rule ?? "";
  if (result.plan) {
    const plan = result.plan;
    const done = plan.steps.filter((step) => step.state === "EXECUTED").length;
    const stopIndex = plan.stoppedAt ?? plan.steps.findIndex((step) => step.status === "STOPPED");
    const at = Math.max(stopIndex, 0) + 1;
    if (plan.status === "DRAFT") return `Plan ready: ${plan.steps.length} steps, ${plan.steps.filter((step) => step.state === "VALIDATED").length} checked, nothing signed yet. Review it, then press Run plan.`;
    if (plan.status === "COMPLETED") return `Done. All ${plan.steps.length} steps ran.`;
    if (plan.status === "WAITING_APPROVAL") return `${done} of ${plan.steps.length} steps done. Step ${at} is waiting for your approval.`;
    if (plan.status === "CANCELLED") return "Plan cancelled. Nothing ran.";
    const stopped = stopIndex >= 0 ? plan.steps[stopIndex] : undefined;
    return `Stopped at step ${at} (${stopped ? statusWord(stopped.state).toLowerCase() : "stopped"}). ${done} of ${plan.steps.length} steps done.`;
  }
  switch (result.route) {
    case "EXECUTED": return proposal?.kind === "save" ? `Done. Moved ${what} to savings.` : `Done. Paid ${what} to ${who}.`;
    case "NEEDS_APPROVAL": {
      if (rule === "APPROVAL_THRESHOLD") return `Waiting for your approval because it is ${Number(proposal?.amount) > Number(state.approvalThreshold) ? "above" : "at"} your ${state.approvalThreshold} USD approval limit.`;
      if (flags.includes("UNTRUSTED_SOURCE_REQUIRES_APPROVAL")) return "Waiting for your approval because the request came from an untrusted source.";
      if (result.why?.riskScore !== null && result.why?.riskScore !== undefined) return `Waiting for your approval because its risk score is ${result.why.riskScore}/100.`;
      return "Waiting for your approval.";
    }
    case "BLOCKED": {
      if (flags.includes("OVER_PER_TX_LIMIT")) return `Blocked: above your ${state.perTxLimit} USD per-payment limit.`;
      if (flags.includes("OVER_DAILY_LIMIT")) return `Blocked: it would go over your ${state.dailyLimit} USD daily limit.`;
      if (flags.includes("PAUSED")) return "Blocked: AI payments are paused.";
      if (flags.includes("UNKNOWN_CONTACT")) return `Blocked: ${who} is not on your allowlist.`;
      if (flags.includes("RECIPIENT_NOT_ACTIVE")) return `Blocked: ${who} is still in its cooldown period.`;
      if (flags.includes("INSUFFICIENT_BALANCE")) return "Blocked: not enough demo balance.";
      if (flags.includes("POLICY_CHANGE_ATTEMPT")) return "Blocked: only you can change limits or the allowlist.";
      if (flags.includes("INSTRUCTION_INJECTION") || flags.includes("ADDRESS_INJECTION")) return "Blocked: the request contained instructions the AI firewall refuses.";
      if (flags.includes("RECIPIENT_SWAP")) return "Blocked: the recipient did not match the one expected.";
      if (rule === "RISK_SCORE_AT_LEAST_85") return `Blocked: the risk score of ${result.why?.riskScore ?? "?"}/100 is too high.`;
      return `Blocked by the ${result.why?.decidedBy.layer ?? "safety checks"}.`;
    }
    case "ANSWER_ONLY": return result.clarification?.questions.join(" ") || "The AI needs one more detail before it can act.";
    case "SCHEDULED": case "SCHEDULE_READY": return `Scheduled. Each ${what} payment to ${who} goes through every check when it is due.`;
    default: return result.explanation;
  }
}

function Chat({ state, contacts, refresh }: { state: State; contacts: Contact[]; refresh(): Promise<void> }) {
  const [message, setMessage] = useState(""); const [result, setResult] = useState<ChatResult>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [last, setLast] = useState("");
  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true); setError(""); setLast(text);
    try { const next = await api<ChatResult>("/chat", { method: "POST", body: JSON.stringify({ message: text, source: "trusted", sourceRefs: ["web:chat"] }) }); setResult(next); setMessage(""); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The agent did not answer"); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(message); }
  const steps = useMemo(() => result && !result.plan ? [{ label: "Intent understood", done: true }, { label: "Firewall passed", done: result.route !== "BLOCKED" || result.why?.decidedBy.layer !== "firewall" }, { label: "Policy & simulation", done: ["EXECUTED", "NEEDS_APPROVAL"].includes(result.route) }, { label: result.route === "NEEDS_APPROVAL" ? "Owner approval required" : "Execution complete", done: result.route === "EXECUTED" }] : [], [result]);
  async function planChanged(plan: Plan) { setResult((current) => current ? { ...current, route: "PLAN", explanation: `Plan ${plan.status.replaceAll("_", " ").toLowerCase()}.`, plan } : current); await refresh(); }
  const code = result ? (result.plan ? result.plan.status : result.route) : "";
  return <Card title="Ask the AI" kicker="Press Enter to send">
    <p className="label">Try one of these</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {EXAMPLES.map((example) => <button key={example} type="button" onClick={() => { setMessage(example); void send(example); }} disabled={busy} className="min-h-10 rounded-full border border-line bg-surface px-4 py-2 text-left text-body text-fg hover:border-cobalt hover:text-cobalt">{example}</button>)}
    </div>
    <form onSubmit={submit} className="mt-4 flex gap-3">
      <input aria-label="Message the agent" value={message} onChange={(event) => setMessage(event.target.value)} className="field flex-1" placeholder="For example: Pay Ana 50 USD" />
      <button disabled={busy} className="primary-button min-w-28">{busy ? "Checking…" : "Send"}</button>
    </form>
    {error && <div className="mt-4"><ErrorState message={error} retry={() => void send(last)} /></div>}
    {busy && <div className="mt-4" role="status" aria-label="Checking your request"><SkeletonRows rows={2} /></div>}
    {result && <div data-testid="chat-result" className="mt-5 space-y-4 rounded-card border border-line bg-page p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusChip code={code} testId="chat-status" codeTestId="chat-status-code" />
        {result.tier && <span className="inline-flex items-center gap-1 text-small text-fg2"><Term tip={TERMS.tier}>Permission</Term><TierBadge tier={result.tier} testId="chat-tier" /></span>}
      </div>
      <p data-testid="chat-summary" className="font-display text-heading font-medium text-fg">{outcomeSentence(result, state, contacts)}</p>
      {result.plan && <PlanView plan={result.plan} api={api} onChange={planChanged} />}
      {(result.why || steps.length > 0 || result.transactionHash) && <details data-testid="chat-details" className="rounded-control border border-line bg-surface">
        <summary className="flex min-h-10 cursor-pointer items-center px-4 py-2 font-medium text-cobalt">Details: why, checks, and proof</summary>
        <div className="space-y-4 border-t border-line p-4">
          <p className="text-body text-fg2">{result.explanation}</p>
          {steps.length > 0 && <ol className="grid gap-2 md:grid-cols-2">{steps.map((step, index) => <li key={step.label} className="flex items-center gap-2 text-body"><span className={`grid size-6 place-items-center rounded-full text-small font-medium ${step.done ? "bg-ok text-white" : "bg-subtle text-fg2"}`}>{step.done ? <CheckCircle2 aria-hidden className="size-4" /> : index + 1}</span>{step.label}</li>)}</ol>}
          {result.why && <WhyPanel why={result.why} />}
          {result.transactionHash && <Proof hash={result.transactionHash} block={result.blockNumber} />}
        </div>
      </details>}
    </div>}
  </Card>;
}

/** Transaction hash and block, with Verify asking the node for the receipt again. */
function Proof({ hash, block }: { hash: string; block?: string | undefined }) {
  const [receipt, setReceipt] = useState<string>();
  async function verify() {
    setReceipt("Fetching receipt…");
    try { const fetched = await api<{ status: string; blockNumber: string }>(`/receipt/${hash}`); setReceipt(`Receipt ${fetched.status} · block ${fetched.blockNumber}`); }
    catch { setReceipt("Receipt not found on the node"); }
  }
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-control bg-subtle p-3 text-body">
    <span className="inline-flex items-center gap-2"><Term tip={TERMS.txHash}>Transaction</Term><Hash value={hash} testId="proof-tx" /></span>
    {block && <span className="inline-flex items-center gap-2"><Term tip={TERMS.block}>Block</Term><span className="mono">#{block}</span></span>}
    <span className="inline-flex items-center gap-1"><button data-testid="proof-verify" onClick={() => void verify()} className="secondary-button"><ShieldCheck aria-hidden className="size-4" />Verify</button><InfoTip term="verify" text={TERMS.verify} /></span>
    {receipt && <span data-testid="proof-receipt" className="text-body font-medium">{receipt}</span>}
  </div>;
}

// ------------------------------------------------------------------ Wallet

const auditKinds: Record<string, string> = {
  pipeline_result: "AI decision", pending_approved: "You approved a request", pending_rejected: "You rejected a request", wallet_paused: "You paused AI payments",
  wallet_unpaused: "You resumed AI payments", policy_updated: "You changed the limits", recipient_updated: "You changed the allowlist", attack_lab_result: "Attack Lab run",
  risk_intel_fee: "Payee check fee paid", plan_created: "Plan created", plan_validated: "Plan checked", plan_completed: "Plan finished", plan_stopped: "Plan stopped", plan_cancelled: "Plan cancelled", plan_edited: "Plan edited", plan_step_validated: "Plan step checked",
};

function Wallet({ state, audit, loaded }: { state: State; audit: AuditEntry[]; loaded: boolean }) {
  return <div className="space-y-6">
    <PageHeader lead={pageLead("/wallet")}>Balances are read from the simulated ledger on chain.</PageHeader>
    <section className="grid gap-6 md:grid-cols-2 2xl:grid-cols-4">
      {!loaded ? [0, 1].map((key) => <div key={key} className="card"><SkeletonRows rows={3} /></div>)
        : state.balances.length === 0 ? <div className="md:col-span-2"><Empty text="No balances yet. Seed the demo ledger to see them here." /></div>
        : state.balances.map((balance) => <BalanceCard key={balance.code} balance={balance} />)}
      <div className="card"><p className="label inline-flex items-center gap-1">Daily spending left<InfoTip term="daily limit" text={TERMS.dailyLimit} /></p><p className="figure mt-2 text-figure">{state.remainingDaily} USD</p><p className="mt-2 text-body text-fg2">{state.spentToday} USD used today of {state.dailyLimit} USD.</p></div>
      <div className="card"><p className="label">FX reference</p><p className="figure mt-2 text-figure">1 USD = 7.10 CNY</p><p className="mt-2 text-small text-muted">Illustrative cached snapshot of 2026-10-16 · not a market rate · read only, never used to compute amounts</p></div>
    </section>
    <AuditLog entries={audit} loaded={loaded} />
  </div>;
}

function BalanceCard({ balance }: { balance: Balance }) {
  return <div className="card" data-testid="balance-card">
    <div className="flex items-start justify-between gap-2"><p className="label">{balance.code} available</p><span data-testid="demo-balance" className="code-tag">DEMO BALANCE</span></div>
    <p className="figure mt-2 text-display">{balance.available}<span className="ml-2 text-heading text-fg2">{balance.code}</span></p>
    <p className="mt-2 text-body text-fg2">{balance.savings} {balance.code} in savings</p>
    {balance.disclaimer && <p data-testid="currency-disclaimer" className="mt-3 text-small text-muted">{balance.disclaimer}</p>}
  </div>;
}

function AuditLog({ entries, loaded }: { entries: AuditEntry[]; loaded: boolean }) {
  const [verified, setVerified] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  async function verify(entry: AuditEntry, hash: string) {
    setVerified((current) => ({ ...current, [entry.id]: "Checking…" }));
    try { const receipt = await api<{ blockNumber: string }>(`/receipt/${hash}`); setVerified((current) => ({ ...current, [entry.id]: `Verified · block ${receipt.blockNumber}` })); }
    catch { setVerified((current) => ({ ...current, [entry.id]: "Not found on the node" })); }
  }
  return <Card title="Recent activity" tip={TERMS.auditLog} kicker="Newest first">
    {!loaded ? <SkeletonRows rows={4} /> : entries.length === 0 ? <Empty text="No activity yet. Ask the AI to do something and it will show up here." /> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-body">
      <thead className="table-head"><tr><th>What happened</th><th>Result</th><th><Term tip={TERMS.txHash}>Transaction</Term></th><th><Term tip={TERMS.block}>Block</Term></th><th>Time</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{entries.slice(0, 10).flatMap((entry) => {
        const decision = (entry.data.decision ?? {}) as Record<string, unknown>;
        const hash = (decision.transactionHash ?? entry.data.transactionHash) as string | undefined;
        const block = (decision.blockNumber ?? entry.data.blockNumber) as string | undefined;
        const why = entry.data.why as WhyDecision | undefined;
        const proposal = entry.data.proposal as Proposal | undefined;
        const outcome = typeof decision.outcome === "string" ? decision.outcome : undefined;
        const detail = proposal?.amount ? `${proposal.kind === "save" ? "Save" : "Pay"} ${proposal.recipientContactId ? `${proposal.recipientContactId} ` : ""}${proposal.amount} ${proposal.currency ?? ""}` : "";
        const row = <tr key={entry.id} className="table-row">
          <td><span className="font-medium">{auditKinds[entry.kind] ?? entry.kind.replaceAll("_", " ")}</span>{detail && <span className="block text-small text-muted">{detail}</span>}</td>
          <td>{outcome ? <StatusChip code={outcome} /> : hash && block ? <Chip tone="ok" icon={CheckCircle2}>Confirmed on chain</Chip> : <Chip tone="neutral" icon={CircleDot}>Recorded</Chip>}</td>
          <td>{hash ? <Hash value={hash} /> : <span className="text-muted">None</span>}</td>
          <td className="mono">{block ? `#${block}` : "—"}</td>
          <td className="whitespace-nowrap text-fg2">{new Date(entry.timestamp).toLocaleTimeString()}</td>
          <td className="whitespace-nowrap text-right">
            {why && <button data-testid={`why-toggle-${entry.id}`} onClick={() => setOpen((current) => ({ ...current, [entry.id]: !current[entry.id] }))} className="secondary-button mr-2">{open[entry.id] ? "Hide" : "Why"}</button>}
            {hash && <button onClick={() => void verify(entry, hash)} className="secondary-button">{verified[entry.id] ?? "Verify"}</button>}
          </td>
        </tr>;
        const panel = why && open[entry.id] ? <tr key={`${entry.id}-why`}><td colSpan={6} className="pb-4"><WhyPanel why={why} testId={`why-panel-audit-${entry.id}`} /></td></tr> : null;
        return panel ? [row, panel] : [row];
      })}</tbody>
    </table></div>}
  </Card>;
}

// ------------------------------------------------------------------ Control Center

function ControlCenter({ state, pending, contacts, loaded, refresh, askPause, resume, switching }: { state: State; pending: Pending[]; contacts: Contact[]; loaded: boolean; refresh(): Promise<void>; askPause(): void; resume(): void; switching: boolean }) {
  return <div className="space-y-6">
    <PageHeader lead={pageLead("/control")}>Your limits are enforced by the wallet contract, not only by the AI.</PageHeader>
    <section className="card flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className={`grid size-10 place-items-center rounded-control ${state.paused ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok"}`}>{state.paused ? <Hand className="size-5" /> : <CircleCheck className="size-5" />}</span>
        <div><p className="inline-flex items-center gap-1 font-display text-heading font-semibold">{state.paused ? "AI payments are paused" : "AI payments are on"}<InfoTip term="kill switch" text={TERMS.killSwitch} /></p><p className="text-body text-fg2">{state.paused ? "Nothing moves until you resume." : "Pausing stops every AI payment at once."}</p></div>
      </div>
      {state.paused ? <button data-testid="control-resume" onClick={resume} disabled={switching} className="primary-button"><Play aria-hidden className="size-4" />Resume</button> : <button data-testid="control-pause" onClick={askPause} disabled={switching} className="danger-button"><Pause aria-hidden className="size-4" />Pause everything</button>}
    </section>
    <ApprovalInbox items={pending} contacts={contacts} threshold={state.approvalThreshold} loaded={loaded} refresh={refresh} />
    <Policy state={state} contacts={contacts} refresh={refresh} />
  </div>;
}

/** Why a pending item needs the owner, in one sentence from the recorded decision. */
function approvalReason(item: Pending, threshold: string): string {
  if (item.why?.decidedBy.rule === "APPROVAL_THRESHOLD") return `It is ${Number(item.amount) > Number(threshold) ? "above" : "at"} your ${threshold} USD approval limit.`;
  if (item.flags?.includes("UNTRUSTED_SOURCE_REQUIRES_APPROVAL")) return "The request came from an untrusted source.";
  if (item.why?.riskScore !== null && item.why?.riskScore !== undefined && item.why.riskScore >= 60) return `Its risk score is ${item.why.riskScore}/100.`;
  return item.why?.decidedBy.detail ?? "The contract holds it for your decision.";
}

function timeLeft(expiresAt: string): string {
  const ms = Number(expiresAt) * 1000 - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / 3_600_000); const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours} h ${minutes} min left to decide` : `${minutes} min left to decide`;
}

/**
 * Pending items the contract holds for the owner. A decision is reported as done only when the agent
 * returns the receipt and the contract's new status for the item; anything else is shown as an error.
 */
function ApprovalInbox({ items, contacts, threshold, loaded, refresh }: { items: Pending[]; contacts: Contact[]; threshold: string; loaded: boolean; refresh(): Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<PendingDecision[]>([]);
  async function decide(id: string, kind: "approve" | "reject") {
    setBusy(`${kind}-${id}`); setErrors((current) => ({ ...current, [id]: "" }));
    try {
      const result = await ownerApi<PendingDecision>(`/owner/pending/${id}/${kind}`, { method: "POST", body: "{}" });
      const expected = kind === "approve" ? "EXECUTED" : "REJECTED";
      if (result.status !== "success" || result.pendingStatus !== expected) throw new Error(`Chain did not confirm: pending #${id} is ${result.pendingStatus}`);
      setDone((current) => [result, ...current]);
      toast(kind === "approve" ? { tone: "ok", text: "Approved and paid.", action: { label: "View proof", href: "#/wallet" } } : { tone: "info", text: "Rejected. Nothing was paid.", action: { label: "View proof", href: "#/wallet" } });
      await refresh();
    } catch (cause) { setErrors((current) => ({ ...current, [id]: cause instanceof Error ? cause.message : "Decision failed" })); }
    finally { setBusy(""); }
  }
  return <Card title="Needs your approval" kicker={`${items.length} waiting`}>
    {done.length > 0 && <ul data-testid="pending-confirmations" className="mb-4 space-y-2">{done.map((item) => <li key={item.transactionHash} data-testid={`confirmed-${item.pendingId}`} className="flex flex-wrap items-center gap-x-2 rounded-control border border-[color-mix(in_srgb,var(--color-ok)_25%,transparent)] bg-ok-bg px-4 py-3 text-body font-medium text-ok">Pending #{item.pendingId} {item.pendingStatus === "EXECUTED" ? "approved and paid" : "rejected"} · confirmed on chain in block {item.blockNumber} · <span className="font-mono text-small">{item.transactionHash.slice(0, 10)}…{item.transactionHash.slice(-8)}</span></li>)}</ul>}
    <div data-testid="approval-inbox" className="grid gap-4 xl:grid-cols-2">
      {!loaded ? <div className="card-tight"><SkeletonRows rows={4} /></div>
        : items.length === 0 ? <div className="xl:col-span-2"><Empty text="No approvals waiting. Your AI is working within its limits." /></div>
        : items.map((item) => <PendingCard key={item.id} item={item} name={contactName(contacts, item.recipientContactId)} threshold={threshold} busy={busy} error={errors[item.id] ?? ""} decide={decide} />)}
    </div>
  </Card>;
}

function PendingCard({ item, name, threshold, busy, error, decide }: { item: Pending; name: string; threshold: string; busy: string; error: string; decide(id: string, kind: "approve" | "reject"): Promise<void> }) {
  const rules = [...new Set([...(item.why ? [item.why.decidedBy.rule] : []), ...(item.flags ?? []), ...(item.why?.factors.map((factor) => factor.code) ?? [])])];
  const expires = new Date(Number(item.expiresAt) * 1000);
  const field = (label: ReactNode, value: ReactNode, testId: string) => <div><dt className="label">{label}</dt><dd data-testid={testId} className="text-body font-medium">{value}</dd></div>;
  return <article data-testid={`pending-${item.id}`} className="flex flex-col rounded-card border border-line bg-surface p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="figure text-display">{item.amount} <span className="text-heading text-fg2">{item.currency}</span></p>
        <p className="text-body text-fg2">to <b className="font-medium text-fg">{name}</b></p>
      </div>
      <span className="inline-flex flex-col items-end gap-1"><Chip tone="warn" icon={Hand}>Needs your approval</Chip><span className="text-small text-muted">Request #{item.id}</span></span>
    </div>
    <p data-testid="pending-why" className="mt-3 text-body text-fg">{approvalReason(item, threshold)}</p>
    <p data-testid="pending-time-left" className="mt-1 text-small text-muted">{timeLeft(item.expiresAt)}</p>
    {item.disclaimer && <p data-testid="currency-disclaimer" className="mt-2 text-small text-muted">{item.disclaimer}</p>}
    {error && <p data-testid={`pending-error-${item.id}`} role="alert" className="mt-3 rounded-control bg-bad-bg p-3 text-body text-bad">{error}</p>}
    <div className="mt-4 grid grid-cols-2 gap-3">
      <button data-testid={`approve-${item.id}`} onClick={() => void decide(item.id, "approve")} disabled={busy !== ""} className="primary-button min-h-12">{busy === `approve-${item.id}` ? "Waiting for chain…" : "Approve"}</button>
      <button data-testid={`reject-${item.id}`} onClick={() => void decide(item.id, "reject")} disabled={busy !== ""} className="danger-button min-h-12">{busy === `reject-${item.id}` ? "Waiting for chain…" : "Reject"}</button>
    </div>
    <details className="mt-4 border-t border-line pt-3">
      <summary className="flex min-h-10 cursor-pointer items-center font-medium text-cobalt">Details</summary>
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {field("Operation", <span className="mono">{item.operation ?? "requestApproval"}</span>, "pending-operation")}
        {field("Amount", item.amount, "pending-amount")}
        {field("Currency", item.currency, "pending-currency")}
        {field("Recipient", item.recipientContactId, "pending-recipient")}
        {field(<Term tip={TERMS.riskScore}>Risk score</Term>, item.why?.riskScore === null || item.why?.riskScore === undefined ? "Not scored" : `${item.why.riskScore}/100`, "pending-risk")}
        {field("Expires", Number.isFinite(expires.getTime()) ? expires.toLocaleString() : "—", "pending-expiry")}
      </dl>
      <p className="label mt-3">Agent reasoning</p>
      <p data-testid="pending-reasoning" className="text-body">{item.agentReasoning || "Not recorded for this item."}</p>
      <p className="label mt-3">Triggered rules</p>
      <ul data-testid="pending-rules" className="mt-1 flex flex-wrap gap-1.5">{rules.length ? rules.map((rule) => <li key={rule} className="code-tag">{rule}</li>) : <li className="text-body text-muted">No rule recorded.</li>}</ul>
      {item.why && <div className="mt-3"><WhyPanel why={item.why} testId={`why-panel-${item.id}`} /></div>}
    </details>
  </article>;
}

/** Explains one decision with the risk score, its real factors, and the rule that decided the outcome. */
function WhyPanel({ why, testId = "why-panel" }: { why: WhyDecision; testId?: string }) {
  return <section data-testid={testId} className="rounded-control border border-line bg-surface p-4 text-left">
    <div className="flex flex-wrap items-center justify-between gap-2"><b className="font-display text-heading font-semibold">Why this action?</b><StatusChip code={why.decision} /></div>
    <dl className="mt-3 grid gap-3 sm:grid-cols-3">
      <div><dt className="label"><Term tip={TERMS.riskScore}>Risk score</Term></dt><dd data-testid="why-score" className="figure text-heading">{why.riskScore === null ? "Not scored" : `${why.riskScore}/100`}</dd></div>
      <div><dt className="label">Risk class</dt><dd data-testid="why-class" className="text-body font-medium capitalize">{why.riskClass}</dd></div>
      <div><dt className="label">Your approval</dt><dd data-testid="why-approval" className="text-body font-medium">{why.decidedBy.ownerApprovalRequired ? "Required" : "Not required"}</dd></div>
    </dl>
    <p className="label mt-3">Risk factors the engine computed</p>
    {why.factors.length === 0 ? <p data-testid="why-factors" className="mt-1 text-body text-fg2">No risk factors applied to this action.</p> : <ul data-testid="why-factors" className="mt-1 space-y-1 text-body">{why.factors.map((factor) => <li key={factor.code} className="flex flex-wrap items-baseline gap-x-2"><b className="mono font-medium">+{factor.points}</b><span className="text-fg2">{factor.explanation}</span><code className="code-tag ml-auto">{factor.code}</code></li>)}</ul>}
    <div className="mt-3 rounded-control bg-subtle p-3"><p className="label">Decided by</p><p data-testid="why-decided-by" className="text-body font-medium">{why.decidedBy.layer} · {why.decidedBy.rule.replaceAll("_", " ")}</p><p className="mt-1 text-body text-fg2">{why.decidedBy.detail}</p></div>
  </section>;
}

const policyFields = [["Per-payment limit", "perTxLimit", TERMS.perPayment], ["Daily limit", "dailyLimit", TERMS.dailyLimit], ["Approval limit", "approvalThreshold", TERMS.approvalLimit], ["Recipient cooldown (seconds)", "recipientCooldown", TERMS.cooldown]] as const;

function Policy({ state, contacts, refresh }: { state: State; contacts: Contact[]; refresh(): Promise<void> }) {
  const toast = useToast();
  const [form, setForm] = useState(state); const [saving, setSaving] = useState(false);
  useEffect(() => setForm(state), [state]);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      await ownerApi("/owner/policy", { method: "PUT", body: JSON.stringify({ perTxLimit: form.perTxLimit, dailyLimit: form.dailyLimit, approvalThreshold: form.approvalThreshold, recipientCooldown: Number(form.recipientCooldown), pendingExpiry: Number(form.pendingExpiry), opsPerCallLimit: form.opsPerCallLimit, opsDailyLimit: form.opsDailyLimit }) });
      toast({ tone: "ok", text: "Limits saved on chain." }); await refresh();
    } catch (cause) { toast({ tone: "bad", text: `Limits not saved: ${cause instanceof Error ? cause.message : "request failed"}` }); }
    finally { setSaving(false); }
  }
  return <div className="grid gap-6 2xl:grid-cols-2">
    <Card title="Limits and cooldown" kicker={<span className="inline-flex items-center gap-1.5">Only you can change these <code className="code-tag">T3</code></span>}>
      <form onSubmit={(event) => void save(event)} className="grid gap-4 sm:grid-cols-2">
        {policyFields.map(([label, key, tip]) => <label key={key} className="text-body font-medium">
          <span className="inline-flex items-center gap-1">{label}<InfoTip term={label.toLowerCase()} text={tip} /></span>
          <span className="mt-1.5 flex items-center gap-2"><input className="field w-full tabular-nums" inputMode="decimal" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />{key !== "recipientCooldown" && <span className="text-body text-fg2">USD</span>}</span>
        </label>)}
        <button disabled={saving} className="primary-button sm:col-span-2">{saving ? "Saving on chain…" : "Save limits"}</button>
      </form>
    </Card>
    <Card title="Allowlist" tip={TERMS.allowlist} kicker="Who the AI may pay">
      {contacts.length === 0 ? <Empty text="No contacts on the allowlist yet." /> : <ul className="space-y-3">{contacts.map((contact) => {
        const cooling = Number(contact.activeAfter) * 1000 > Date.now();
        return <li key={contact.id} className="flex items-center justify-between gap-3 rounded-control border border-line p-4">
          <div className="min-w-0"><b className="font-medium">{contact.label || contact.id}</b><p className="mono text-muted">{contact.id} · {contact.address.slice(0, 6)}…{contact.address.slice(-4)}</p></div>
          <div className="text-right">
            {contact.allowed ? <Chip tone="ok" icon={CircleCheck}>Allowed</Chip> : <Chip tone="neutral" icon={CircleDot}>Not allowed</Chip>}
            {cooling && <p className="mt-1 inline-flex items-center gap-1 text-small text-warn">Cooldown until {new Date(Number(contact.activeAfter) * 1000).toLocaleString()}<InfoTip term="cooldown" text={TERMS.cooldown} /></p>}
          </div>
        </li>;
      })}</ul>}
    </Card>
  </div>;
}
