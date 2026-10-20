import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { Ban, BarChart3, CheckCircle2, ChevronDown, CircleCheck, CircleDot, CircleHelp, Clock, FileCheck2, Hand, History, House, Menu, Moon, Pause, Play, ShieldAlert, ShieldCheck, SlidersHorizontal, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AttackLab } from "./AttackLab";
import { EffectsProvider, useEffectsSetting, useTransition } from "./effects";
import { Ambient, AnimatedNumber, PageMotion, ReduceEffectsSwitch } from "./motion-kit";
import { Scene3D } from "./three/Scene3D";
import { EvidenceInspector } from "./EvidenceInspector";
import { PlanView, type Plan } from "./PlanView";
import { ValueDashboard } from "./ValueDashboard";
import { money, personName, withCurrencyCodes } from "./money";
import { TechProvider, TechSwitch, Tour, tourDone, useTech } from "./tech";
import { Chip, ConfirmDialog, Empty, ErrorState, Hash, InfoTip, SkeletonRows, StatusChip, TERMS, TierBadge, ToastProvider, statusWord, useToast } from "./ui";

const API = import.meta.env.VITE_AGENT_API_URL ?? "http://127.0.0.1:8787";
export const POSITIONING = "Guardian Wallet: a trust and control layer for autonomous AI finance. Let AI handle your financial tasks, without giving up control of your money.";
const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";
const backendNames: Record<string, string> = { fisco: "FISCO BCOS", "evm-local": "Local Anvil (dev fallback)" };

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
type Page = { href: string; label: string; icon: IconType; lead: string };
/** The four tabs. Older hash routes still open the page their content moved to. */
const pages: Page[] = [
  { href: "/", label: "Home", icon: House, lead: "" },
  { href: "/activity", label: "Activity", icon: History, lead: "Everything your AI did, newest first." },
  { href: "/controls", label: "Controls", icon: SlidersHorizontal, lead: "Set your limits, choose who the AI may pay, and pause it." },
  { href: "/security", label: "Security", icon: ShieldCheck, lead: "Proof that the safeguards work, for reviewers." },
];
const securityTabs = [
  { key: "attack-lab", label: "Attack Lab", icon: ShieldAlert },
  { key: "evidence", label: "Evidence Inspector", icon: FileCheck2 },
  { key: "evaluation", label: "Evaluation", icon: BarChart3 },
] as const;
type SecurityTab = typeof securityTabs[number]["key"];
const aliases: Record<string, string> = {
  "/agent": "/", "/wallet": "/activity", "/control": "/controls", "/policy": "/controls",
  "/attack-lab": "/security/attack-lab", "/evidence": "/security/evidence", "/evaluation": "/security/evaluation", "/value": "/security/evaluation", "/security": "/security/attack-lab",
};

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
type Decide = (id: string, kind: "approve" | "reject") => Promise<PendingDecision | undefined>;

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
  if (!id) return "someone";
  const label = contacts.find((contact) => contact.id === id)?.label;
  return label ? label.split(/\s+[-–·]\s+/)[0]! : personName(id);
};

function parseRoute(hash: string): { route: string; security: SecurityTab } {
  const raw = hash || "/";
  const path = aliases[raw] ?? raw;
  if (path.startsWith("/security")) {
    const tab = path.split("/")[2] as SecurityTab | undefined;
    return { route: "/security", security: securityTabs.some((item) => item.key === tab) ? tab! : "attack-lab" };
  }
  return { route: pages.some((page) => page.href === path) ? path : "/", security: "attack-lab" };
}

export default function App() {
  return <EffectsProvider><TechProvider><ToastProvider><Console /></ToastProvider></TechProvider></EffectsProvider>;
}

