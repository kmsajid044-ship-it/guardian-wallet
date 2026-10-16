import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AttackLab } from "./AttackLab";
import { ValueDashboard } from "./ValueDashboard";

const API = import.meta.env.VITE_AGENT_API_URL ?? "http://127.0.0.1:8787";
const footer = "Simulated ledger, demo units, no real money. Permissioned chain operated by the team. Research prototype.";

/** One configured demo unit (config/currencies.json); CNY entries carry the required disclaimer. */
type Balance = { code: string; name: string; available: string; savings: string; disclaimer?: string };
type State = { paused: boolean; balances: Balance[]; spentToday: string; remainingDaily: string; perTxLimit: string; dailyLimit: string; approvalThreshold: string; recipientCooldown: string; pendingExpiry: string; opsPerCallLimit: string; opsDailyLimit: string };
type Pending = { id: string; recipientContactId: string; amount: string; currency: string; status: string; expiresAt: string; disclaimer?: string };
type Contact = { id: string; address: string; label: string; allowed: boolean; activeAfter: string };
type AuditEntry = { id: number; timestamp: string; kind: string; hash: string; data: Record<string, unknown> };
type ChatResult = { route: string; tier?: string; explanation: string; transactionHash?: string; blockNumber?: string; pendingId?: string; proposal?: { kind: string; amount?: string; currency?: string; recipientContactId?: string }; clarification?: { questions: string[] }; risk?: { score: number; factors: Array<{ code: string; explanation: string }> } };

const initialState: State = { paused: false, balances: [], spentToday: "—", remainingDaily: "—", perTxLimit: "500", dailyLimit: "1000", approvalThreshold: "200", recipientCooldown: "600", pendingExpiry: "86400", opsPerCallLimit: "0.1", opsDailyLimit: "5" };
const policyFields = [["Per-transfer limit", "perTxLimit"], ["Daily limit", "dailyLimit"], ["Approval threshold", "approvalThreshold"], ["Recipient cooldown (sec)", "recipientCooldown"]] as const;

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

