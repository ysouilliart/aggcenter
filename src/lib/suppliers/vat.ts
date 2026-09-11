/**
 * VAT / tax-id format checks for European (and GB) supplier numbers.
 *
 * Normalises whitespace and punctuation, then validates the country prefix
 * against published VAT patterns. Checksums are applied where they are
 * unambiguous; format failures are the primary "incorrect attribute" signal.
 */

export type VatAssessmentStatus =
  | "ok"
  | "missing"
  | "invalid_format"
  | "missing_prefix"
  | "country_mismatch"
  | "checksum_failed";

export interface VatAssessment {
  status: VatAssessmentStatus;
  value: string;
  normalized: string;
  vatCountry?: string;
  message: string;
  suggestion?: string;
}

const PREFIX_ALIAS: Record<string, string> = {
  GR: "EL",
  UK: "GB",
};

/** Country-code prefix → body pattern (prefix already stripped). */
const BODY: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^\d{10}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-Z0-9]{2}\d{9}$/,
  GB: /^\d{9}$|^\d{12}$|^GD\d{3}$|^HA\d{3}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^\d{7}[A-Z]{1,2}$|^\d[A-Z+*]\d{5}[A-Z]$/,
  IT: /^\d{11}$/,
  LT: /^\d{9}$|^\d{12}$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
};

const PREFIXES = new Set(Object.keys(BODY));

function aliasCountry(code: string): string {
  const upper = code.toUpperCase();
  return PREFIX_ALIAS[upper] ?? upper;
}

export function normalizeVat(value: string): string {
  return value.replace(/[\s.\-/]/g, "").toUpperCase();
}

export function looksLikeVatPrefix(value: string): string | undefined {
  const two = value.slice(0, 2);
  if (PREFIXES.has(two) || PREFIXES.has(aliasCountry(two))) {
    return aliasCountry(two);
  }
  if (value.startsWith("ATU") && PREFIXES.has("AT")) return "AT";
  return undefined;
}

export function bodyFor(prefix: string, normalized: string): string {
  if (prefix === "AT" && normalized.startsWith("AT")) return normalized.slice(2);
  if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  return normalized;
}

/** Split a VAT ID into VIES `countryCode` + `vatNumber` (body, no prefix). */
export function splitVatNumber(
  value: string,
  country?: string,
): { countryCode: string; vatNumber: string } | undefined {
  const normalized = normalizeVat(value);
  if (!normalized) return undefined;
  const prefix = looksLikeVatPrefix(normalized);
  if (prefix) {
    return { countryCode: prefix, vatNumber: bodyFor(prefix, normalized) };
  }
  const inferred = inferVatPrefix(normalized, country);
  if (inferred && formatOk(inferred, normalized)) {
    return { countryCode: inferred, vatNumber: normalized };
  }
  return undefined;
}

function formatOk(prefix: string, body: string): boolean {
  const re = BODY[prefix];
  return Boolean(re && re.test(body));
}

/** Infer a likely prefix from a digit-only (or ES-style) body + address country. */
export function inferVatPrefix(normalized: string, country?: string): string | undefined {
  if (!country) return undefined;
  return aliasCountry(country);
}

export function assessVat(value: string, country?: string): VatAssessment {
  const raw = (value ?? "").trim();
  if (!raw) {
    return {
      status: "missing",
      value: raw,
      normalized: "",
      message: "VAT ID is missing.",
    };
  }

  const normalized = normalizeVat(raw);
  const prefix = looksLikeVatPrefix(normalized);
  const addressCountry = country ? aliasCountry(country) : undefined;

  if (prefix) {
    const body = bodyFor(prefix, normalized);
    if (!formatOk(prefix, body)) {
      return {
        status: "invalid_format",
        value: raw,
        normalized,
        vatCountry: prefix,
        message: `VAT ID does not match the ${prefix} format.`,
      };
    }
    if (addressCountry && addressCountry !== prefix) {
      return {
        status: "country_mismatch",
        value: raw,
        normalized,
        vatCountry: prefix,
        message: `VAT prefix ${prefix} does not match address country ${addressCountry}.`,
      };
    }
    if (checksumFails(prefix, body)) {
      return {
        status: "checksum_failed",
        value: raw,
        normalized,
        vatCountry: prefix,
        message: `VAT ID checksum failed for ${prefix}.`,
      };
    }
    const suggestion = raw !== normalized ? normalized : undefined;
    return {
      status: "ok",
      value: raw,
      normalized,
      vatCountry: prefix,
      message: suggestion ? "VAT ID has extra spacing or punctuation." : "VAT ID format looks valid.",
      suggestion,
    };
  }

  const inferred = inferVatPrefix(normalized, addressCountry);
  if (inferred && formatOk(inferred, normalized)) {
    const suggestion = `${inferred}${normalized}`;
    if (checksumFails(inferred, normalized)) {
      return {
        status: "checksum_failed",
        value: raw,
        normalized,
        vatCountry: inferred,
        message: `VAT ID checksum failed for ${inferred}.`,
        suggestion,
      };
    }
    return {
      status: "missing_prefix",
      value: raw,
      normalized,
      vatCountry: inferred,
      message: `VAT ID is missing the ${inferred} country prefix.`,
      suggestion,
    };
  }

  return {
    status: "invalid_format",
    value: raw,
    normalized,
    message: addressCountry
      ? `VAT ID does not match a recognised ${addressCountry} format.`
      : "VAT ID does not match a recognised EU/GB format.",
  };
}

function checksumFails(prefix: string, body: string): boolean {
  try {
    switch (prefix) {
      case "BE":
        return !beChecksum(body);
      case "NL":
        return !nlChecksum(body);
      case "PT":
        return !ptChecksum(body);
      case "IT":
        return !itChecksum(body);
      case "GB":
        return !gbChecksum(body);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function beChecksum(body: string): boolean {
  if (!/^\d{10}$/.test(body)) return false;
  const num = Number(body.slice(0, 8));
  const check = Number(body.slice(8));
  return 97 - (num % 97) === check;
}

function nlChecksum(body: string): boolean {
  const digits = body.slice(0, 9);
  if (!/^\d{9}$/.test(digits)) return false;
  const weights = [9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * weights[i];
  const check = sum % 11;
  if (check === 10) return false;
  return check === Number(digits[8]);
}

function ptChecksum(body: string): boolean {
  if (!/^\d{9}$/.test(body)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(body[i]) * (9 - i);
  const mod = sum % 11;
  const check = mod < 2 ? 0 : 11 - mod;
  return check === Number(body[8]);
}

function itChecksum(body: string): boolean {
  if (!/^\d{11}$/.test(body)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(body[i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(body[10]);
}

function gbChecksum(body: string): boolean {
  if (/^GD\d{3}$/.test(body) || /^HA\d{3}$/.test(body)) return true;
  if (!/^\d{9}$/.test(body) && !/^\d{12}$/.test(body)) return false;
  const digits = body.slice(0, 9);
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(digits[i]) * weights[i];
  const check = Number(digits.slice(7, 9));
  const a = 97 - (sum % 97);
  const b = 97 - ((sum + 55) % 97);
  return check === a || check === b;
}
