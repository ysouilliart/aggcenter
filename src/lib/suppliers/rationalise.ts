/**
 * Canonical mappings for payment terms, pay groups, payment methods and
 * supplier type — used both to flag sparse/variant values and to suggest a
 * replacement on the record.
 */

export interface RationaliseHit {
  field: "paymentTerms" | "payGroup" | "paymentMethod" | "type";
  value: string;
  suggestion?: string;
  reason: string;
}

const TERM_CANONICAL: Record<string, string> = {
  "30 days": "30 Days",
  "30jours": "30 Days",
  "30 jours": "30 Days",
  "30 jours fm": "30 Days EOM",
  "30 tn": "30 Days",
  "net 30": "30 Days",
  "60 days": "60 Days",
  "45 days": "45 Days",
  "90 days": "90 Days",
  "25 days": "25 Days",
  sofort: "Immediate",
  prompt: "Immediate",
  immediate: "Immediate",
  "due on receipt": "Immediate",
};

const METHOD_CANONICAL: Record<string, string> = {
  check: "CHECK",
  cheque: "CHECK",
  eft: "EFT",
  wire: "WIRE",
  bacs: "BACS",
  sepa: "SEPA",
};

const TYPE_CANONICAL: Record<string, string> = {
  corporation: "CORPORATION",
  "foreign corporation": "FOREIGN CORPORATION",
  individual: "INDIVIDUAL",
  partnership: "PARTNERSHIP",
  government: "GOVERNMENT",
};

function key(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function compact(value: string): string {
  return value.trim().toLowerCase().replace(/[\s._-]+/g, "");
}

/** Allowed payment terms when saving a streamlined record. */
export const STANDARD_PAYMENT_TERMS = ["7 Days", "14 Days", "30 Days", "45 Days"] as const;

export type StandardPaymentTerms = (typeof STANDARD_PAYMENT_TERMS)[number];

export function isStandardPaymentTerms(value: string): value is StandardPaymentTerms {
  return (STANDARD_PAYMENT_TERMS as readonly string[]).includes(value.trim());
}

export function canonicalPaymentTerms(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return TERM_CANONICAL[key(trimmed)] ?? TERM_CANONICAL[compact(trimmed)];
}

export function canonicalPaymentMethod(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return METHOD_CANONICAL[key(trimmed)] ?? METHOD_CANONICAL[compact(trimmed)];
}

export function canonicalType(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return TYPE_CANONICAL[key(trimmed)];
}

export function canonicalPayGroup(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Title-case currency + rest, preserving known tokens.
  return trimmed
    .split(/\s+/)
    .map((part) => {
      const upper = part.toUpperCase();
      if (["EUR", "GBP", "USD", "AUD", "GB", "EFT", "BACS"].includes(upper)) return upper;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

const RARE_THRESHOLD = 3;
const RARE_POPULATION = 8;

function totalCount(map?: Map<string, number>): number {
  if (!map) return 0;
  let n = 0;
  for (const c of map.values()) n += c;
  return n;
}

function isRare(value: string, map?: Map<string, number>): boolean {
  if (!map) return false;
  if (totalCount(map) < RARE_POPULATION) return false;
  return (map.get(value) ?? 0) < RARE_THRESHOLD;
}

export function assessRationalisation(input: {
  paymentTerms?: string;
  payGroup?: string;
  paymentMethod?: string;
  type?: string;
  termCounts?: Map<string, number>;
  groupCounts?: Map<string, number>;
}): RationaliseHit[] {
  const hits: RationaliseHit[] = [];

  const terms = (input.paymentTerms ?? "").trim();
  if (terms) {
    const canon = canonicalPaymentTerms(terms);
    if (canon && canon !== terms) {
      hits.push({
        field: "paymentTerms",
        value: terms,
        suggestion: canon,
        reason: `Payment terms "${terms}" can be standardised to "${canon}".`,
      });
    } else if (isRare(terms, input.termCounts)) {
      hits.push({
        field: "paymentTerms",
        value: terms,
        reason: `Payment terms "${terms}" is used on fewer than ${RARE_THRESHOLD} sites — review for rationalisation.`,
      });
    }
  }

  const group = (input.payGroup ?? "").trim();
  if (group) {
    const canon = canonicalPayGroup(group);
    if (canon && canon !== group) {
      hits.push({
        field: "payGroup",
        value: group,
        suggestion: canon,
        reason: `Pay group "${group}" can be standardised to "${canon}".`,
      });
    } else if (isRare(group, input.groupCounts)) {
      hits.push({
        field: "payGroup",
        value: group,
        reason: `Pay group "${group}" is rare — review whether it should merge into a standard group.`,
      });
    }
  }

  const method = (input.paymentMethod ?? "").trim();
  if (method) {
    const canon = canonicalPaymentMethod(method);
    if (canon && canon !== method) {
      hits.push({
        field: "paymentMethod",
        value: method,
        suggestion: canon,
        reason: `Payment method "${method}" can be standardised to "${canon}".`,
      });
    }
  }

  const type = (input.type ?? "").trim();
  if (type) {
    const canon = canonicalType(type);
    if (canon && canon !== type) {
      hits.push({
        field: "type",
        value: type,
        suggestion: canon,
        reason: `Supplier type "${type}" can be standardised to "${canon}".`,
      });
    } else if (!canon) {
      hits.push({
        field: "type",
        value: type,
        reason: `Supplier type "${type}" is not in the canonical set.`,
      });
    }
  }

  return hits;
}
