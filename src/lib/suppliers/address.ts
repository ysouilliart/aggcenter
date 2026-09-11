/**
 * Lightweight address quality checks: missing components, country-prefixed
 * postcodes, and postcodes stuffed into the city field.
 */

export type AddressIssueKind =
  | "missing_line"
  | "missing_city"
  | "missing_postal"
  | "postal_has_country_prefix"
  | "city_contains_postal"
  | "postal_format";

export interface AddressAssessment {
  kind: AddressIssueKind;
  field: "addressLine1" | "city" | "postalCode";
  message: string;
  suggestion?: string;
}

export interface AddressInput {
  country?: string;
  addressLine1?: string;
  city?: string;
  postalCode?: string;
}

const COUNTRY_PREFIX = /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|GB|GR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|UK)\s+/i;

const POSTAL: Record<string, RegExp> = {
  NL: /^\d{4}\s?[A-Z]{2}$/i,
  GB: /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  IT: /^\d{5}$/,
  ES: /^\d{5}$/,
  BE: /^\d{4}$/,
  PT: /^\d{4}(-\d{3})?$/,
  SE: /^\d{3}\s?\d{2}$/,
  DK: /^\d{4}$/,
  AT: /^\d{4}$/,
  PL: /^\d{2}-\d{3}$/,
  LU: /^\d{4}$/,
  IE: /^[A-Z]\d{2}\s?[A-Z0-9]{4}$/i,
};

const CITY_POSTAL = /\b(\d{4,6}|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

export function assessAddress(input: AddressInput): AddressAssessment[] {
  const issues: AddressAssessment[] = [];
  const country = (input.country ?? "").trim().toUpperCase();
  const line1 = (input.addressLine1 ?? "").trim();
  const city = (input.city ?? "").trim();
  const postal = (input.postalCode ?? "").trim();

  if (!line1) {
    issues.push({
      kind: "missing_line",
      field: "addressLine1",
      message: "Address line 1 is missing.",
    });
  }
  if (!city) {
    issues.push({
      kind: "missing_city",
      field: "city",
      message: "City is missing.",
    });
  }
  if (!postal) {
    issues.push({
      kind: "missing_postal",
      field: "postalCode",
      message: "Postal code is missing.",
    });
  }

  if (postal && COUNTRY_PREFIX.test(postal)) {
    const suggestion = postal.replace(COUNTRY_PREFIX, "").trim();
    issues.push({
      kind: "postal_has_country_prefix",
      field: "postalCode",
      message: "Postal code includes a country prefix.",
      suggestion: suggestion || undefined,
    });
  }

  if (city && !postal && CITY_POSTAL.test(city)) {
    const match = city.match(CITY_POSTAL);
    const extracted = match?.[1]?.trim();
    const cityOnly = city.replace(CITY_POSTAL, "").replace(/[,-]+$/g, "").trim();
    issues.push({
      kind: "city_contains_postal",
      field: "city",
      message: "City field appears to contain a postal code.",
      suggestion: cityOnly || extracted,
    });
    if (extracted) {
      issues.push({
        kind: "missing_postal",
        field: "postalCode",
        message: "Postal code looks embedded in the city field.",
        suggestion: extracted,
      });
    }
  }

  const postalBody = postal.replace(COUNTRY_PREFIX, "").trim();
  const pattern = country ? POSTAL[country] : undefined;
  if (postalBody && pattern && !pattern.test(postalBody)) {
    issues.push({
      kind: "postal_format",
      field: "postalCode",
      message: `Postal code does not match the expected ${country} format.`,
    });
  }

  return issues;
}
