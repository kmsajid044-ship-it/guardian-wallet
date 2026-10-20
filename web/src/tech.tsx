import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Code2 } from "lucide-react";

/*
 * "Technical details": off by default for a normal user. When on, every card shows the backend
 * codes, permission tiers, risk factors, hashes, and the Why-this-action panel inline. Remembered
 * per browser; storage failures (private windows) only mean the choice lasts for this visit.
 */

const TECH_KEY = "guardian-technical-details";
const TOUR_KEY = "guardian-tour-done";

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* keep it for this visit */ } };

type Tech = { on: boolean; setOn(value: boolean): void };
const TechContext = createContext<Tech>({ on: false, setOn: () => undefined });
export const useTech = () => useContext(TechContext);

export function TechProvider({ children }: { children: ReactNode }) {
  const [on, setOnState] = useState(() => read(TECH_KEY) === "1");
  const setOn = useCallback((value: boolean) => { setOnState(value); write(TECH_KEY, value ? "1" : "0"); }, []);
  const value = useMemo(() => ({ on, setOn }), [on, setOn]);
  return <TechContext.Provider value={value}>{children}</TechContext.Provider>;
}

export function TechSwitch() {
  const { on, setOn } = useTech();
  return <button type="button" role="switch" aria-checked={on} data-testid="tech-switch" onClick={() => setOn(!on)} className={`effects-switch ${on ? "effects-switch-on" : ""}`}>
    <Code2 aria-hidden className="size-4" /><span className="hidden text-small font-semibold 2xl:inline">Technical details</span><span className="sr-only 2xl:hidden">Technical details</span>
    <span className="effects-switch-track" aria-hidden><span className="effects-switch-thumb" /></span>
  </button>;
}

// ------------------------------------------------------------------ first-time tour

export const TOUR_STEPS = [
  { target: "ask", title: "Tell your AI what to do", text: "Type a request or tap an example." },
  { target: "approval", title: "Big payments wait for your OK", text: "Anything above your limit stops here until you approve." },
  { target: "pause", title: "Pause stops everything", text: "One tap and the AI cannot pay anyone." },
] as const;

export function tourDone(): boolean { return read(TOUR_KEY) === "1"; }
export function markTourDone(): void { write(TOUR_KEY, "1"); }

/** Three-step popover tour anchored to elements marked with data-tour. Esc or Skip ends it. */
export function Tour({ open, onClose }: { open: boolean; onClose(): void }) {
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<DOMRect>();
  useEffect(() => { if (open) setStep(0); }, [open]);
  const current = TOUR_STEPS[step]!;
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const target = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
      if (!target) { setBox(undefined); return; }
      target.scrollIntoView({ block: "center", behavior: "auto" });
      setBox(target.getBoundingClientRect());
    };
    place();
    addEventListener("resize", place); addEventListener("scroll", place, true);
    return () => { removeEventListener("resize", place); removeEventListener("scroll", place, true); };
  }, [open, current.target]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") finish(); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });
  if (!open) return null;
  function finish() { markTourDone(); onClose(); }
  const last = step === TOUR_STEPS.length - 1;
  const top = box ? Math.min(box.bottom + 12, innerHeight - 190) : innerHeight / 2 - 80;
  const left = box ? Math.max(16, Math.min(box.left, innerWidth - 356)) : innerWidth / 2 - 170;
  return <>
    {box && <div aria-hidden className="tour-ring" style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }} />}
    <div role="dialog" aria-modal="false" aria-labelledby="tour-title" data-testid="tour" className="tour-pop" style={{ top, left }}>
      <p className="label">Step {step + 1} of {TOUR_STEPS.length}</p>
      <h2 id="tour-title" className="mt-1 font-display text-figure font-medium">{current.title}</h2>
      <p className="mt-1 text-body text-fg2">{current.text}</p>
      <div className="mt-4 flex justify-between gap-3">
        <button type="button" onClick={finish} className="secondary-button">Skip</button>
        {last ? <button type="button" onClick={finish} className="primary-button" autoFocus>Done</button>
          : <button type="button" onClick={() => setStep(step + 1)} className="primary-button" autoFocus>Next</button>}
      </div>
    </div>
  </>;
}