function Console() {
  const toast = useToast();
  const [dark, setDark] = useState(true);
  const [hash, setHash] = useState(location.hash.slice(1));
  const { route, security } = parseRoute(hash);
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
  const [decisions, setDecisions] = useState<PendingDecision[]>([]);
  const [tour, setTour] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [nextState, nextPending, nextContacts, nextAudit] = await Promise.all([api<State>("/state"), api<Pending[]>("/pending"), api<Contact[]>("/contacts"), api<AuditEntry[]>("/audit")]);
      setState(nextState); setPending(nextPending.filter((item) => item.status === "PENDING")); setContacts(nextContacts); setAudit(nextAudit.slice().reverse()); setError(""); setLoaded(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent service unavailable"); }
    try { setChain(await api<Chain>("/chain")); } catch { setChain(undefined); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5_000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const change = () => { setHash(location.hash.slice(1)); scrollTo(0, 0); }; addEventListener("hashchange", change); return () => removeEventListener("hashchange", change); }, []);
  useEffect(() => { document.title = `${page.label} · Guardian Wallet`; }, [page.label]);
  // On the root element so the page background and dialogs follow the theme too.
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  // First visit: a short tour of Home once the balances are in.
  useEffect(() => { if (loaded && route === "/" && !tourDone()) setTour(true); }, [loaded, route]);

  async function setPaused(paused: boolean) {
    setConfirmPause(false); setSwitching(true);
    try {
      await ownerApi(paused ? "/owner/pause" : "/owner/unpause", { method: "POST", body: "{}" });
      await refresh();
      toast({ tone: "ok", text: paused ? "AI paused. Confirmed on chain." : "AI resumed. Confirmed on chain." });
    } catch (cause) { toast({ tone: "bad", text: `Could not ${paused ? "pause" : "resume"}: ${cause instanceof Error ? cause.message : "request failed"}` }); }
    finally { setSwitching(false); }
  }
  /** Approve or decline; reported as done only after the receipt and the contract's new status. */
  const decide: Decide = async (id, kind) => {
    const result = await ownerApi<PendingDecision>(`/owner/pending/${id}/${kind}`, { method: "POST", body: "{}" });
    const expected = kind === "approve" ? "EXECUTED" : "REJECTED";
    if (result.status !== "success" || result.pendingStatus !== expected) throw new Error(`Chain did not confirm: request #${id} is ${result.pendingStatus}`);
    setDecisions((current) => [result, ...current]);
    toast(kind === "approve" ? { tone: "ok", text: "Approved and paid.", action: { label: "View proof", href: "#/activity" } } : { tone: "info", text: "Declined. Nothing was paid.", action: { label: "View proof", href: "#/activity" } });
    await refresh();
    return result;
  };
  const bannerMotion = useTransition({ type: "spring", stiffness: 420, damping: 36 });
  const askPause = () => setConfirmPause(true);
  const resume = () => void setPaused(false);
  function showTour() { if (route !== "/") location.hash = "/"; setTour(true); }

  return <div>
    <div className="app-root min-h-screen bg-page text-fg">
      <Ambient />
      <div className="relative z-[1] flex min-h-screen min-w-0 flex-col">
        <TopBar route={route} chain={chain} dark={dark} setDark={setDark} showTour={showTour} />
        <AnimatePresence initial={false}>{state.paused && <motion.div key="paused" data-testid="paused-banner" role="status" initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -24, opacity: 0 }} transition={bannerMotion} className="relative z-[19] border-b border-[color-mix(in_srgb,var(--color-warn)_30%,transparent)] bg-warn-bg">
          <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-3 text-body font-medium text-warn lg:px-10">
            <span className="inline-flex items-center gap-2"><Hand aria-hidden className="size-4" />Paused. The AI can't pay anyone.</span>
            <button data-testid="banner-resume" onClick={resume} disabled={switching} className="secondary-button"><Play aria-hidden className="size-4" />Resume AI</button>
          </div>
        </motion.div>}</AnimatePresence>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-5 py-8 md:px-8"><PageMotion routeKey={`${route}${route === "/security" ? security : ""}`}>
          {route === "/" ? <h1 data-testid="page-title" className="sr-only">Home</h1> : <section className="page-heading">
            <h1 data-testid="page-title" className="font-display text-display font-medium tracking-tight">{page.label}</h1>
            <p data-testid="page-lead" className="mt-1 text-body text-fg2">{page.lead}</p>
          </section>}
          {error && <ErrorState message={`Cannot reach the agent service: ${error}`} retry={() => void refresh()} />}
          {route === "/" && <Home state={state} pending={pending} contacts={contacts} loaded={loaded} decisions={decisions} decide={decide} refresh={refresh} askPause={askPause} resume={resume} switching={switching} />}
          {route === "/activity" && <Activity entries={audit} contacts={contacts} loaded={loaded} />}
          {route === "/controls" && <Controls state={state} contacts={contacts} refresh={refresh} askPause={askPause} resume={resume} switching={switching} />}
          {route === "/security" && <Security tab={security} />}
        </PageMotion></main>
        <Footer />
      </div>
    </div>
    <ConfirmDialog open={confirmPause} title="Pause AI?" confirmLabel="Pause AI" danger onCancel={() => setConfirmPause(false)} onConfirm={() => void setPaused(true)}>
      The AI can't pay anyone until you resume.
    </ConfirmDialog>
    <Tour open={tour && route === "/"} onClose={() => setTour(false)} />
  </div>;
}

function TopBar({ route, chain, dark, setDark, showTour }: { route: string; chain: Chain | undefined; dark: boolean; setDark(value: boolean): void; showTour(): void }) {
  const { reduced } = useEffectsSetting();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    addEventListener("mousedown", close); addEventListener("keydown", close);
    return () => { removeEventListener("mousedown", close); removeEventListener("keydown", close); };
  }, [menu]);
  return <header className="top-bar sticky top-0 z-20 border-b border-line bg-page/95 backdrop-blur-sm">
    <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-2 px-5 py-3 md:px-8">
      <a href="#/" className="mr-auto inline-flex min-h-10 items-center gap-3" aria-label="Guardian Wallet Home">
        <span aria-hidden className="grid size-10 place-items-center rounded-full bg-cobalt text-ink"><ShieldCheck className="size-5" /></span>
        <span className="font-display text-heading font-medium">Guardian Wallet</span>
      </a>
      <nav aria-label="Main" className="glass-bar glass order-3 flex w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 lg:order-none lg:w-auto">
        {pages.map(({ href, label, icon: Icon }) => {
          const active = route === href;
          return <a key={href} href={`#${href}`} aria-current={active ? "page" : undefined} className={`nav-pill ${active ? "nav-pill-active" : ""}`}>{active && !reduced && <motion.span aria-hidden layoutId="nav-glow" className="nav-glow" transition={{ type: "spring", stiffness: 480, damping: 40 }} />}<Icon aria-hidden className="size-4 shrink-0" /><span>{label}</span></a>;
        })}
      </nav>
      <span className="status-pill border-line bg-surface text-fg2" title="Read from the node by the agent">
        <span aria-hidden className={`size-2 rounded-full ${chain ? "bg-ok" : "bg-muted"}`} />
        <span data-testid="chain-badge" className="mono">{chain ? `${backendNames[chain.backend] ?? chain.backend} · ${chain.chainId} · #${chain.blockHeight}` : "Disconnected"}</span>
      </span>
      <TechSwitch />
      <ReduceEffectsSwitch />
      <button aria-label="Toggle color mode" className="icon-button" onClick={() => setDark(!dark)}>{dark ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}</button>
      <div ref={menuRef} className="relative">
        <button aria-label="Menu" aria-haspopup="menu" aria-expanded={menu} className="icon-button" onClick={() => setMenu(!menu)}><Menu aria-hidden className="size-4" /></button>
        {menu && <div role="menu" className="glass card-tight absolute right-0 z-30 mt-2 w-56 !p-2">
          <button role="menuitem" type="button" onClick={() => { setMenu(false); showTour(); }} className="w-full rounded-control px-3 py-2 text-left text-body hover:bg-inner">Show tour again</button>
        </div>}
      </div>
    </div>
  </header>;
}

function Footer() {
  return <footer className="border-t border-line px-6 py-4 text-small text-muted lg:px-10">
    <div className="mx-auto max-w-[1200px] space-y-1">
      <p data-testid="positioning">{POSITIONING}</p>
      <p>Research prototype. Demo money on a simulated ledger, no real money. Permissioned FISCO BCOS chain operated by the team.</p>
      <p data-testid="footer-disclaimer">{CNY_DISCLAIMER}</p>
    </div>
  </footer>;
}

// ------------------------------------------------------------------ Home

