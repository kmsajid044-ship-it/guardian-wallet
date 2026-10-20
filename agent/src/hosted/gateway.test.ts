import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clientIp, createGatewayHandler, IdleTracker, RateLimiter, type GatewayStatus } from "./gateway.js";

const token = "hosted-owner-session-0123456789abcdef0123456789";

describe("hosted demo gateway", () => {
  let agent: Server;
  let gateway: Server;
  let base: string;
  let directory: string;
  let status: GatewayStatus = "ready";
  let resets: string[] = [];
  const seen: Array<{ method: string; url: string; headers: IncomingHttpHeaders }> = [];
  const idle = new IdleTracker(60_000);

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "guardian-gateway-"));
    mkdirSync(join(directory, "dist", "assets"), { recursive: true });
    writeFileSync(join(directory, "dist", "index.html"), "<!doctype html><title>console</title>");
    writeFileSync(join(directory, "dist", "assets", "app.js"), "console.log('app')");
    writeFileSync(join(directory, "secret.txt"), "outside the web root");
    writeFileSync(join(directory, "fisco.json"), JSON.stringify({ chainId: 1337, guardianWallet: "0x01" }));
    agent = createServer((request, response) => {
      seen.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers });
      response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      response.end(JSON.stringify({ path: request.url }));
    });
    await new Promise<void>((done) => agent.listen(0, "127.0.0.1", done));
    gateway = createServer(createGatewayHandler({
      agentUrl: `http://127.0.0.1:${(agent.address() as AddressInfo).port}`,
      webDist: join(directory, "dist"),
      deploymentFile: join(directory, "fisco.json"),
      readOwnerToken: () => token,
      info: () => ({ backend: "fisco", chainId: 1337, chainLabel: "FISCO BCOS · online demo", nodeVersion: "3.16.4", startedAt: "2026-10-20T00:00:00.000Z" }),
      status: () => status,
      requestReset: (reason) => { resets.push(reason); return { accepted: true, message: "Resetting" }; },
      chatLimiter: new RateLimiter(3),
      chatLimitPerMinute: 3,
      idle,
      idleResetMinutes: 30,
      llmHourlyCap: 40,
    }));
    await new Promise<void>((done) => gateway.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((done) => gateway.close(done));
    await new Promise((done) => agent.close(done));
    rmSync(directory, { recursive: true, force: true });
  });

  beforeEach(() => { status = "ready"; resets = []; seen.length = 0; });

  it("adds the owner session server-side to /owner/* only and strips browser-supplied identity headers", async () => {
    const owner = await fetch(`${base}/api/owner/pause`, { method: "POST", headers: { origin: "https://attacker.example", "x-owner-session": "forged", "content-type": "application/json" }, body: "{}" });
    expect(owner.status).toBe(200);
    expect(await owner.json()).toEqual({ path: "/owner/pause" });
    expect(owner.headers.get("access-control-allow-origin")).toBeNull();
    const forwarded = seen.at(-1)!;
    expect(forwarded.headers["x-owner-session"]).toBe(token);
    expect(forwarded.headers.origin).toBeUndefined();
    expect(forwarded.headers.host).toMatch(/^127\.0\.0\.1:\d+$/);

    await fetch(`${base}/api/state?x=1`, { headers: { "x-owner-session": "forged" } });
    expect(seen.at(-1)).toMatchObject({ url: "/state?x=1" });
    expect(seen.at(-1)!.headers["x-owner-session"]).toBeUndefined();
  });

  it("rate-limits chat per client address and leaves reads alone", async () => {
    const chat = (ip: string) => fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` }, body: JSON.stringify({ message: "Pay ana 1 USD" }) });
    for (let index = 0; index < 3; index++) expect((await chat("203.0.113.7")).status).toBe(200);
    const limited = await chat("203.0.113.7");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await chat("198.51.100.4")).status).toBe(200);
    expect((await fetch(`${base}/api/state`)).status).toBe(200);
    expect(seen.filter((entry) => entry.url === "/chat")).toHaveLength(4);
  });

  it("answers 503 while resetting and accepts a reset request", async () => {
    status = "resetting";
    expect((await fetch(`${base}/api/state`)).status).toBe(503);
    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({ ok: false, status: "resetting", backend: "fisco", chainId: 1337 });
    status = "ready";
    expect((await fetch(`${base}/api/demo/reset`)).status).toBe(405);
    const reset = await fetch(`${base}/api/demo/reset`, { method: "POST" });
    expect(reset.status).toBe(202);
    expect(resets).toEqual(["visitor"]);
    expect(await (await fetch(`${base}/api/demo/info`)).json()).toMatchObject({ publicDemo: true, chainLabel: "FISCO BCOS · online demo", idleResetMinutes: 30, chatLimitPerMinute: 3, llmHourlyCap: 40 });
  });

  it("serves the console, the live deployment manifest, and never files outside the web root", async () => {
    expect(await (await fetch(`${base}/assets/app.js`)).text()).toContain("app");
    expect(await (await fetch(`${base}/activity`)).text()).toContain("console");
    expect(await (await fetch(`${base}/fisco.json`)).json()).toMatchObject({ chainId: 1337 });
    expect(await (await fetch(`${base}/..%2Fsecret.txt`)).text()).not.toContain("outside");
    expect(await (await fetch(`${base}/%2e%2e/secret.txt`)).text()).not.toContain("outside");
    expect((await fetch(`${base}/index.html`, { method: "POST" })).status).toBe(405);
  });

  it("marks the demo dirty only on state-changing calls", async () => {
    let now = 0;
    const tracker = new IdleTracker(1_000, () => now);
    expect(tracker.due()).toBe(false);
    tracker.touch();
    now = 999;
    expect(tracker.due()).toBe(false);
    now = 1_000;
    expect(tracker.due()).toBe(true);
    tracker.clear();
    now = 5_000;
    expect(tracker.due()).toBe(false);
  });

  it("takes the visitor address from the first forwarded entry", () => {
    expect(clientIp({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }, "10.0.0.2")).toBe("203.0.113.7");
    expect(clientIp({}, "10.0.0.2")).toBe("10.0.0.2");
    const limiter = new RateLimiter(1, 60_000, () => 0);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    expect(limiter.retryAfterSeconds("a")).toBe(60);
  });
});
