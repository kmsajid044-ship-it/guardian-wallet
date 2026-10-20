import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEffectsSetting } from "../effects";

/*
 * Lazy 3D slot. A static gradient poster is always rendered; the WebGL canvas (three.js, loaded on
 * demand so other pages never download it) draws on top only when effects are on and WebGL works.
 * Rendering pauses while the tab is hidden or the slot is off-screen.
 */

const ShieldCanvas = lazy(() => import("./ShieldCanvas"));
const CubeCanvas = lazy(() => import("./CubeCanvas"));

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch { return false; }
}

/** True while the element is at least partly on screen and the tab is visible. */
function useActive(ref: React.RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") { setOnScreen(true); return; }
    const observer = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), { threshold: 0.01 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  useEffect(() => {
    const change = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  return onScreen && tabVisible;
}

/** A failing canvas (lost context, driver issue) falls back to the poster instead of breaking the page. */
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? null : this.props.children; }
}

export function Scene3D({ kind, pulses = 0, className = "" }: { kind: "shield" | "cube"; pulses?: number; className?: string }) {
  const { reduced } = useEffectsSetting();
  const webgl = useMemo(webglAvailable, []);
  const ref = useRef<HTMLDivElement>(null);
  const active = useActive(ref);
  return <div ref={ref} aria-hidden data-testid={`scene-${kind}`} className={`relative ${className}`}>
    <div className="scene-poster" />
    {!reduced && webgl && <CanvasBoundary><Suspense fallback={null}>
      {kind === "shield" ? <ShieldCanvas active={active} /> : <CubeCanvas active={active} pulses={pulses} />}
    </Suspense></CanvasBoundary>}
  </div>;
}
