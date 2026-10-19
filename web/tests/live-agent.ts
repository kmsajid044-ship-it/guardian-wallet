import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Page } from "@playwright/test";

/** The page's built-in agent URL; live tests redirect it to the real server they started. */
export const PAGE_API = "http://127.0.0.1:8787";

export type LiveAgent = { apiUrl: string; rpcUrl: string; ownerSessionToken: string; stop(): Promise<void> };

/**
 * Starts the real agent API (agent/src/exec/e2eServer.ts): on a fresh local Anvil chain, or with
 * backend "fisco" on the configured local FISCO BCOS network. Nothing is mocked.
 */
export async function startLiveAgent(backend: "anvil" | "fisco" = "anvil"): Promise<LiveAgent> {
  const foundry = resolve(process.env.HOME ?? "", ".foundry/bin");
  // Per-run test session token for owner decisions; a random value, not a signing key.
  const ownerSessionToken = randomBytes(32).toString("hex");
  const server: ChildProcess = spawn("pnpm", ["exec", "tsx", "src/exec/e2eServer.ts"], {
    cwd: resolve(process.cwd(), "../agent"),
    env: { ...process.env, PATH: `${foundry}:${process.env.PATH ?? ""}`, E2E_OWNER_SESSION_TOKEN: ownerSessionToken, ...(backend === "fisco" ? { E2E_BACKEND: "fisco" } : {}) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lines = createInterface({ input: server.stdout! });
  const ready = await new Promise<{ apiUrl: string; rpcUrl: string }>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error("live agent did not start")), 90_000);
    server.once("exit", (code) => reject(new Error(`live agent exited with ${code}`)));
    lines.on("line", (line) => {
      if (!line.startsWith("{")) return;
      clearTimeout(timer);
      resolveReady(JSON.parse(line) as { apiUrl: string; rpcUrl: string });
    });
  });
  return {
    ...ready, ownerSessionToken,
    async stop() {
      if (server.exitCode !== null) return;
      const exited = new Promise((resolveExit) => server.once("exit", resolveExit));
      server.kill("SIGTERM");
      await exited;
    },
  };
}

/** Sends the page's agent requests to the live server and hands it that server's owner session. */
export async function useLiveAgent(page: Page, agent: LiveAgent): Promise<void> {
  await page.route(`${PAGE_API}/**`, (route) => route.continue({ url: route.request().url().replace(PAGE_API, agent.apiUrl) }));
  await page.route("**/__owner-session", (route) => route.fulfill({ json: { token: agent.ownerSessionToken }, headers: { "cache-control": "no-store" } }));
}