/** Example chips: what the user reads, and the exact request sent to the agent. */
const EXAMPLES = [
  { label: "Pay Ana $50", message: "Pay Ana 50 USD" },
  { label: "Pay Ana $250", message: "Pay Ana 250 USD", tour: "approval" },
  { label: "Save ¥200", message: "Save 200 CNY" },
  { label: "Pay Ana $50, then save ¥200", message: "Pay Ana 50 USD, then save 200 CNY" },
];

function Home({ state, pending, contacts, loaded, decisions, decide, refresh, askPause, resume, switching }: { state: State; pending: Pending[]; contacts: Contact[]; loaded: boolean; decisions: PendingDecision[]; decide: Decide; refresh(): Promise<void>; askPause(): void; resume(): void; switching: boolean }) {
  return <div className="space-y-6">
    <section aria-label="Balances" className="grid gap-4 md:grid-cols-2">
      {!loaded ? [0, 1].map((key) => <div key={key} className="card"><SkeletonRows rows={3} /></div>)
        : state.balances.length === 0 ? <div className="md:col-span-2"><Empty text="No demo money yet. Seed the demo ledger to see it here." /></div>
        : state.balances.map((balance) => <BalanceCard key={balance.code} balance={balance} />)}
    </section>
    <Ask state={state} contacts={contacts} decide={decide} refresh={refresh} />
    <Waiting pending={pending} contacts={contacts} state={state} decisions={decisions} decide={decide} />
    <section className="card flex flex-wrap items-center justify-between gap-4">
      <p className="inline-flex items-center gap-1 text-body text-fg2">{state.paused ? "The AI is paused. Only you can resume." : "Stops the AI from paying anyone."}<InfoTip term="pause" text={TERMS.pause} /></p>
      {state.paused
        ? <button data-testid="kill-switch" data-tour="pause" onClick={resume} disabled={switching} className="primary-button min-h-14 px-8 text-heading"><Play aria-hidden className="size-5" />{switching ? "Resuming…" : "Resume AI"}</button>
        : <button data-testid="kill-switch" data-tour="pause" onClick={askPause} disabled={switching} className="danger-button min-h-14 px-8 text-heading"><Pause aria-hidden className="size-5" />{switching ? "Pausing…" : "Pause AI"}</button>}
    </section>
  </div>;
}

function BalanceCard({ balance }: { balance: Balance }) {
  return <div className={`card bank-card bank-card-${balance.code.toLowerCase()}`} data-testid="balance-card">
    <div className="flex items-start justify-between gap-2">
      <p className="label">{balance.code}</p>
      <span className="inline-flex items-center gap-1"><span data-testid="demo-balance" className="code-tag">Demo money</span><InfoTip term="demo money" text={TERMS.demoBalance} /></span>
    </div>
    <p data-testid="balance-amount" className="figure hero-number whitespace-nowrap"><AnimatedNumber value={money(balance.available, balance.code)} /></p>
    <p data-testid="balance-savings" className="mt-2 text-body text-fg2">Savings {money(balance.savings, balance.code)}</p>
    {balance.disclaimer && <p data-testid="currency-disclaimer" className="mt-3 text-small text-muted">{balance.disclaimer}</p>}
  </div>;
}

function Ask({ state, contacts, decide, refresh }: { state: State; contacts: Contact[]; decide: Decide; refresh(): Promise<void> }) {
  const [message, setMessage] = useState(""); const [result, setResult] = useState<ChatResult>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [last, setLast] = useState(""); const [answers, setAnswers] = useState(0);
  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true); setError(""); setLast(text);
    try { const next = await api<ChatResult>("/chat", { method: "POST", body: JSON.stringify({ message: withCurrencyCodes(text), source: "trusted", sourceRefs: ["web:chat"] }) }); setResult(next); setAnswers((count) => count + 1); setMessage(""); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The AI did not answer"); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(message); }
  async function planChanged(plan: Plan) { setResult((current) => current ? { ...current, route: "PLAN", plan } : current); await refresh(); }
  return <section className="home-hero has-scene card" data-tour="ask">
    <Scene3D kind="shield" className="hero-scene" />
    <form onSubmit={submit}>
      <label htmlFor="ask-input" className="block font-display text-[clamp(1.75rem,3vw,2.5rem)] font-light leading-tight tracking-[-.03em]">What should your AI do?</label>
      <div className="mt-4 flex gap-3">
        <input id="ask-input" aria-label="What should your AI do?" value={message} onChange={(event) => setMessage(event.target.value)} className="field min-h-14 flex-1 px-5 text-heading" placeholder="Pay Ana $50" autoComplete="off" />
        <button disabled={busy} className="primary-button min-h-14 min-w-28 text-heading">{busy ? "Checking…" : "Send"}</button>
      </div>
    </form>
    <div className="mt-3 flex flex-wrap gap-2">
      {EXAMPLES.map((example) => <button key={example.label} type="button" data-tour={example.tour} onClick={() => void send(example.message)} disabled={busy} className="min-h-10 rounded-full border border-line bg-surface px-4 py-2 text-body text-fg hover:border-cobalt">{example.label}</button>)}
    </div>
    {error && <div className="mt-4"><ErrorState message={error} retry={() => void send(last)} /></div>}
    {busy && <div className="mt-4" role="status" aria-label="Checking your request"><SkeletonRows rows={2} /></div>}
    {result && !busy && <Receipt key={answers} result={result} state={state} contacts={contacts} decide={decide} send={send} onPlanChange={planChanged} />}
  </section>;
}

type Tone = "ok" | "warn" | "bad" | "info";
const toneIcon: Record<Tone, IconType> = { ok: CircleCheck, warn: Clock, bad: Ban, info: CircleHelp };

