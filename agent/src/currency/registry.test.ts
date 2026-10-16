import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseWithMock } from "../llm/mock.js";
import { CNY_DISCLAIMER, currencies, currencyList, disclaimerFor, fromCurrencyCode, isCurrencyCode, resetCurrencyCache, toCurrencyCode, toMinorUnits } from "./registry.js";

const directory = mkdtempSync(join(tmpdir(), "guardian-currencies-"));
const withFile = (content: unknown) => { const path = join(directory, `c${Math.random()}.json`); writeFileSync(path, JSON.stringify(content)); process.env.CURRENCIES_FILE = path; resetCurrencyCache(); };
afterEach(() => { delete process.env.CURRENCIES_FILE; resetCurrencyCache(); });
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));

describe("currency registry", () => {
  it("defaults to USD and CNY from config/currencies.json", () => {
    expect(currencies().map((unit) => unit.code)).toEqual(["USD", "CNY"]);
    expect(currencyList()).toBe("USD or CNY");
    expect(isCurrencyCode("cny")).toBe(true);
    expect(isCurrencyCode("SGD")).toBe(false);
  });

  it("encodes ISO codes as bytes3 and back", () => {
    expect(toCurrencyCode("CNY")).toBe("0x434e59");
    expect(fromCurrencyCode("0x555344")).toBe("USD");
    expect(toMinorUnits("CNY", "12.5")).toBe(12_500_000n);
  });

  it("attaches the exact disclaimer to CNY only", () => {
    expect(disclaimerFor("CNY")).toBe(CNY_DISCLAIMER);
    expect(CNY_DISCLAIMER).toBe("Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.");
    expect(disclaimerFor("USD")).toBeUndefined();
  });

  it("rejects malformed, duplicate, or USD-less configuration", () => {
    withFile({ currencies: [{ code: "usd", decimals: 6, name: "x" }] }); expect(() => currencies()).toThrow();
    withFile({ currencies: [{ code: "USD", decimals: 6, name: "x" }, { code: "USD", decimals: 6, name: "y" }] }); expect(() => currencies()).toThrow(/duplicate/);
    withFile({ currencies: [{ code: "CNY", decimals: 6, name: "x" }] }); expect(() => currencies()).toThrow(/USD is required/);
  });

  it("parses a third configured currency without code changes", () => {
    withFile({ currencies: [{ code: "USD", decimals: 6, name: "US dollar (demo units)" }, { code: "CNY", decimals: 6, name: "Chinese yuan (demo units)" }, { code: "SGD", decimals: 6, name: "Singapore dollar (demo units)" }] });
    expect(parseWithMock({ message: "Pay ana 12 SGD", source: "trusted", sourceRefs: [] })).toMatchObject({ kind: "pay", currency: "SGD", amount: "12" });
    expect(parseWithMock({ message: "Pay ana 12", source: "trusted", sourceRefs: [] }).reason).toBe("Which currency, USD, CNY, or SGD, should I use to pay contact ana?");
  });
});
