import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

// Hosted online demo only (DEMO_PUBLIC=1, inside the demo container). One public port serves the
// built owner console and forwards /api/* to the agent on loopback, so there is no CORS. Every
// visitor is the demo owner: the gateway adds the per-run owner session token to /owner/* calls on
// the server side, and the token never reaches the browser. Research prototype; no real money.

export const OWNER_SESSION_HEADER = "x-owner-session";

/** Sliding one-minute window per key (client IP). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs = 60_000, private readonly now: () => number = Date.now) {}

  /** True when the call is allowed (and counted); false when the key is over the limit. */
  take(key: string): boolean {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(cutoff);
    return true;
  }

  retryAfterSeconds(key: string): number {
    const oldest = (this.hits.get(key) ?? [])[0];
    return oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 1_000));
  }

  private sweep(cutoff: number): void {
    for (const [key, times] of this.hits) if (times.every((time) => time <= cutoff)) this.hits.delete(key);
  }
}

/** The visitor's address: the first X-Forwarded-For entry set by the hosting proxy, else the socket. */
export function clientIp(headers: IncomingHttpHeaders, remoteAddress: string | undefined): string {
  const forwarded = headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || remoteAddress || "unknown";
}

/** Tracks state-changing requests so a dirty demo resets itself after a quiet period. */
export class IdleTracker {
  private lastChange: number;
  private dirty = false;

  constructor(private readonly idleMs: number, private readonly now: () => number = Date.now) { this.lastChange = now(); }

  touch(): void { this.lastChange = this.now(); this.dirty = true; }
  clear(): void { this.lastChange = this.now(); this.dirty = false; }
  /** True once something changed and nothing else changed for idleMs. */
  due(): boolean { return this.dirty && this.now() - this.lastChange >= this.idleMs; }
}

export type GatewayStatus = "starting" | "ready" | "resetting" | "failed";
export type DemoInfo = { backend: string; chainId: number; chainLabel: string; nodeVersion: string | null; startedAt: string };

export type GatewayOptions = {
  agentUrl: string;
  webDist: string;
  deploymentFile: string;
  readOwnerToken: () => string;
  info: () => DemoInfo;
  status: () => GatewayStatus;
  requestReset: (reason: string) => { accepted: boolean; message: string };
  chatLimiter: RateLimiter;
  chatLimitPerMinute: number;
  idle: IdleTracker;
  idleResetMinutes: number;
  llmHourlyCap: number | null;
};

const RATE_LIMITED_PATHS = new Set(["/chat", "/plans"]);
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".glb": "model/gltf-binary", ".txt": "text/plain; charset=utf-8",
};
// Request headers the browser may not set on the agent side: the gateway owns these.
const STRIPPED_REQUEST_HEADERS = ["host", "origin", "referer", "cookie", OWNER_SESSION_HEADER, "connection", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"];

export function createGatewayHandler(options: GatewayOptions) {
  const agent = new URL(options.agentUrl);
  const distRoot = resolve(options.webDist);

  return (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? "/", "http://gateway.local");
    const method = request.method ?? "GET";

    if (url.pathname === "/healthz") {
      const status = options.status();
      return sendJson(response, status === "ready" ? 200 : 503, { ok: status === "ready", status, ...options.info() });
    }
    if (url.pathname === "/api/demo/info" && method === "GET") {
      return sendJson(response, 200, { publicDemo: true, status: options.status(), idleResetMinutes: options.idleResetMinutes, chatLimitPerMinute: options.chatLimitPerMinute, llmHourlyCap: options.llmHourlyCap, ...options.info() });
    }
    if (url.pathname === "/api/demo/reset") {
      if (method !== "POST") return sendJson(response, 405, { message: "Use POST" });
      const result = options.requestReset("visitor");
      return sendJson(response, result.accepted ? 202 : 409, { status: options.status(), message: result.message });
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const status = options.status();
      if (status !== "ready") return sendJson(response, 503, { message: status === "resetting" ? "The demo is resetting to a fresh deployment; try again in a minute." : "The demo is starting; try again in a minute." });
      const path = url.pathname.slice("/api".length) || "/";
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        if (RATE_LIMITED_PATHS.has(path)) {
          const ip = clientIp(request.headers, request.socket.remoteAddress);
          if (!options.chatLimiter.take(ip)) {
            response.setHeader("retry-after", String(options.chatLimiter.retryAfterSeconds(ip)));
            return sendJson(response, 429, { message: `Too many chat requests from this address; the online demo allows ${options.chatLimitPerMinute} per minute.` });
          }
        }
        options.idle.touch();
      }
      return proxy(request, response, agent, `${path}${url.search}`, path.startsWith("/owner/") ? options.readOwnerToken : undefined);
    }
    if (method !== "GET" && method !== "HEAD") return sendJson(response, 405, { message: "Method not allowed" });
    // The console fetches the deployment manifest by network name; serve the live one (it changes on reset).
    if (/^\/(?:fisco|local|anvil)\.json$/.test(url.pathname)) {
      try { return sendBody(response, 200, "application/json", readFileSync(options.deploymentFile)); } catch { return sendJson(response, 503, { message: "Deployment not ready" }); }
    }
    return serveStatic(response, distRoot, url.pathname);
  };
}

function proxy(request: IncomingMessage, response: ServerResponse, agent: URL, path: string, ownerToken?: () => string): void {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined && !STRIPPED_REQUEST_HEADERS.includes(name)) headers[name] = value;
  }
  headers.host = agent.host;
  if (ownerToken) {
    let token: string;
    try { token = ownerToken().trim(); } catch { token = ""; }
    if (!token) return sendJson(response, 503, { message: "Owner session not ready" });
    headers[OWNER_SESSION_HEADER] = token;
  }
  const upstream = httpRequest({ hostname: agent.hostname, port: agent.port, method: request.method, path, headers }, (reply) => {
    const out: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(reply.headers)) {
      if (value !== undefined && !name.startsWith("access-control-") && name !== "connection") out[name] = value;
    }
    response.writeHead(reply.statusCode ?? 502, out);
    reply.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) sendJson(response, 502, { message: "Agent service unavailable" }); else response.destroy(); });
  request.pipe(upstream);
}

function serveStatic(response: ServerResponse, root: string, pathname: string): void {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return sendJson(response, 400, { message: "Bad path" }); }
  const candidate = resolve(join(root, normalize(decoded)));
  const inside = candidate === root || candidate.startsWith(root + sep);
  const file = inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
  if (!existsSync(file)) return sendJson(response, 503, { message: "Console not built" });
  const type = MIME[extname(file)] ?? "application/octet-stream";
  response.writeHead(200, { "content-type": type, "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600" });
  createReadStream(file).pipe(response);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  sendBody(response, status, "application/json", Buffer.from(JSON.stringify(body)));
}

function sendBody(response: ServerResponse, status: number, type: string, body: Buffer): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store", "content-length": String(body.length) });
  response.end(body);
}
