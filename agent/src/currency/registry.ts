import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits, hexToString, parseUnits, stringToHex, type Hex } from "viem";
import { z } from "zod";

/** Exact wording required wherever CNY-denominated demo balances appear. */
export const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const CurrencySchema = z.object({
  code: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 alphabetic code"),
  decimals: z.number().int().min(0).max(18),
  name: z.string().min(1),
  seed: z.string().regex(/^(?:0|[1-9][0-9]*)$/).optional(),
}).strict();
const FileSchema = z.object({ $comment: z.string().optional(), currencies: z.array(CurrencySchema).min(1) }).strict()
  .refine((file) => new Set(file.currencies.map((item) => item.code)).size === file.currencies.length, "duplicate currency code")
  .refine((file) => file.currencies.some((item) => item.code === "USD"), "USD is required: service fees are booked in USD");

export type Currency = z.infer<typeof CurrencySchema>;
let cache: { path: string; currencies: Currency[] } | undefined;

/** Currencies from config/currencies.json, or the file named by CURRENCIES_FILE. */
export function currencies(): Currency[] {
  const configured = process.env.CURRENCIES_FILE;
  const path = configured ? (isAbsolute(configured) ? configured : resolve(repoRoot, configured)) : resolve(repoRoot, "config/currencies.json");
  if (cache?.path !== path) cache = { path, currencies: FileSchema.parse(JSON.parse(readFileSync(path, "utf8"))).currencies };
  return cache.currencies;
}

export function currencyCodes(): string[] { return currencies().map((item) => item.code); }

export function currency(code: string): Currency {
  const found = currencies().find((item) => item.code === code.toUpperCase());
  if (!found) throw new Error(`unknown currency ${code}`);
  return found;
}

export function isCurrencyCode(value: string): boolean { return currencies().some((item) => item.code === value.toUpperCase()); }

/** On-chain `bytes3` encoding of an ISO 4217 code. */
export function toCurrencyCode(code: string): Hex { return stringToHex(code.toUpperCase(), { size: 3 }); }
export function fromCurrencyCode(value: Hex | string): string { return hexToString(value as Hex, { size: 3 }).replace(/\0+$/, ""); }

export function toMinorUnits(code: string, amount: string): bigint { return parseUnits(amount, currency(code).decimals); }
export function fromMinorUnits(code: string, amount: bigint): string { return formatUnits(amount, currency(code).decimals); }

export function disclaimerFor(code: string): string | undefined { return code.toUpperCase() === "CNY" ? CNY_DISCLAIMER : undefined; }

/** "USD or CNY", "USD, CNY, or SGD": for clarifying questions. */
export function currencyList(): string {
  const codes = currencyCodes();
  return codes.length <= 2 ? codes.join(" or ") : `${codes.slice(0, -1).join(", ")}, or ${codes.at(-1)}`;
}

/** Test hook: forget the cached file after CURRENCIES_FILE changes. */
export function resetCurrencyCache(): void { cache = undefined; }
