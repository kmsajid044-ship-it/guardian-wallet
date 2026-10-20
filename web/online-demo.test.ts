import { describe, expect, it } from "vitest";
import { chainSentence, CNY_DISCLAIMER, onlineBannerText, onlineChainLabel } from "./src/onlineDemo";

describe("online demo labels", () => {
  it("names FISCO BCOS only when the agent reports the fisco backend", () => {
    expect(onlineChainLabel("fisco")).toBe("FISCO BCOS · online demo");
    expect(onlineBannerText("fisco", undefined)).toBe("Online demo: a 4-node FISCO BCOS network running inside this container, operated by the team. Fresh chain on every restart. Recorded execution evidence is in the GitHub repo.");
    expect(onlineBannerText("fisco", "an Azure VM")).toBe("Online demo: a 4-node FISCO BCOS network running in one container on an Azure VM operated by the team. Fresh chain on every restart. Recorded execution evidence is in the GitHub repo.");
  });

  it("never labels the Anvil fallback as FISCO BCOS", () => {
    expect(onlineChainLabel("evm-local")).toBe("private EVM development chain (Anvil)");
    expect(onlineBannerText("evm-local")).toContain("private EVM development chain (Anvil)");
    expect(onlineBannerText("evm-local")).not.toMatch(/FISCO BCOS network running/);
    expect(chainSentence("fisco")).toContain("FISCO BCOS");
  });

  it("carries the exact CNY disclaimer", () => {
    expect(CNY_DISCLAIMER).toBe("Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.");
  });
});
