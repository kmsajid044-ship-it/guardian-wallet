import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

// Local demo only. The agent service holds the owner key and signs owner actions for the web
// console, so every /owner/* route requires a per-run session token. The token is never logged:
// Fastify's request log carries method and URL only, and refusals never echo the header.
// Production design: the owner signs in the injected browser wallet and these routes do not exist.

export const OWNER_SESSION_HEADER = "x-owner-session";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/;

export function createOwnerSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Writes the token for the local web console (see web/ownerSession.ts), readable by this OS user only. */
export function writeOwnerSessionFile(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, token, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function ownerSessionMatches(expected: string, supplied: unknown): boolean {
  if (typeof supplied !== "string" || supplied.length === 0) return false;
  // Hashing first gives equal-length inputs, so the comparison time does not depend on the secret.
  return timingSafeEqual(digest(expected), digest(supplied));
}

/** preParsing hook: runs after CORS headers are set and before any body parser, so form posts are refused unread. */
export function createOwnerSessionGuard(token: string = createOwnerSessionToken()) {
  if (token.length < 32) throw new Error("owner session token must be at least 32 characters");
  return async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (request.method === "OPTIONS" || !request.url.startsWith("/owner/")) return payload;
    // Refuse rebound host names and foreign browser origins even when the token is present.
    if (!isLoopbackHost(request.headers.host) || !isAllowedOrigin(request.headers.origin)) {
      return reply.code(403).send({ error: "OWNER_ORIGIN_REFUSED" });
    }
    if (!ownerSessionMatches(token, request.headers[OWNER_SESSION_HEADER])) {
      return reply.code(401).send({ error: "OWNER_SESSION_REQUIRED" });
    }
    return payload;
  };
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(host);
  return match !== null && LOOPBACK_HOSTS.has(match[1]!.toLowerCase());
}

function isAllowedOrigin(origin: string | undefined): boolean {
  return origin === undefined || LOOPBACK_ORIGIN.test(origin);
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
