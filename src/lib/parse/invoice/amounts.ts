import { toCents } from "../../money";

const CURRENCY_RE = /\b(AUD|USD|EUR|GBP|NZD|CAD|SGD|JPY|CHF|HKD)\b/i;
const SYMBOL: Record<string, string> = {
  $: "AUD",
  "£": "GBP",
  "€": "EUR",
};

/** Detect a currency code from invoice text. `$` defaults to AUD for AU suppliers. */
export function detectCurrency(text: string, fallback?: string): string | undefined {
  const labelled = text.match(
    /(?:total\s*(?:\(|amount)?[^%\n]{0,24}|currency[:\s]+)\b(AUD|USD|EUR|GBP|NZD)\b/i,
  );
  if (labelled) return labelled[1].toUpperCase();
  if (/\bUSD\b|\(\s*USD\s*\)|TOTAL\s*\(USD\)/i.test(text)) return "USD";
  if (/\bAUD\b|\(\s*AUD\s*\)|Total Amount\s*\(AUD\)/i.test(text)) return "AUD";
  if (/\bEUR\b|\(\s*EUR\s*\)/i.test(text)) return "EUR";
  if (/\bGBP\b|\(\s*GBP\s*\)/i.test(text)) return "GBP";
  const code = text.match(CURRENCY_RE);
  if (code) return code[1].toUpperCase();
  if (text.includes("£")) return "GBP";
  if (text.includes("€")) return "EUR";
  if (text.includes("$")) return fallback ?? "AUD";
  return fallback;
}

/**
 * Parse a money token (`$302.06`, `1,234.56`, `(17.95) CR`, `189.00`) to cents.
 * Returns null when the token is not a plausible amount.
 */
export function parseMoney(value: string | undefined | null): number | null {
  if (!value) return null;
  let raw = value.replace(/[\u00a0]/g, " ").trim();
  if (!raw) return null;
  const credit = /\bCR\b/i.test(raw) || /^\(.*\)$/.test(raw.trim());
  raw = raw.replace(/[A-Za-z]/g, " ");
  raw = raw.replace(/[$£€]/g, "").replace(/,/g, "").replace(/\s+/g, "");
  raw = raw.replace(/[()]/g, "");
  if (!raw || raw === "-" || raw === ".") return null;
  if (!/^-?\d+(?:\.\d{1,4})?$/.test(raw)) return null;
  const major = Number(raw);
  if (!Number.isFinite(major)) return null;
  const cents = toCents(major);
  return credit ? -Math.abs(cents) : cents;
}

/** Last money-looking token on a line. */
export function lastMoney(line: string): number | null {
  const tokens = line.match(
    /\(?(?:[$£€]\s*)?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,4})?\)?(?:\s*CR)?/gi,
  );
  if (!tokens || tokens.length === 0) return null;
  return parseMoney(tokens[tokens.length - 1]);
}

export function firstMoney(line: string): number | null {
  const tokens = line.match(
    /\(?(?:[$£€]\s*)?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,4})?\)?(?:\s*CR)?/gi,
  );
  if (!tokens || tokens.length === 0) return null;
  return parseMoney(tokens[0]);
}

export function currencyFromSymbol(text: string): string | undefined {
  for (const [sym, code] of Object.entries(SYMBOL)) {
    if (text.includes(sym)) return code;
  }
  return undefined;
}
