import { toCents } from "../money";

export function compactId(value: string): string {
  return value.replace(/\.0+$/, "").trim();
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
  const ou = firstField(row, [
    "operating_unit",
    "operating_unit_name",
    "business_unit",
    "org_name",
  ]);
  if (/uk/i.test(ou)) return true;
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
      row.org_name,
  );
  return !hasGeo;
}

export function normalizePartyName(value: string | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(
      /\b(LTD|LIMITED|PLC|NHS|TRUST|UHB|FT|HOSPITALS?|HOSPITAL|UNIVERSITY|THE|AND|&)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
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

export function namesLooselyMatch(a: string | undefined, b: string | undefined): boolean {
  const na = normalizePartyName(a);
  const nb = normalizePartyName(b);
  if (na.length < 6 || nb.length < 6) return false;
  return na.includes(nb) || nb.includes(na);
}

export function daysBetween(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(da - db) / 86_400_000;
}
