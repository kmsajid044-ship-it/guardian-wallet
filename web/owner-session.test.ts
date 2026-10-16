import { describe, expect, it } from "vitest";
import { ownerSessionResponse } from "./owner-session.ts";

const token = "synthetic-owner-session-token-for-tests-only";
const read = () => `${token}\n`;
const sameOrigin = { host: "127.0.0.1:5173", "sec-fetch-site": "same-origin" };

describe("ownerSessionResponse", () => {
  it("hands the token to a same-origin fetch on a loopback host", () => {
    expect(ownerSessionResponse(sameOrigin, "GET", read)).toEqual({ status: 200, body: { token } });
    expect(ownerSessionResponse({ ...sameOrigin, host: "localhost:5173" }, "GET", read).status).toBe(200);
  });

  it("refuses other sites, other localhost ports, and requests without fetch metadata", () => {
    for (const site of ["cross-site", "same-site", "none", undefined]) {
      expect(ownerSessionResponse({ ...sameOrigin, "sec-fetch-site": site }, "GET", read)).toEqual({ status: 403, body: { error: "OWNER_SESSION_SAME_ORIGIN_ONLY" } });
    }
  });

  it("refuses DNS-rebound host names and non-GET methods", () => {
    expect(ownerSessionResponse({ ...sameOrigin, host: "attacker.example:5173" }, "GET", read).status).toBe(403);
    expect(ownerSessionResponse({ ...sameOrigin, host: undefined }, "GET", read).status).toBe(403);
    expect(ownerSessionResponse(sameOrigin, "POST", read).status).toBe(405);
  });

  it("reports an unavailable session when the agent has not started", () => {
    expect(ownerSessionResponse(sameOrigin, "GET", () => { throw new Error("ENOENT"); })).toEqual({ status: 503, body: { error: "OWNER_SESSION_UNAVAILABLE" } });
    expect(ownerSessionResponse(sameOrigin, "GET", () => " ").status).toBe(503);
  });
});