export default function App() {
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  const [state, setState] = useState<State>(initialState);
  const [pending, setPending] = useState<Pending[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [nextState, nextPending, nextContacts, nextAudit] = await Promise.all([api<State>("/state"), api<Pending[]>("/pending"), api<Contact[]>("/contacts"), api<AuditEntry[]>("/audit")]);
      setState(nextState); setPending(nextPending.filter((item) => item.status === "PENDING")); setContacts(nextContacts); setAudit(nextAudit.slice().reverse()); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent service unavailable"); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5_000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const change = () => setRoute(location.hash.slice(1) || "/"); addEventListener("hashchange", change); return () => removeEventListener("hashchange", change); }, []);

  return <div className={dark ? "dark" : ""}>
    <div className="app-shell min-h-screen bg-[#f4f7f9] text-slate-950 transition-colors dark:bg-[#07110f] dark:text-slate-100">
      <Header dark={dark} setDark={setDark} paused={state.paused} />
      <main className="mx-auto min-h-[calc(100vh-148px)] max-w-[1600px] px-5 py-7 lg:px-10">
        {error && <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Connection notice: {error}</div>}
        {route === "/" && <Dashboard state={state} pending={pending} audit={audit} refresh={refresh} />}
        {route === "/policy" && <Policy state={state} contacts={contacts} refresh={refresh} />}
        {route === "/attack-lab" && <AttackLab api={api} />}
        {route === "/value" && <ValueDashboard api={api} />}
      </main>
      <footer className="border-t border-slate-200 bg-white/80 px-6 py-5 text-center text-sm font-medium text-slate-500 dark:border-white/10 dark:bg-[#0b1714] dark:text-slate-400">{footer}</footer>
    </div>
  </div>;
}

function Header({ dark, setDark, paused }: { dark: boolean; setDark(value: boolean): void; paused: boolean }) {
  const links = [["/", "Operations"], ["/policy", "Policy"], ["/attack-lab", "Attack Lab"], ["/value", "Value Dashboard"]];
  return <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur-xl dark:border-white/10 dark:bg-[#0b1714]/90">
    <div className="mx-auto flex max-w-[1600px] items-center gap-7 px-5 py-4 lg:px-10">
      <a href="#/" className="mr-auto flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-emerald-600 text-lg font-black text-white">G</span><span><b className="block text-base leading-none">Guardian</b><small className="text-xs text-slate-500">Owner Console</small></span></a>
      <nav className="hidden items-center gap-1 lg:flex">{links.map(([href,label])=><a key={href} href={`#${href}`} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">{label}</a>)}</nav>
      <span className={`status-pill ${paused ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"}`}><span className={`size-2 rounded-full ${paused ? "bg-rose-500" : "bg-emerald-500"}`}/>{paused ? "Paused" : "Active"}</span>
      <button aria-label="Toggle color mode" className="icon-button" onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</button>
    </div>
  </header>;
}

function Dashboard({ state, pending, audit, refresh }: { state: State; pending: Pending[]; audit: AuditEntry[]; refresh(): Promise<void> }) {
  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="eyebrow">Permissioned operations</p><h1 className="page-title">Good afternoon, owner.</h1><p className="mt-2 text-slate-500 dark:text-slate-400">Review decisions, approve exceptions, and stay in control.</p></div><KillSwitch paused={state.paused} refresh={refresh}/></section>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {state.balances.map((balance)=><BalanceCard key={balance.code} label={`${balance.code} available`} value={balance.available} savings={`${balance.savings} ${balance.code}`} disclaimer={balance.disclaimer}/>)}
      <Metric label="Daily capacity" value={`${state.remainingDaily} USD`} sub={`${state.spentToday} used today`}/><Metric label="FX reference" value="1 USD = 7.10 CNY" sub="Illustrative cached snapshot of 2026-10-16 · not a market rate · read only, never used to compute amounts"/>
    </section>
    <section className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]"><Chat refresh={refresh}/><ApprovalInbox items={pending} refresh={refresh}/></section>
    <AuditLog entries={audit}/>
  </div>;
}

function Chat({ refresh }: { refresh(): Promise<void> }) {
  const [message,setMessage]=useState(""); const [result,setResult]=useState<ChatResult>(); const [busy,setBusy]=useState(false);
  async function submit(event: FormEvent){event.preventDefault();if(!message.trim())return;setBusy(true);try{const next=await api<ChatResult>("/chat",{method:"POST",body:JSON.stringify({message,source:"trusted",sourceRefs:["web:chat"]})});setResult(next);setMessage("");await refresh();}finally{setBusy(false)}}
  const steps=useMemo(()=>result?[{label:"Intent understood",done:true},{label:"Firewall passed",done:result.route!=="BLOCKED"},{label:"Policy & simulation",done:["EXECUTED","NEEDS_APPROVAL"].includes(result.route)},{label:result.route==="NEEDS_APPROVAL"?"Owner approval required":"Execution complete",done:result.route==="EXECUTED"}]:[],[result]);
  return <Card title="Agent workspace" kicker="Ask in plain language">
    <div className="mb-5 rounded-2xl bg-slate-50 p-5 dark:bg-white/[.04]"><p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Try “Pay Ana 100 USD”, “Save 50 USD”, or ask for a recurring payment.</p></div>
    {result && <div data-testid="chat-result" className="mb-5 space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-900 dark:bg-emerald-950/20">
      <div className="flex items-center justify-between"><b>{result.route.replaceAll("_"," ")}</b><span className="status-pill bg-white text-slate-700 dark:bg-white/10 dark:text-slate-200">{result.tier ?? "T0"}</span></div><p className="text-sm text-slate-600 dark:text-slate-300">{result.explanation}</p>
      {result.clarification && <div className="rounded-xl bg-amber-100 p-3 text-sm font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">{result.clarification.questions.join(" ")}</div>}
      <ol className="grid gap-2 md:grid-cols-2">{steps.map((step,index)=><li key={step.label} className="flex items-center gap-2 text-sm"><span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${step.done?"bg-emerald-600 text-white":"bg-slate-200 text-slate-500 dark:bg-white/10"}`}>{index+1}</span>{step.label}</li>)}</ol>
      {result.risk && <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Risk score {result.risk.score}/100</p>}
    </div>}
    <form onSubmit={submit} className="flex gap-3"><input aria-label="Message the agent" value={message} onChange={event=>setMessage(event.target.value)} className="field flex-1" placeholder="What would you like the agent to do?"/><button disabled={busy} className="primary-button">{busy?"Checking…":"Send"}</button></form>
  </Card>;
}

function ApprovalInbox({items,refresh}:{items:Pending[];refresh():Promise<void>}){const [busy,setBusy]=useState("");async function approve(id:string){setBusy(id);try{await ownerApi(`/owner/pending/${id}/approve`,{method:"POST",body:"{}"});await refresh();}finally{setBusy("")}}return <Card title="Approval inbox" kicker={`${items.length} waiting`}>
  <div data-testid="approval-inbox" className="space-y-3">{items.length===0?<Empty text="No items need your approval."/>:items.map(item=><article key={item.id} className="rounded-2xl border border-slate-200 p-4 dark:border-white/10"><div className="flex items-start justify-between"><div><b className="text-lg">{item.amount} {item.currency}</b><p className="text-sm text-slate-500">Contact {item.recipientContactId}</p>{item.disclaimer&&<p data-testid="currency-disclaimer" className="mt-1 text-xs text-slate-500">{item.disclaimer}</p>}</div><span className="status-pill bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">T2</span></div><button data-testid={`approve-${item.id}`} onClick={()=>void approve(item.id)} disabled={busy===item.id} className="primary-button mt-4 w-full">{busy===item.id?"Approving…":"Review & approve"}</button></article>)}</div>
  </Card>}

function KillSwitch({paused,refresh}:{paused:boolean;refresh():Promise<void>}){const [busy,setBusy]=useState(false);async function toggle(){setBusy(true);try{await ownerApi(paused?"/owner/unpause":"/owner/pause",{method:"POST",body:"{}"});await refresh();}finally{setBusy(false)}}return <button data-testid="kill-switch" onClick={()=>void toggle()} disabled={busy} className={`flex min-w-52 items-center justify-between rounded-2xl border px-5 py-4 text-left shadow-sm ${paused?"border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100":"border-rose-200 bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100"}`}><span><small className="block font-semibold uppercase tracking-wider opacity-60">Kill switch</small><b>{busy?"Updating…":paused?"Resume agent":"Pause agent"}</b></span><span className="text-xl">{paused?"▶":"■"}</span></button>}

function AuditLog({entries}:{entries:AuditEntry[]}){const [verified,setVerified]=useState<Record<number,string>>({});async function verify(entry:AuditEntry){const decision=(entry.data.decision??{}) as Record<string,unknown>;const hash=(decision.transactionHash??entry.data.transactionHash) as string|undefined;if(!hash){setVerified(v=>({...v,[entry.id]:"No transaction"}));return}try{const receipt=await api<{blockNumber:string}>(`/receipt/${hash}`);setVerified(v=>({...v,[entry.id]:`Verified · block ${receipt.blockNumber}`}));}catch{setVerified(v=>({...v,[entry.id]:"Not found"}))}}return <Card title="Live audit log" kicker="Hash-chained decisions"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-400"><tr><th>Event</th><th>Decision</th><th>Transaction</th><th>Block</th><th>Time</th><th/></tr></thead><tbody>{entries.slice(0,8).map(entry=>{const decision=(entry.data.decision??{}) as Record<string,unknown>;const hash=(decision.transactionHash??entry.data.transactionHash) as string|undefined;const block=(decision.blockNumber??entry.data.blockNumber) as string|undefined;return <tr key={entry.id} className="border-t border-slate-100 dark:border-white/10"><td className="py-4 font-semibold">{entry.kind.replaceAll("_"," ")}</td><td>{String(decision.outcome??"recorded")}</td><td className="font-mono text-xs">{hash?`${hash.slice(0,8)}…${hash.slice(-6)}`:"—"}</td><td>{block??"—"}</td><td>{new Date(entry.timestamp).toLocaleTimeString()}</td><td><button onClick={()=>void verify(entry)} className="secondary-button">{verified[entry.id]??"Verify"}</button></td></tr>})}</tbody></table></div></Card>}

function Policy({state,contacts,refresh}:{state:State;contacts:Contact[];refresh():Promise<void>}){const [form,setForm]=useState(state);const [saved,setSaved]=useState(false);useEffect(()=>setForm(state),[state]);async function save(event:FormEvent){event.preventDefault();await ownerApi("/owner/policy",{method:"PUT",body:JSON.stringify({perTxLimit:form.perTxLimit,dailyLimit:form.dailyLimit,approvalThreshold:form.approvalThreshold,recipientCooldown:Number(form.recipientCooldown),pendingExpiry:Number(form.pendingExpiry),opsPerCallLimit:form.opsPerCallLimit,opsDailyLimit:form.opsDailyLimit})});setSaved(true);await refresh()}return <div className="space-y-7"><div><p className="eyebrow">T3 · Owner only</p><h1 className="page-title">Policy settings</h1><p className="mt-2 text-slate-500">Changes are enforced by the wallet contract.</p></div><div className="grid gap-6 xl:grid-cols-2"><Card title="Spending limits" kicker="USD demo units"><form onSubmit={save} className="grid gap-4 sm:grid-cols-2">{policyFields.map(([label,key])=><label key={key} className="text-sm font-semibold">{label}<input className="field mt-2 w-full" value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}<button className="primary-button sm:col-span-2">{saved?"Saved on ledger":"Save policy"}</button></form></Card><Card title="Recipient allowlist" kicker="Contact IDs only"><div className="space-y-3">{contacts.map(contact=><div key={contact.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-4 dark:border-white/10"><div><b>{contact.label||contact.id}</b><p className="font-mono text-xs text-slate-400">{contact.id} · {contact.address.slice(0,10)}…</p></div><span className={`status-pill ${contact.allowed?"bg-emerald-100 text-emerald-700":"bg-slate-100 text-slate-500"}`}>{contact.allowed?"Allowed":"Disabled"}</span></div>)}</div></Card></div></div>}

function Card({title,kicker,children}:{title:string;kicker:string;children:ReactNode}){return <section className="card"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold">{title}</h2><span className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">{kicker}</span></div>{children}</section>}
function BalanceCard({label,value,savings,disclaimer}:{label:string;value:string;savings:string;disclaimer?:string|undefined}){return <div className="card"><p className="eyebrow">{label}</p><p className="mt-3 text-4xl font-bold tracking-tight">{value}</p><p className="mt-3 text-sm text-slate-500">{savings} in savings</p>{disclaimer&&<p data-testid="currency-disclaimer" className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{disclaimer}</p>}</div>}
function Metric({label,value,sub}:{label:string;value:string;sub:string}){return <div className="card"><p className="eyebrow">{label}</p><p className="mt-3 text-2xl font-bold">{value}</p><p className="mt-3 text-sm text-slate-500">{sub}</p></div>}
function Empty({text}:{text:string}){return <div className="grid min-h-36 place-items-center rounded-2xl border border-dashed border-slate-300 text-sm text-slate-400 dark:border-white/15">{text}</div>}
