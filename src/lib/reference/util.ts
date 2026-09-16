import { toCents } from "../money";

export function compactId(value: string): string {
  return value.replace(/\.0+$/, "").trim();
}

/** Basename of an object-storage key, for analysis-plan locators. */
export function sourceFileName(keyOrName: string | undefined): string | undefined {
  if (!keyOrName) return undefined;
  const base = keyOrName.split("/").pop()?.trim();
  return base || undefined;
}

export function formatSourceLocator(
  file?: string,
  row?: number,
  page?: number,
): string {
  const parts: string[] = [];
  if (file) parts.push(file);
  if (row != null) parts.push(`row ${row}`);
  if (page != null) parts.push(`page ${page}`);
  return parts.join(" ");
}

export function parseExtractDate(value: string | undefined): string {
  const v = (value ?? "").trim();
  const iso = v.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return "";
}

export function parseExtractAmount(value: string | undefined): number {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? toCents(n) : 0;
}

export function isGbCountry(value: string | undefined): boolean {
  const v = (value ?? "").trim().toUpperCase();
  return v === "GB" || v === "UK" || v === "GBR";
}

/** First non-empty field from a lower-cased extract row. */
export function firstField(
  row: Record<string, string>,
  names: string[],
): string {
  for (const name of names) {
    const value = row[name];
    if (value) return value;
  }
  return "";
}

/**
 * UK / ORG 112 row when geography is present; keep the row when the extract
 * carries no country / OU so PO files without those columns still load.
 */
export function isUkOrgRow(row: Record<string, string>): boolean {
  if (
    isGbCountry(
      firstField(row, [
        "taxation_country",
        "country",
        "bill_to_country",
        "ship_to_country",
        "bill_country",
      ]),
    )
  ) {
    return true;
  }
  if (row.org_id === "112") return true;
  const geoText = [
    "operating_unit",
    "operating_unit_name",
    "business_unit",
    "org_name",
    "bill_to_location",
    "ship_to_location",
    "bill_to_bu",
    "procurement_bu",
    "requisitioning_bu",
  ]
    .map((name) => row[name] ?? "")
    .join(" ");
  if (/\b(uk|gb|gbr|united kingdom)\b/i.test(geoText)) return true;
  const hasGeo = Boolean(
    row.taxation_country ||
      row.country ||
      row.bill_to_country ||
      row.ship_to_country ||
      row.bill_country ||
      row.org_id ||
      row.operating_unit ||
      row.operating_unit_name ||
      row.business_unit ||
      row.org_name ||
      row.bill_to_location ||
      row.ship_to_location ||
      row.bill_to_bu ||
      row.procurement_bu ||
      row.requisitioning_bu,
  );
  return !hasGeo;
}

export function normalizePartyName(value: string | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(
      /\b(LTD|LIMITED|PLC|LLC|NHS|TRUST|UHB|ULHB|LHB|FT|FOUNDATION|HOSPITALS?|HOSPITAL|UNIVERSITY|THE|AND|&)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokens that are too common in UK bank narratives / NHS legal names to
 * isolate a counterparty on their own. Used only for overlap scoring after
 * {@link normalizePartyName}; the full normalized string may still substring-match.
 */
const GENERIC_NAME_TOKENS = new Set([
  "HEALTH",
  "CARE",
  "GROUP",
  "BOARD",
  "BANK",
  "GBS",
  "NATWEST",
  "PAYMENT",
  "TRANSFER",
  "RECEIPT",
  "INVOICE",
  "REMI",
  "SREF",
  "DBACCT",
  "NONREF",
  "ADVICE",
  "CONFIRMS",
  "BACS",
  "CHAPS",
  "FASTER",
  "PAYROLL",
  "WAGES",
  "HMRC",
  "VAT",
  "CASH",
  "CHECK",
  "CHEQUE",
  "DIRECT",
  "DEBIT",
  "CREDIT",
  "CENTRE",
  "CENTER",
  "AUTHORITY",
  "AUTH",
  "UNI",
  "FOUND",
  "HEALTHCARE",
  "SERVICES",
  "SERVICE",
  "T",
  "A",
]);

function distinctiveNameTokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length >= 4 && !GENERIC_NAME_TOKENS.has(t));
}

