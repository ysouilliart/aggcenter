/**
 * Local comparison of a supplier record against VIES registered details.
 * Kept free of fetch/config so client components can reuse it.
 */

import type { VatDetailMatch } from "./types";

const LEGAL_SUFFIXES = new Set([
  "NV",
  "BV",
  "BVBA",
  "SA",
  "SAS",
  "SARL",
  "SRL",
  "SPA",
  "SL",
  "LDA",
  "LTD",
  "LLC",
  "PLC",
  "GMBH",
  "AG",
  "KG",
  "OHG",
  "SRO",
  "SPOL",
  "OY",
  "AB",
  "AS",
  "APS",
  "KFT",
  "SIA",
  "UAB",
  "OOO",
  "INC",
  "CORP",
  "CO",
  "COMPANY",
  "LIMITED",
  "PUBLIC",
]);

function blank(value: string | undefined): string {
  return (value ?? "").trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !LEGAL_SUFFIXES.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / Math.min(a.size, b.size);
}

export function compareNames(local: string, registered: string): VatDetailMatch {
  const a = blank(local);
  const b = blank(registered);
  if (!a || !b) return "unknown";
  if (a.toUpperCase() === b.toUpperCase()) return "match";
  const score = overlap(tokens(a), tokens(b));
  if (score >= 0.5) return "match";
  if (score === 0) return "mismatch";
  return "unknown";
}

export function compareAddresses(input: {
  street?: string;
  city?: string;
  postalCode?: string;
  registeredAddress?: string;
}): VatDetailMatch {
  const registered = blank(input.registeredAddress);
  if (!registered) return "unknown";
  const localParts = [input.street, input.postalCode, input.city].map(blank).filter(Boolean);
  if (localParts.length === 0) return "unknown";
  const localBlob = localParts.join(" ");
  const localTokens = tokens(localBlob);
  const registeredTokens = tokens(registered);
  const postal = blank(input.postalCode).replace(/\s+/g, "").toUpperCase();
  const city = blank(input.city).toUpperCase();
  const regNorm = registered.replace(/\s+/g, "").toUpperCase();

  if (postal && !regNorm.includes(postal)) {
    return "mismatch";
  }
  if (city && !registered.toUpperCase().includes(city) && overlap(tokens(city), registeredTokens) === 0) {
    return "mismatch";
  }
  const score = overlap(localTokens, registeredTokens);
  if (score >= 0.45) return "match";
  if (postal && regNorm.includes(postal)) return "match";
  return "unknown";
}

export function compareTraderDetails(
  record: { name: string; street: string; city: string; postalCode: string },
  registered: { name?: string; address?: string },
): { nameMatch: VatDetailMatch; addressMatch: VatDetailMatch } {
  return {
    nameMatch: compareNames(record.name, registered.name ?? ""),
    addressMatch: compareAddresses({
      street: record.street,
      city: record.city,
      postalCode: record.postalCode,
      registeredAddress: registered.address,
    }),
  };
}

export function parseViesAddress(address: string): {
  addressLine1?: string;
  postalCode?: string;
  city?: string;
} {
  const cleaned = address.replace(/\s+/g, " ").trim();
  if (!cleaned) return {};
  const postal =
    cleaned.match(/\b(\d{4}\s*[A-Z]{2})\b/i)?.[1] ??
    cleaned.match(/\b(\d{5})\b/)?.[1] ??
    cleaned.match(/\b(\d{2}\s*\d{3})\b/)?.[1];
  if (!postal) {
    return { addressLine1: cleaned };
  }
  const idx = cleaned.toUpperCase().indexOf(postal.toUpperCase());
  const before = cleaned.slice(0, idx).replace(/[/.,]+$/g, "").trim();
  const after = cleaned.slice(idx + postal.length).replace(/^[/,\s]+/, "").trim();
  return {
    addressLine1: before || undefined,
    postalCode: postal.replace(/\s+/g, " ").trim(),
    city: after || undefined,
  };
}
