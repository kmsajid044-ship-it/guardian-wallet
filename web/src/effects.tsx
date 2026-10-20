import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MotionConfig, type Transition } from "motion/react";

/*
 * Visual effects switch. "Reduce effects" turns off the 3D canvases, the background colour blobs,
 * glass blur, and every non-essential animation (transitions become instant). It is remembered per
 * browser and is on automatically when the operating system asks for reduced motion.
 */

const STORAGE_KEY = "guardian-reduce-effects";
type Effects = { reduced: boolean; setReduced(value: boolean): void };
const EffectsContext = createContext<Effects>({ reduced: true, setReduced: () => undefined });
export const useEffectsSetting = () => useContext(EffectsContext);

function prefersReducedMotion(): boolean {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function storedPreference(): boolean | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === null ? undefined : value === "1";
  } catch { return undefined; }
}

export function EffectsProvider({ children }: { children: ReactNode }) {
  // The operating-system preference wins on load; otherwise the remembered choice; otherwise effects on.
  const [reduced, setReducedState] = useState(() => prefersReducedMotion() || (storedPreference() ?? false));
  const setReduced = useCallback((value: boolean) => {
    setReducedState(value);
    try { localStorage.setItem(STORAGE_KEY, value ? "1" : "0"); } catch { /* storage unavailable: keep it for this visit */ }
  }, []);
  useEffect(() => {
    let query: MediaQueryList | undefined;
    try { query = matchMedia("(prefers-reduced-motion: reduce)"); } catch { return; }
    const change = (event: MediaQueryListEvent) => { if (event.matches) setReducedState(true); };
    query.addEventListener("change", change);
    return () => query?.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("effects-reduced", reduced);
    document.documentElement.classList.toggle("effects-on", !reduced);
  }, [reduced]);
  const value = useMemo(() => ({ reduced, setReduced }), [reduced, setReduced]);
  return <EffectsContext.Provider value={value}>
    <MotionConfig reducedMotion={reduced ? "always" : "never"} transition={reduced ? { duration: 0 } : SPRING}>{children}</MotionConfig>
  </EffectsContext.Provider>;
}

/** Gentle spring: settles in about 300 ms without a long bounce. */
export const SPRING: Transition = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 };
/** Instant when effects are reduced, otherwise the given transition (default: the gentle spring). */
export function useTransition(transition: Transition = SPRING): Transition {
  const { reduced } = useEffectsSetting();
  return reduced ? { duration: 0 } : transition;
}