/** The answer as a simple receipt: one plain sentence from backend values, then actions; details on demand. */
function Receipt({ result, state, contacts, decide, send, onPlanChange }: { result: ChatResult; state: State; contacts: Contact[]; decide: Decide; send(text: string): Promise<void>; onPlanChange(plan: Plan): Promise<void> }) {
  const { on: tech } = useTech();
  const [details, setDetails] = useState(false);
  const [proof, setProof] = useState(false);
  const [decided, setDecided] = useState<{ kind: "approve" | "reject"; decision: PendingDecision }>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const proposal = result.proposal;
  const currency = proposal?.currency ?? "USD";
  const amount = money(proposal?.amount, currency);
  const who = contactName(contacts, proposal?.recipientContactId);
  const flags = result.flags ?? [];
  const question = result.clarification?.questions.join(" ") ?? "";
  // A question about who to pay: the recipient is missing or is not one of the contacts.
  const askedContact = /contact\s+([a-z][a-z0-9_-]*)/i.exec(question)?.[1]?.toLowerCase();
  const askWho = result.route === "ANSWER_ONLY" && (/which contact/i.test(question) || (askedContact !== undefined && !contacts.some((contact) => contact.id === askedContact)));
  const missingAmount = /receive\s+([0-9.]+)\s+([A-Z]{3})/.exec(question);

  let tone: Tone; let sentence: string;
  if (decided) {
    tone = decided.kind === "approve" ? "ok" : "info";
    sentence = decided.kind === "approve" ? `Paid ${amount} to ${who}` : "Declined. Nothing was paid.";
  } else if (result.plan) {
    ({ tone, sentence } = planSentence(result.plan, contacts));
  } else switch (result.route) {
    case "EXECUTED": tone = "ok"; sentence = proposal?.kind === "save" ? `Moved ${amount} to savings` : `Paid ${amount} to ${who}`; break;
    case "NEEDS_APPROVAL": tone = "warn"; sentence = `Needs your OK: ${amount} to ${who}. ${approvalReason(result.why?.decidedBy.rule, flags, proposal?.amount, currency, state.approvalThreshold, result.why?.riskScore)}`; break;
    case "BLOCKED": tone = "bad"; sentence = blockedSentence(flags, result.why, amount, currency, who, state); break;
    case "ANSWER_ONLY": tone = "info"; sentence = askWho ? "Who should I pay?" : question.replace(/contact\s+([a-z][a-z0-9_-]*)/gi, (_match, id: string) => contactName(contacts, id.toLowerCase())) || "Can you tell me a bit more?"; break;
    case "SCHEDULED": case "SCHEDULE_READY": tone = "ok"; sentence = `Scheduled: ${amount} to ${who}`; break;
    default: tone = "info"; sentence = result.explanation;
  }
  const Icon = toneIcon[tone];
  const proofHash = decided?.decision.transactionHash ?? (result.route === "EXECUTED" ? result.transactionHash : undefined);
  const proofBlock = decided?.decision.blockNumber ?? result.blockNumber;
  const code = decided ? (decided.kind === "approve" ? "EXECUTED" : "REJECTED") : result.plan ? result.plan.status : result.route;
  async function act(kind: "approve" | "reject") {
    if (!result.pendingId) return;
    setBusy(kind); setError("");
    try { const decision = await decide(result.pendingId, kind); if (decision) setDecided({ kind, decision }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Decision failed"); }
    finally { setBusy(""); }
  }
  const showDetails = tech || details;
  return <div data-testid="chat-result" className={`receipt receipt-${tone} mt-5`}>
    <div className="flex items-start gap-4">
      <span aria-hidden className={`receipt-icon receipt-icon-${tone}`}><Icon className="size-7" /></span>
      <div className="min-w-0 flex-1">
        <StatusChip code={code} testId="chat-status" codeTestId="chat-status-code" />
        <p data-testid="chat-summary" className="mt-1 font-display text-figure font-medium">{sentence}</p>
      </div>
    </div>
    {result.plan && !decided && <SimplePlan plan={result.plan} contacts={contacts} onChange={onPlanChange} />}
    {result.route === "NEEDS_APPROVAL" && !decided && result.pendingId && <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
      <button data-testid="receipt-approve" onClick={() => void act("approve")} disabled={busy !== ""} className="primary-button min-h-12">{busy === "approve" ? "Waiting for chain…" : "Approve"}</button>
      <button data-testid="receipt-decline" onClick={() => void act("reject")} disabled={busy !== ""} className="danger-button min-h-12">{busy === "reject" ? "Waiting for chain…" : "Decline"}</button>
    </div>}
    {askWho && <div className="mt-4 flex flex-wrap gap-2">{contacts.filter((contact) => contact.allowed).map((contact) => {
      const name = contactName(contacts, contact.id);
      return <button key={contact.id} type="button" data-testid={`ask-contact-${contact.id}`} onClick={() => void send(missingAmount ? `Pay ${name} ${missingAmount[1]} ${missingAmount[2]}` : `Pay ${name}`)} className="min-h-12 rounded-full border border-line bg-surface px-5 text-heading font-medium hover:border-cobalt">{name}</button>;
    })}</div>}
    {error && <p role="alert" className="mt-3 rounded-control bg-bad-bg p-3 text-body text-bad">{error}</p>}
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-small">
      {proofHash && <span className="inline-flex items-center gap-1"><button type="button" data-testid="view-proof" onClick={() => setProof(!proof)} className="text-muted underline-offset-2 hover:underline">{proof ? "Hide proof" : "View proof"}</button><InfoTip term="proof" text={TERMS.proof} /></span>}
      {!tech && <button type="button" data-testid="show-details" onClick={() => setDetails(!details)} className="text-muted underline-offset-2 hover:underline">{details ? "Hide details" : "Show details"}</button>}
    </div>
    {proof && proofHash && <div className="mt-3"><Proof hash={proofHash} block={proofBlock} /></div>}
    {showDetails && <div data-testid="chat-details" className="mt-4 space-y-4 rounded-control border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-small text-fg2">
        <span>Status <code className="code-tag">{code}</code></span>
        {result.tier && <span className="inline-flex items-center gap-1">Permission <TierBadge tier={result.tier} testId="chat-tier" codeTestId="chat-tier-code" /></span>}
        {result.risk && <span>Risk score <b className="text-fg">{result.risk.score}/100</b></span>}
      </div>
      <p className="text-body text-fg2">{result.explanation}</p>
      {question && <p className="text-small text-muted">Agent question: {question}</p>}
      {result.plan && <PlanView plan={result.plan} api={api} onChange={onPlanChange} actions={false} />}
      {result.why && <WhyPanel why={result.why} />}
      {result.transactionHash && <Proof hash={result.transactionHash} block={result.blockNumber} />}
    </div>}
  </div>;
}

function approvalReason(rule: string | undefined, flags: string[], amount: string | undefined, currency: string, threshold: string, riskScore?: number | null): string {
  if (rule === "APPROVAL_THRESHOLD") return `It's ${Number(amount) > Number(threshold) ? "above" : "at"} your ${money(threshold, currency).replace(/\.00$/, "")} limit.`;
  if (flags.includes("UNTRUSTED_SOURCE_REQUIRES_APPROVAL")) return "It came from a source you haven't trusted.";
  if (flags.includes("OWNER_PLAN_APPROVAL_CAP")) return "You asked to approve this one.";
  if (riskScore !== null && riskScore !== undefined && riskScore >= 60) return "It looks unusual.";
  return "It needs you to decide.";
}

function blockedSentence(flags: string[], why: WhyDecision | undefined, amount: string, currency: string, who: string, state: State): string {
  const limit = (value: string) => money(value, currency).replace(/\.00$/, "");
  if (flags.includes("OVER_PER_TX_LIMIT")) return `Blocked: ${amount} is above your ${limit(state.perTxLimit)} limit.`;
  if (flags.includes("OVER_DAILY_LIMIT")) return `Blocked: ${amount} would go over your ${limit(state.dailyLimit)} daily limit.`;
  if (flags.includes("PAUSED")) return "Blocked: the AI is paused.";
  if (flags.includes("UNKNOWN_CONTACT")) return `Blocked: ${who} isn't one of your recipients.`;
  if (flags.includes("RECIPIENT_NOT_ACTIVE")) return `Blocked: ${who} is still in a waiting period.`;
  if (flags.includes("INSUFFICIENT_BALANCE")) return "Blocked: not enough demo money.";
  if (flags.includes("POLICY_CHANGE_ATTEMPT")) return "Blocked: only you can change your limits.";
  if (flags.includes("INSTRUCTION_INJECTION") || flags.includes("ADDRESS_INJECTION")) return "Blocked: the request had instructions the AI refuses.";
  if (flags.includes("RECIPIENT_SWAP")) return "Blocked: the recipient didn't match.";
  if (why?.decidedBy.rule === "RISK_SCORE_AT_LEAST_85") return "Blocked: this looks too risky.";
  return "Blocked.";
}

function stepText(step: Plan["steps"][number], contacts: Contact[]): string {
  const value = money(step.proposal.amount, step.proposal.currency ?? "USD");
  return step.proposal.kind === "save" ? `Save ${value}` : `Pay ${contactName(contacts, step.proposal.recipientContactId)} ${value}`;
}

function planSentence(plan: Plan, contacts: Contact[]): { tone: Tone; sentence: string } {
  const done = plan.steps.filter((step) => step.state === "EXECUTED").length;
  const stopIndex = plan.stoppedAt ?? plan.steps.findIndex((step) => step.status === "STOPPED");
  const stopped = stopIndex >= 0 ? plan.steps[stopIndex] : undefined;
  if (plan.status === "DRAFT") return { tone: "info", sentence: `Ready: ${plan.steps.length} steps, checked and not yet run.` };
  if (plan.status === "COMPLETED") return { tone: "ok", sentence: `Done: all ${plan.steps.length} steps.` };
  if (plan.status === "WAITING_APPROVAL") return { tone: "warn", sentence: `Needs your OK: ${stopped ? stepText(stopped, contacts) : "a step"}. ${done} of ${plan.steps.length} done.` };
  if (plan.status === "CANCELLED") return { tone: "info", sentence: "Cancelled. Nothing ran." };
  return { tone: "bad", sentence: `Stopped at ${stopped ? stepText(stopped, contacts) : "a step"}. ${done} of ${plan.steps.length} done.` };
}

/** Plan steps in plain words, with Run and Cancel while it is a draft. */
function SimplePlan({ plan, contacts, onChange }: { plan: Plan; contacts: Contact[]; onChange(plan: Plan): Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function act(kind: "run" | "cancel") {
    setBusy(kind); setError("");
    try { await onChange(await api<Plan>(kind === "run" ? `/plans/${plan.id}/execute` : `/plans/${plan.id}`, { method: kind === "run" ? "POST" : "DELETE", ...(kind === "run" ? { body: "{}" } : {}) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Plan request failed"); }
    finally { setBusy(""); }
  }
  const disclaimers = [...new Set(plan.steps.flatMap((step) => step.disclaimer ? [step.disclaimer] : []))];
  return <div className="mt-4 space-y-3">
    <ol className="space-y-2">{plan.steps.map((step, index) => <li key={step.id} data-testid={`simple-step-${step.id}`} className="flex items-center justify-between gap-3 rounded-control bg-inner px-4 py-3">
      <span className="text-body"><span className="mr-2 text-muted">{index + 1}.</span>{stepText(step, contacts)}</span><StatusChip code={step.state} />
    </li>)}</ol>
    {plan.approvalCap && <p className="text-small text-muted">Ask me before anything above {money(plan.approvalCap.amount, plan.approvalCap.currency)}.</p>}
    {disclaimers.map((text) => <p key={text} className="text-small text-muted">{text}</p>)}
    {error && <ErrorState message={error} retry={() => void act("run")} />}
    {plan.status === "DRAFT" && <div className="flex gap-3">
      <button data-testid="plan-run" onClick={() => void act("run")} disabled={busy !== ""} className="primary-button min-h-12"><Play aria-hidden className="size-4" />{busy === "run" ? "Running…" : "Run plan"}</button>
      <button data-testid="plan-cancel" onClick={() => void act("cancel")} disabled={busy !== ""} className="secondary-button min-h-12">Cancel</button>
    </div>}
  </div>;
}

/** Transaction hash and block, with Verify asking the node for the receipt again. */
function Proof({ hash, block }: { hash: string; block?: string | undefined }) {
  const [receipt, setReceipt] = useState<string>();
  async function verify() {
    setReceipt("Asking the chain…");
    try { const fetched = await api<{ status: string; blockNumber: string }>(`/receipt/${hash}`); setReceipt(`Receipt ${fetched.status} · block ${fetched.blockNumber}`); }
    catch { setReceipt("Receipt not found on the node"); }
  }
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-control bg-inner p-3 text-body">
    <span className="inline-flex items-center gap-2"><span className="label">Transaction</span><Hash value={hash} testId="proof-tx" /></span>
    {block && <span className="inline-flex items-center gap-2"><span className="label">Block</span><span className="mono">#{block}</span></span>}
    <button data-testid="proof-verify" onClick={() => void verify()} className="secondary-button"><ShieldCheck aria-hidden className="size-4" />Verify</button>
    {receipt && <span data-testid="proof-receipt" className="text-body font-medium">{receipt}</span>}
  </div>;
}

function timeLeft(expiresAt: string): string {
  const ms = Number(expiresAt) * 1000 - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / 3_600_000); const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours} h ${minutes} min left` : `${minutes} min left`;
}

/** Requests the contract holds for the owner; shown only while something is waiting. */
function Waiting({ pending, contacts, state, decisions, decide }: { pending: Pending[]; contacts: Contact[]; state: State; decisions: PendingDecision[]; decide: Decide }) {
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function act(id: string, kind: "approve" | "reject") {
    setBusy(`${kind}-${id}`); setErrors((current) => ({ ...current, [id]: "" }));
    try { await decide(id, kind); } catch (cause) { setErrors((current) => ({ ...current, [id]: cause instanceof Error ? cause.message : "Decision failed" })); }
    finally { setBusy(""); }
  }
  if (pending.length === 0 && decisions.length === 0) return null;
  return <section className="card" aria-labelledby="waiting-title">
    {pending.length > 0 && <h2 id="waiting-title" className="section-title mb-4">Waiting for your OK</h2>}
    {decisions.length > 0 && <ul data-testid="pending-confirmations" className="mb-4 space-y-2">{decisions.map((item) => <li key={item.transactionHash} data-testid={`confirmed-${item.pendingId}`} className="flex flex-wrap items-center gap-x-2 rounded-control border border-[color-mix(in_srgb,var(--color-ok)_25%,transparent)] bg-ok-bg px-4 py-3 text-body font-medium text-ok"><CheckCircle2 aria-hidden className="size-4" />Request #{item.pendingId} {item.pendingStatus === "EXECUTED" ? "approved and paid" : "declined"} · confirmed on chain in block {item.blockNumber}</li>)}</ul>}
    <div data-testid="approval-inbox" className="space-y-3">
      <AnimatePresence initial={false}>{pending.map((item) => <PendingRow key={item.id} item={item} name={contactName(contacts, item.recipientContactId)} threshold={state.approvalThreshold} busy={busy} error={errors[item.id] ?? ""} act={act} />)}</AnimatePresence>
    </div>
  </section>;
}

function PendingRow({ item, name, threshold, busy, error, act }: { item: Pending; name: string; threshold: string; busy: string; error: string; act(id: string, kind: "approve" | "reject"): Promise<void> }) {
  const { on: tech } = useTech();
  const collapse = useTransition({ type: "spring", stiffness: 420, damping: 40 });
  const rules = [...new Set([...(item.why ? [item.why.decidedBy.rule] : []), ...(item.flags ?? []), ...(item.why?.factors.map((factor) => factor.code) ?? [])])];
  return <motion.article layout data-testid={`pending-${item.id}`} exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0 }} transition={collapse} className="overflow-hidden rounded-control bg-inner p-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="font-display text-figure font-medium"><span data-testid="pending-sentence">{money(item.amount, item.currency)} to {name}</span></p>
        <p data-testid="pending-why" className="text-body text-fg2">{approvalReason(item.why?.decidedBy.rule, item.flags ?? [], item.amount, item.currency, threshold, item.why?.riskScore)} <span data-testid="pending-time-left" className="text-muted">{timeLeft(item.expiresAt)}</span></p>
      </div>
      <div className="flex gap-3">
        <button data-testid={`approve-${item.id}`} onClick={() => void act(item.id, "approve")} disabled={busy !== ""} className="primary-button min-h-12 min-w-28">{busy === `approve-${item.id}` ? "Waiting for chain…" : "Approve"}</button>
        <button data-testid={`reject-${item.id}`} onClick={() => void act(item.id, "reject")} disabled={busy !== ""} className="danger-button min-h-12 min-w-28">{busy === `reject-${item.id}` ? "Waiting for chain…" : "Decline"}</button>
      </div>
    </div>
    {item.disclaimer && <p data-testid="currency-disclaimer" className="mt-2 text-small text-muted">{item.disclaimer}</p>}
    {error && <p data-testid={`pending-error-${item.id}`} role="alert" className="mt-3 rounded-control bg-bad-bg p-3 text-body text-bad">{error}</p>}
    {tech && <div data-testid={`pending-details-${item.id}`} className="mt-4 space-y-3 border-t border-line pt-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Operation" value={<span className="mono">{item.operation ?? "requestApproval"}</span>} testId="pending-operation" />
        <Field label="Amount" value={item.amount} testId="pending-amount" />
        <Field label="Currency" value={item.currency} testId="pending-currency" />
        <Field label="Recipient" value={item.recipientContactId} testId="pending-recipient" />
        <Field label="Risk score" value={item.why?.riskScore === null || item.why?.riskScore === undefined ? "Not scored" : `${item.why.riskScore}/100`} testId="pending-risk" />
        <Field label="Expires" value={new Date(Number(item.expiresAt) * 1000).toLocaleString()} testId="pending-expiry" />
      </dl>
      <p className="label">Agent reasoning</p>
      <p data-testid="pending-reasoning" className="text-body">{item.agentReasoning || "Not recorded."}</p>
      <ul data-testid="pending-rules" className="flex flex-wrap gap-1.5">{rules.map((rule) => <li key={rule} className="code-tag">{rule}</li>)}</ul>
      {item.why && <WhyPanel why={item.why} testId={`why-panel-${item.id}`} />}
    </div>}
  </motion.article>;
}

function Field({ label, value, testId }: { label: ReactNode; value: ReactNode; testId: string }) {
  return <div><dt className="label">{label}</dt><dd data-testid={testId} className="text-body font-medium">{value}</dd></div>;
}

/** Explains one decision with the risk score, its real factors, and the rule that decided the outcome. */
function WhyPanel({ why, testId = "why-panel" }: { why: WhyDecision; testId?: string }) {
  return <section data-testid={testId} className="rounded-control border border-line bg-surface p-4 text-left">
    <div className="flex flex-wrap items-center justify-between gap-2"><b className="font-display text-heading font-semibold">Why this action?</b><StatusChip code={why.decision} /></div>
    <dl className="mt-3 grid gap-3 sm:grid-cols-3">
      <div><dt className="label">Risk score</dt><dd data-testid="why-score" className="figure text-figure">{why.riskScore === null ? "Not scored" : `${why.riskScore}/100`}</dd></div>
      <div><dt className="label">Risk class</dt><dd data-testid="why-class" className="text-body font-medium capitalize">{why.riskClass}</dd></div>
      <div><dt className="label">Your OK</dt><dd data-testid="why-approval" className="text-body font-medium">{why.decidedBy.ownerApprovalRequired ? "Required" : "Not required"}</dd></div>
    </dl>
    {why.riskScore !== null && <div className="risk-track mt-4" aria-label={`Risk score ${why.riskScore} out of 100`}><span className="risk-fill" style={{ width: `${why.riskScore}%` }} /><i style={{ left: "60%" }}>60</i><i style={{ left: "85%" }}>85</i></div>}
    <p className="label mt-3">Risk factors the engine computed</p>
    {why.factors.length === 0 ? <p data-testid="why-factors" className="mt-1 text-body text-fg2">No risk factors applied to this action.</p> : <ul data-testid="why-factors" className="mt-1 space-y-1 text-body">{why.factors.map((factor) => <li key={factor.code} className="flex flex-wrap items-baseline gap-x-2"><b className="mono font-medium">+{factor.points}</b><span className="text-fg2">{factor.explanation}</span><code className="code-tag ml-auto">{factor.code}</code></li>)}</ul>}
    <div className="mt-3 rounded-control bg-inner p-3"><p className="label">Decided by</p><p data-testid="why-decided-by" className="text-body font-medium">{why.decidedBy.layer} · {why.decidedBy.rule.replaceAll("_", " ")}</p><p className="mt-1 text-body text-fg2">{why.decidedBy.detail}</p></div>
  </section>;
}

// ------------------------------------------------------------------ Activity

type Row = { tone: Tone | "neutral" | "paused"; status: string; sentence: string; filter: "done" | "waiting" | "blocked" | "other" };
/** Kinds a normal user cares about; the rest appear with Technical details on. */
const userKinds = new Set(["pipeline_result", "pending_approved", "pending_rejected", "wallet_paused", "wallet_unpaused", "policy_updated", "recipient_updated", "plan_completed", "plan_stopped", "plan_cancelled"]);

function describe(entry: AuditEntry, contacts: Contact[]): Row {
  const decision = (entry.data.decision ?? {}) as Record<string, unknown>;
  const proposal = entry.data.proposal as Proposal | undefined;
  const outcome = typeof decision.outcome === "string" ? decision.outcome : undefined;
  const what = proposal?.amount ? (proposal.kind === "save" ? `${money(proposal.amount, proposal.currency)} to savings` : `${money(proposal.amount, proposal.currency)} to ${contactName(contacts, proposal.recipientContactId)}`) : "";
  switch (entry.kind) {
    case "pipeline_result":
      if (outcome === "EXECUTED") return { tone: "ok", status: "Done", sentence: what ? (proposal?.kind === "save" ? `Moved ${what}` : `Paid ${what}`) : "Finished a request", filter: "done" };
      if (outcome === "NEEDS_APPROVAL") return { tone: "warn", status: "Needs your OK", sentence: what ? `Asked your OK: ${what}` : "Asked your OK", filter: "waiting" };
      if (outcome === "BLOCKED") return { tone: "bad", status: "Blocked", sentence: what ? `Blocked: ${what}` : "Blocked a request", filter: "blocked" };
      if (outcome === "ANSWER_ONLY") return { tone: "info", status: "Asking you", sentence: "Asked you a question", filter: "other" };
      return { tone: "info", status: statusWord(outcome ?? "recorded"), sentence: what ? `Scheduled ${what}` : "Recorded a decision", filter: "other" };
    case "pending_approved": return { tone: "ok", status: "Done", sentence: "You approved a payment", filter: "done" };
    case "pending_rejected": return { tone: "neutral", status: "Declined", sentence: "You declined a payment", filter: "other" };
    case "wallet_paused": return { tone: "paused", status: "Paused", sentence: "You paused the AI", filter: "other" };
    case "wallet_unpaused": return { tone: "ok", status: "Done", sentence: "You resumed the AI", filter: "other" };
    case "policy_updated": return { tone: "ok", status: "Done", sentence: "You changed your limits", filter: "other" };
    case "recipient_updated": return { tone: "ok", status: "Done", sentence: "You changed your recipients", filter: "other" };
    case "plan_completed": return { tone: "ok", status: "Done", sentence: "A plan finished", filter: "done" };
    case "plan_stopped": return { tone: "bad", status: "Stopped", sentence: "A plan stopped", filter: "blocked" };
    case "plan_cancelled": return { tone: "neutral", status: "Cancelled", sentence: "You cancelled a plan", filter: "other" };
    default: return { tone: "neutral", status: "Recorded", sentence: entry.kind.replaceAll("_", " "), filter: "other" };
  }
}
const rowChip: Record<Row["tone"], "ok" | "warn" | "bad" | "info" | "neutral"> = { ok: "ok", warn: "warn", bad: "bad", info: "info", neutral: "neutral", paused: "warn" };
const rowIcon: Record<Row["tone"], IconType> = { ok: CircleCheck, warn: Clock, bad: Ban, info: CircleHelp, neutral: CircleDot, paused: Hand };

function Activity({ entries, contacts, loaded }: { entries: AuditEntry[]; contacts: Contact[]; loaded: boolean }) {
  const { on: tech } = useTech();
  const [filter, setFilter] = useState<"all" | "done" | "waiting" | "blocked">("all");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const rows = useMemo(() => entries.filter((entry) => tech || userKinds.has(entry.kind)).map((entry) => ({ entry, row: describe(entry, contacts) })), [entries, contacts, tech]);
  const shown = rows.filter(({ row }) => filter === "all" || row.filter === filter);
  return <div className="space-y-4">
    <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
      {(["all", "done", "waiting", "blocked"] as const).map((key) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`currency-switch border border-line ${filter === key ? "currency-switch-active" : ""}`}>{{ all: "All", done: "Done", waiting: "Waiting", blocked: "Blocked" }[key]}</button>)}
    </div>
    <section className="card !p-2 sm:!p-3">
      {!loaded ? <div className="p-4"><SkeletonRows rows={5} /></div> : shown.length === 0 ? <Empty text={rows.length === 0 ? "Nothing yet. Ask your AI to do something on Home." : "Nothing here for this filter."} /> : <ul className="divide-y divide-line">
        {shown.map(({ entry, row }) => {
          const Icon = rowIcon[row.tone];
          const decision = (entry.data.decision ?? {}) as Record<string, unknown>;
          const hash = (decision.transactionHash ?? entry.data.transactionHash) as string | undefined;
          const block = (decision.blockNumber ?? entry.data.blockNumber) as string | undefined;
          const why = entry.data.why as WhyDecision | undefined;
          const expanded = Boolean(open[entry.id]);
          return <li key={entry.id} data-testid={`activity-${entry.id}`}>
            <button type="button" data-testid={`why-toggle-${entry.id}`} aria-expanded={expanded} onClick={() => setOpen((current) => ({ ...current, [entry.id]: !current[entry.id] }))} className="flex w-full items-center gap-4 rounded-control px-3 py-3 text-left hover:bg-inner">
              <span aria-hidden className={`receipt-icon receipt-icon-${rowChip[row.tone]} !size-10`}><Icon className="size-5" /></span>
              <span className="min-w-0 flex-1"><span className="block text-body font-medium">{row.sentence}</span><span className="text-small text-muted">{new Date(entry.timestamp).toLocaleString()}</span></span>
              <Chip tone={rowChip[row.tone]}>{row.status}</Chip>
              <ChevronDown aria-hidden className={`size-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
            {expanded && <div className="space-y-3 px-3 pb-4 sm:pl-[4.75rem]">
              {hash ? <Proof hash={hash} block={block} /> : <p className="text-small text-muted">Nothing was sent to the chain for this one.</p>}
              {tech && <p className="text-small text-fg2">Recorded as <code className="code-tag">{entry.kind}</code>{typeof decision.outcome === "string" && <> · <code className="code-tag">{decision.outcome}</code></>}{typeof decision.tier === "string" && <> · <code className="code-tag">{decision.tier}</code></>}</p>}
              {why && <WhyPanel why={why} testId={`why-panel-audit-${entry.id}`} />}
            </div>}
          </li>;
        })}
      </ul>}
    </section>
  </div>;
}

// ------------------------------------------------------------------ Controls

const policyFields = [["Most per payment", "perTxLimit"], ["Most per day", "dailyLimit"], ["Ask me at or above", "approvalThreshold"], ["Wait after a recipient changes (seconds)", "recipientCooldown"]] as const;

function Controls({ state, contacts, refresh, askPause, resume, switching }: { state: State; contacts: Contact[]; refresh(): Promise<void>; askPause(): void; resume(): void; switching: boolean }) {
  const toast = useToast();
  const { on: tech } = useTech();
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
  return <div className="space-y-6">
    <section className="card flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="section-title">{state.paused ? "The AI is paused" : "The AI is on"}</h2><p className="inline-flex items-center gap-1 text-body text-fg2">{state.paused ? "Only you can resume it." : "Stops the AI from paying anyone."}<InfoTip term="pause" text={TERMS.pause} /></p></div>
      {state.paused ? <button data-testid="kill-switch" onClick={resume} disabled={switching} className="primary-button min-h-12"><Play aria-hidden className="size-4" />{switching ? "Resuming…" : "Resume AI"}</button> : <button data-testid="kill-switch" onClick={askPause} disabled={switching} className="danger-button min-h-12"><Pause aria-hidden className="size-4" />{switching ? "Pausing…" : "Pause AI"}</button>}
    </section>
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card">
        <h2 className="section-title">Limits</h2>
        <p className="mt-1 text-body text-fg2">The wallet contract enforces these, not only the AI.</p>
        <form onSubmit={(event) => void save(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
          {policyFields.map(([label, key]) => <label key={key} className="text-body font-medium">{label}
            <span className="mt-1.5 flex items-center gap-2">{key !== "recipientCooldown" && <span className="text-body text-fg2">$</span>}<input className="field w-full tabular-nums" inputMode="decimal" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></span>
          </label>)}
          <button disabled={saving} className="primary-button min-h-12 sm:col-span-2">{saving ? "Saving on chain…" : "Save limits"}</button>
        </form>
      </section>
      <section className="card">
        <h2 className="section-title">Recipients</h2>
        <p className="mt-1 text-body text-fg2">The AI can only pay these people.</p>
        {contacts.length === 0 ? <div className="mt-4"><Empty text="No recipients yet." /></div> : <ul className="mt-4 space-y-2">{contacts.map((contact) => {
          const cooling = Number(contact.activeAfter) * 1000 > Date.now();
          return <li key={contact.id} className="flex items-center justify-between gap-3 rounded-control bg-inner px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden className="grid size-10 place-items-center rounded-full border border-line bg-surface font-display text-heading">{contactName(contacts, contact.id).charAt(0)}</span>
              <div className="min-w-0"><b className="block font-medium">{contactName(contacts, contact.id)}</b>{tech && <span className="mono text-muted">{contact.id} · {contact.address.slice(0, 6)}…{contact.address.slice(-4)}</span>}</div>
            </div>
            <div className="text-right">
              {cooling ? <Chip tone="warn" icon={Clock}>Waiting until {new Date(Number(contact.activeAfter) * 1000).toLocaleTimeString()}</Chip> : contact.allowed ? <Chip tone="ok" icon={CircleCheck}>Allowed</Chip> : <Chip tone="neutral" icon={CircleDot}>Not allowed</Chip>}
            </div>
          </li>;
        })}</ul>}
      </section>
    </div>
  </div>;
}

// ------------------------------------------------------------------ Security

function Security({ tab }: { tab: SecurityTab }) {
  return <div className="space-y-6">
    <nav aria-label="Security sections" className="flex flex-wrap gap-2">
      {securityTabs.map(({ key, label, icon: Icon }) => <a key={key} href={`#/security/${key}`} aria-current={tab === key ? "page" : undefined} className={`nav-pill border border-line ${tab === key ? "nav-pill-active" : ""}`}><Icon aria-hidden className="size-4" /><span>{label}</span></a>)}
    </nav>
    <h2 data-testid="security-title" className="sr-only">{securityTabs.find((item) => item.key === tab)!.label}</h2>
    {tab === "attack-lab" && <AttackLab api={api} />}
    {tab === "evidence" && <EvidenceInspector api={api} />}
    {tab === "evaluation" && <ValueDashboard api={api} />}
  </div>;
}
