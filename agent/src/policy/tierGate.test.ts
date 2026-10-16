import { describe, expect, it } from "vitest";
import { tierGate } from "./tierGate.js";

describe("tier gate", () => {
  it("classifies read, autonomous, approval, and owner-only work", () => {
    expect(tierGate({ operation: "read" })).toMatchObject({ tier: "T0", allowed: true });
    expect(tierGate({ operation: "agent", policyRoute: "EXECUTE", riskRoute: "ALLOW" })).toMatchObject({ tier: "T1", allowed: true });
    expect(tierGate({ operation: "agent", policyRoute: "NEEDS_APPROVAL", riskRoute: "ALLOW" })).toMatchObject({ tier: "T2", allowed: true });
    expect(tierGate({ operation: "owner" })).toMatchObject({ tier: "T3", allowed: false });
  });

  it("raises risk-routed actions to T2 and blocks risk scores at 85", () => {
    expect(tierGate({ operation: "agent", policyRoute: "EXECUTE", riskRoute: "FORCE_APPROVAL" }).tier).toBe("T2");
    expect(tierGate({ operation: "agent", policyRoute: "EXECUTE", riskRoute: "BLOCK" })).toMatchObject({ tier: "T2", allowed: false });
  });

  it("forces every untrusted-source action to T2 without lowering a block", () => {
    expect(tierGate({ operation: "agent", policyRoute: "EXECUTE", riskRoute: "ALLOW", untrustedSource: true })).toEqual({ tier: "T2", allowed: true, reason: "Untrusted source requires owner approval" });
    expect(tierGate({ operation: "agent", policyRoute: "NEEDS_APPROVAL", riskRoute: "ALLOW", untrustedSource: true })).toMatchObject({ tier: "T2", allowed: true });
    expect(tierGate({ operation: "agent", policyRoute: "BLOCKED", riskRoute: "ALLOW", untrustedSource: true })).toMatchObject({ allowed: false });
    expect(tierGate({ operation: "agent", policyRoute: "EXECUTE", riskRoute: "BLOCK", untrustedSource: true })).toMatchObject({ tier: "T2", allowed: false });
    expect(tierGate({ operation: "agent", policyRoute: "EXECUTE", riskRoute: "ALLOW", untrustedSource: false })).toMatchObject({ tier: "T1", allowed: true });
  });
});
