import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, stagger } from "motion/react";
import { Sparkles } from "lucide-react";
import { useEffectsSetting } from "./effects";

/*
 * Small motion helpers. All of them are visual only: with effects reduced they render the final
 * state at once, and none of them ever changes the text a test or a screen reader reads at rest.
 */

/** Two or three very soft colour blobs behind the glass; nothing when effects are reduced. */
export function Ambient() {
  const { reduced } = useEffectsSetting();
  if (reduced) return null;
  return <div aria-hidden className="ambient"><span className="blob-lime" /><span className="blob-sky" /><span className="blob-lime-2" /></div>;
}

/** Page change: fade and a 12 px slide up, then the page's cards enter with a 40 ms stagger. */
export function PageMotion({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const { reduced } = useEffectsSetting();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (reduced || !root) return;
    const cards = [...root.querySelectorAll<HTMLElement>(":scope > div > .card, :scope > div > section:not(.card) > *")].slice(0, 24);
    if (cards.length === 0) return;
    const controls = animate(cards, { opacity: [0, 1], y: [10, 0] }, { duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: stagger(0.04) });
    return () => { controls.complete(); };
  }, [routeKey, reduced]);
  return <motion.div key={routeKey} ref={ref} className="space-y-8" initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 34, mass: 0.8 }}>
    {children}
  </motion.div>;
}

/**
 * A decimal string that counts up (or down) from the value shown before, over 600 ms. The text at
 * rest is always exactly `value`; while counting it keeps the same number of decimals.
 */
export function AnimatedNumber({ value }: { value: string }) {
  const { reduced } = useEffectsSetting();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = parse(previous.current);
    const to = parse(value);
    previous.current = value;
    if (reduced || from === undefined || to === undefined || from === to) { setShown(value); return; }
    const decimals = (value.split(".")[1] ?? "").length;
    const grouped = value.includes(",");
    const controls = animate(from, to, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: (latest) => setShown(format(latest, decimals, grouped)), onComplete: () => setShown(value) });
    return () => { controls.stop(); setShown(value); };
  }, [value, reduced]);
  return <>{shown}</>;
}
const parse = (text: string) => { const number = Number(text.replaceAll(",", "")); return text.trim() !== "" && Number.isFinite(number) ? number : undefined; };
const format = (number: number, decimals: number, grouped: boolean) => grouped
  ? number.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  : number.toFixed(decimals);

/** Top bar switch: turns off 3D, blobs, blur, and non-essential motion. */
export function ReduceEffectsSwitch() {
  const { reduced, setReduced } = useEffectsSetting();
  return <button type="button" role="switch" aria-checked={reduced} aria-label="Reduce effects" data-testid="reduce-effects" title={reduced ? "Effects reduced: no 3D, blur, or motion" : "Reduce effects: turn off 3D, blur, and motion"} onClick={() => setReduced(!reduced)} className={`effects-switch ${reduced ? "effects-switch-on" : ""}`}>
    <Sparkles aria-hidden className="size-4" /><span className="effects-switch-track" aria-hidden><span className="effects-switch-thumb" /></span>
  </button>;
}

/** True when the media query matches; re-evaluated on change. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => { try { return matchMedia(query).matches; } catch { return false; } });
  useEffect(() => {
    let list: MediaQueryList;
    try { list = matchMedia(query); } catch { return; }
    const change = () => setMatches(list.matches);
    change(); list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, [query]);
  return matches;
}
