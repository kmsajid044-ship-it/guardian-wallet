/*
 * Display formatting for demo money. Amounts stay decimal strings from the backend; they are rounded
 * to two decimals only for display, with thousands separators and the currency symbol.
 */

const SYMBOLS: Record<string, string> = { USD: "$", CNY: "¥" };

/** "4189.9", "USD" → "$4,189.90"; an unknown code is written before the number. */
export function money(amount: string | number | undefined, currency = "USD"): string {
  const number = typeof amount === "number" ? amount : Number(String(amount ?? "").replaceAll(",", ""));
  if (!Number.isFinite(number)) return "—";
  const text = number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = SYMBOLS[currency.toUpperCase()];
  return symbol ? `${symbol}${text}` : `${currency.toUpperCase()} ${text}`;
}

/** Contact IDs are lower case on the backend; people read them capitalised. */
export function personName(id: string | undefined): string {
  if (!id) return "someone";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * "Pay Ana $50" → "Pay Ana 50 USD", "Save ¥200" → "Save 200 CNY". The agent parser reads currency
 * codes; this only rewrites a symbol directly in front of a number, nothing else in the request.
 */
export function withCurrencyCodes(text: string): string {
  return text
    .replace(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)/g, (_match, value: string) => `${value.replaceAll(",", "")} USD`)
    .replace(/[¥￥]\s?([0-9][0-9,]*(?:\.[0-9]+)?)/g, (_match, value: string) => `${value.replaceAll(",", "")} CNY`);
}
