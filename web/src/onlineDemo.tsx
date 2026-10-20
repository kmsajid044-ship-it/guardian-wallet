import { useState } from "react";
import { Globe, RotateCcw } from "lucide-react";

// Hosted online demo only. Built with VITE_DEMO_PUBLIC=1 inside the demo container, where the
// gateway serves this console and the agent on one origin and adds the owner session itself.
// The chain is named from what the agent reads from the node; Anvil is never labelled FISCO BCOS.

export const PUBLIC_DEMO = import.meta.env.VITE_DEMO_PUBLIC === "1";
export const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";

export type DemoInfo = { status: string; backend: string; chainId: number; chainLabel: string; idleResetMinutes: number; chatLimitPerMinute: number; llmHourlyCap: number | null };

/** Chain pill text in the online demo. */
export function onlineChainLabel(backend: string): string {
  return backend === "fisco" ? "FISCO BCOS · online demo" : "private EVM development chain (Anvil)";
}

/** Banner sentence for the chain that is actually running. */
export function onlineBannerText(backend: string): string {
  return backend === "fisco"
    ? "Online demo: a 4-node FISCO BCOS network running inside this container, operated by the team. Fresh chain on every restart. Recorded execution evidence is in the GitHub repo."
    : "Online demo: a private EVM development chain (Anvil) running inside this container, operated by the team. Fresh chain on every restart. Recorded FISCO BCOS execution evidence is in the GitHub repo.";
}

/** Footer line naming the chain the console is connected to. */
export function chainSentence(backend: string | undefined): string {
  if (PUBLIC_DEMO && backend === "evm-local") return "Private EVM development chain (Anvil) operated by the team.";
  return "Permissioned FISCO BCOS chain operated by the team.";
}

export function OnlineDemoBanner({ backend, onReset }: { backend: string | undefined; onReset(): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <div data-testid="online-demo-banner" role="note" className="relative z-[19] border-b border-line bg-inner">
    <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-start justify-between gap-3 px-6 py-3 text-small text-fg2 lg:px-10">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="inline-flex items-start gap-2 font-medium text-fg"><Globe aria-hidden className="mt-0.5 size-4 shrink-0" /><span data-testid="online-demo-text">{backend ? onlineBannerText(backend) : "Online demo: connecting to the chain running inside this container."}</span></p>
        <p data-testid="online-demo-disclaimer">{CNY_DISCLAIMER}</p>
      </div>
      <button data-testid="demo-reset" type="button" className="secondary-button" disabled={busy} onClick={() => { setBusy(true); void onReset().finally(() => setBusy(false)); }}>
        <RotateCcw aria-hidden className="size-4" />{busy ? "Resetting…" : "Reset demo"}
      </button>
    </div>
  </div>;
}

/** Asks the gateway for a fresh deployment and waits until the demo answers again. */
export async function resetOnlineDemo(apiBase: string, timeoutMs = 240_000): Promise<void> {
  const response = await fetch(`${apiBase}/demo/reset`, { method: "POST" });
  if (response.status !== 202 && response.status !== 409) throw new Error(`Reset refused (${response.status})`);
  const deadline = Date.now() + timeoutMs;
  await new Promise((done) => setTimeout(done, 2_000));
  while (Date.now() < deadline) {
    try {
      const info = await (await fetch(`${apiBase}/demo/info`, { cache: "no-store" })).json() as DemoInfo;
      if (info.status === "ready") return;
      if (info.status === "failed") throw new Error("Reset failed; reload the page in a minute");
    } catch (error) { if (error instanceof Error && error.message.startsWith("Reset failed")) throw error; }
    await new Promise((done) => setTimeout(done, 2_000));
  }
  throw new Error("Reset is taking longer than expected; reload the page in a minute");
}
