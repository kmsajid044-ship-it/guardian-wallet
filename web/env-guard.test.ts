import { describe, expect, it } from "vitest";
import { assertNoDemoKeyInBuild } from "./env-guard.ts";

const KEY = "0x" + "11".repeat(32);

describe("assertNoDemoKeyInBuild", () => {
  it("fails a build when the demo key is set", () => {
    expect(() => assertNoDemoKeyInBuild("build", { VITE_DEMO_OWNER_KEY: KEY })).toThrow(/Refusing to build/);
  });

  it("allows a build when the demo key is unset or empty", () => {
    expect(() => assertNoDemoKeyInBuild("build", {})).not.toThrow();
    expect(() => assertNoDemoKeyInBuild("build", { VITE_DEMO_OWNER_KEY: "  " })).not.toThrow();
  });

  it("allows the dev server with the demo key set", () => {
    expect(() => assertNoDemoKeyInBuild("serve", { VITE_DEMO_OWNER_KEY: KEY })).not.toThrow();
  });
});