function hasWholeToken(haystack: string, token: string): boolean {
  return new RegExp(`(?:^|\\s)${token}(?:\\s|$)`).test(haystack);
}

const GENERIC_REFS = new Set([
  "ABI",
  "BACS",
  "CHAPS",
  "FASTER",
  "CASH",
  "CHECK",
  "CHEQUE",
  "DD",
  "DIRECTDEBIT",
]);

export function isDistinctiveReference(value: string | undefined): boolean {
  const v = (value ?? "").trim();
  if (v.length < 5) return false;
  if (GENERIC_REFS.has(v.toUpperCase())) return false;
  return true;
}

const INVOICE_TOKEN = /\b(?:INV[-/ ]?)?[A-Z]{0,6}\d{5,12}\b/gi;
const SO_PO_TOKEN = /\b(SO|PO)-\d+\b/gi;

export function extractMatchTokens(parts: Array<string | undefined>): string[] {
  const hay = parts.filter(Boolean).join(" ");
  const found = [
    ...(hay.match(SO_PO_TOKEN) ?? []),
    ...(hay.match(INVOICE_TOKEN) ?? []),
  ];
  return [...new Set(found.map((t) => t.toUpperCase().replace(/\s+/g, "")))];
}

/**
 * True when a remittance counterparty name overlaps a bank free-text blob
 * (narrative / description / customer ref / counterparty / bank ref).
 *
 * HSBC PDF lines store a payment id in `counterparty` and truncate the
 * legal name in Narrative (e.g. "ISLE OF WIGHT NHS", "WORCESTERSHIRE ACU"),
 * so substring-of-full-name is not enough. Distinctive-token overlap covers
 * truncation; generic tokens (HEALTH, GBS, BACS, …) cannot unique-match.
 */
export function namesLooselyMatch(a: string | undefined, b: string | undefined): boolean {
  const na = normalizePartyName(a);
  const nb = normalizePartyName(b);
  if (!na || !nb) return false;

  if (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }

  // Short remainder after legal-form stripping, e.g. "LNWH NHS Trust" → "LNWH".
  if (na.length >= 4 && na.length < 6 && !na.includes(" ") && hasWholeToken(nb, na)) {
    return true;
  }
  if (nb.length >= 4 && nb.length < 6 && !nb.includes(" ") && hasWholeToken(na, nb)) {
    return true;
  }

  return distinctiveTokenOverlap(na, nb);
}

function distinctiveTokenOverlap(na: string, nb: string): boolean {
  const aToks = distinctiveNameTokens(na);
  const bToks = distinctiveNameTokens(nb);
  if (aToks.length === 0 || bToks.length === 0) return false;

  const [nameToks, hayToks] =
    aToks.length <= bToks.length ? [aToks, bToks] : [bToks, aToks];
  const hay = new Set(hayToks);
  const hits = nameToks.filter(
    (t) =>
      hay.has(t) ||
      hayToks.some(
        (h) =>
          (h.startsWith(t) || t.startsWith(h)) && Math.min(t.length, h.length) >= 6,
      ),
  );
  if (hits.length === 0) return false;
  const longestHit = Math.max(...hits.map((t) => t.length));
  if (longestHit >= 8) return true;
  if (nameToks.length === 1) return nameToks[0].length >= 8 && hits.length === 1;
  if (nameToks.length === 2) return hits.length === 2;
  return hits.length >= 2;
}

/** Join bank free-text fields so a payment-id `counterparty` cannot hide Narrative. */
export function bankPartyText(parts: Array<string | undefined>): string {
  return parts.filter((v): v is string => Boolean(v && v.trim())).join(" ");
}

export function daysBetween(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(da - db) / 86_400_000;
}
