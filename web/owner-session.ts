import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// Local demo only. The agent writes a fresh owner session token to a git-ignored file
// (mode 0600) at each start. The Vite dev server hands it to the owner console page and to
// nothing else: the request must be a same-origin browser fetch (`Sec-Fetch-Site` is set by
// the browser and cannot be forged by page script) addressed to a loopback host name (which
// refuses DNS-rebinding pages). Another site, including another localhost port, sees
// "same-site" or "cross-site" and is refused. Production builds do not include this route;
// the owner signs in the injected browser wallet there.

export const OWNER_SESSION_PATH = "/__owner-session";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type OwnerSessionResponse = { status: number; body: { token: string } | { error: string } };

export function ownerSessionResponse(
  headers: Record<string, string | string[] | undefined>,
  method: string | undefined,
  readToken: () => string,
): OwnerSessionResponse {
  if (method !== "GET") return { status: 405, body: { error: "METHOD_NOT_ALLOWED" } };
  if (headers["sec-fetch-site"] !== "same-origin" || !isLoopbackHost(headers.host)) {
    return { status: 403, body: { error: "OWNER_SESSION_SAME_ORIGIN_ONLY" } };
  }
  let token: string;
  try { token = readToken().trim(); } catch { token = ""; }
  if (!token) return { status: 503, body: { error: "OWNER_SESSION_UNAVAILABLE" } };
  return { status: 200, body: { token } };
}

export function ownerSessionPlugin(tokenFile: string): Plugin {
  return {
    name: "guardian-owner-session",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(OWNER_SESSION_PATH, (request: IncomingMessage, response: ServerResponse) => {
        const result = ownerSessionResponse(request.headers, request.method, () => readFileSync(tokenFile, "utf8"));
        response.statusCode = result.status;
        response.setHeader("content-type", "application/json");
        response.setHeader("cache-control", "no-store");
        response.end(JSON.stringify(result.body));
      });
    },
  };
}

function isLoopbackHost(host: string | string[] | undefined): boolean {
  if (typeof host !== "string") return false;
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(host);
  return match !== null && LOOPBACK_HOSTS.has(match[1]!.toLowerCase());
}
