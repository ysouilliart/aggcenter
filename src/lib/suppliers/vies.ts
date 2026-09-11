/**
 * EU VIES VAT registry client.
 *
 * Official public REST API (no key):
 *   POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number
 * Swagger: https://ec.europa.eu/assets/taxud/vow-information/swagger_publicVAT.yaml
 *
 * VIES confirms whether a number is registered and, when the member state
 * publishes it, returns the registered name and address. Match flags for the
 * trader fields we send are often `NOT_PROCESSED`, so we also compare locally.
 *
 * GB numbers are not in VIES after Brexit (`unsupported`). Northern Ireland
 * (`XI`) still is. Member-state outages come back as `inconclusive`, not invalid.
 */

import { getConfig } from "../config";
import type { Supplier, SupplierSite, VatDetailMatch, VatScope } from "./types";
import { normalizeVat, splitVatNumber } from "./vat";
import { compareTraderDetails } from "./viesCompare";

export const DEFAULT_VIES_API_URL =
  "https://ec.europa.eu/taxation_customs/vies/rest-api";

/** EU VIES member-state codes (EL = Greece). XI = Northern Ireland. */
export const VIES_COUNTRY_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "EL",
  "ES",
  "FI",
  "FR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
  "XI",
]);

export type ViesMatchFlag = "VALID" | "INVALID" | "NOT_PROCESSED" | string;

export interface ViesCheckRequest {
  countryCode: string;
  vatNumber: string;
  traderName?: string;
  traderStreet?: string;
  traderPostalCode?: string;
  traderCity?: string;
}

export interface ViesApiResponse {
  countryCode?: string;
  vatNumber?: string;
  requestDate?: string;
  valid?: boolean;
  name?: string;
  address?: string;
  traderName?: string;
  traderStreet?: string;
  traderPostalCode?: string;
  traderCity?: string;
  traderNameMatch?: ViesMatchFlag;
  traderStreetMatch?: ViesMatchFlag;
  traderPostalCodeMatch?: ViesMatchFlag;
  traderCityMatch?: ViesMatchFlag;
  actionSucceed?: boolean;
  errorWrappers?: { error?: string; message?: string }[];
  userError?: string;
}

export type ViesLookupStatus = "valid" | "invalid" | "inconclusive" | "unsupported";

export interface ViesLookupResult {
  status: ViesLookupStatus;
  countryCode: string;
  vatNumber: string;
  valid?: boolean;
  registeredName?: string;
  registeredAddress?: string;
  requestDate?: string;
  nameMatch: VatDetailMatch;
  addressMatch: VatDetailMatch;
  message: string;
  raw?: ViesApiResponse;
}

export interface ViesClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export { compareAddresses, compareNames, compareTraderDetails, parseViesAddress } from "./viesCompare";

function blank(value: string | undefined): string {
  return (value ?? "").trim();
}

export function isViesSupported(countryCode: string): boolean {
  return VIES_COUNTRY_CODES.has(countryCode.toUpperCase());
}

export function viesEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/check-vat-number`;
}

function viesFlagToMatch(flag: ViesMatchFlag | undefined): VatDetailMatch | undefined {
  if (flag === "VALID") return "match";
  if (flag === "INVALID") return "mismatch";
  return undefined;
}

function errorMessage(data: ViesApiResponse, fallback: string): string {
  const wrapped = data.errorWrappers?.[0];
  return wrapped?.error || wrapped?.message || data.userError || fallback;
}

export async function checkVatWithVies(
  request: ViesCheckRequest,
  options: ViesClientOptions = {},
): Promise<ViesLookupResult> {
  const countryCode = request.countryCode.toUpperCase();
  const vatNumber = normalizeVat(request.vatNumber);
  if (!isViesSupported(countryCode)) {
    return {
      status: "unsupported",
      countryCode,
      vatNumber,
      nameMatch: "unknown",
      addressMatch: "unknown",
      message:
        countryCode === "GB"
          ? "UK VAT IDs are not in EU VIES after Brexit."
          : `VIES does not cover country ${countryCode}.`,
    };
  }

  const baseUrl = options.baseUrl ?? getConfig().viesApiUrl;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(viesEndpoint(baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        countryCode,
        vatNumber,
        traderName: blank(request.traderName) || undefined,
        traderStreet: blank(request.traderStreet) || undefined,
        traderPostalCode: blank(request.traderPostalCode) || undefined,
        traderCity: blank(request.traderCity) || undefined,
      }),
      signal: controller.signal,
    });
    let data: ViesApiResponse = {};
    try {
      data = (await res.json()) as ViesApiResponse;
    } catch {
      data = {};
    }

    if (!res.ok || data.actionSucceed === false) {
      return {
        status: "inconclusive",
        countryCode,
        vatNumber,
        nameMatch: "unknown",
        addressMatch: "unknown",
        message: errorMessage(data, `VIES request failed (${res.status}).`),
        raw: data,
      };
    }

    const registeredName = blank(data.name) || undefined;
    const registeredAddress = blank(data.address) || undefined;
    const local = compareTraderDetails(
      {
        name: request.traderName ?? "",
        street: request.traderStreet ?? "",
        city: request.traderCity ?? "",
        postalCode: request.traderPostalCode ?? "",
      },
      { name: registeredName, address: registeredAddress },
    );
    const nameMatch = viesFlagToMatch(data.traderNameMatch) ?? local.nameMatch;
    const streetMatch = viesFlagToMatch(data.traderStreetMatch);
    const postalMatch = viesFlagToMatch(data.traderPostalCodeMatch);
    const cityMatch = viesFlagToMatch(data.traderCityMatch);
    let addressMatch = local.addressMatch;
    const flags = [streetMatch, postalMatch, cityMatch].filter(Boolean) as VatDetailMatch[];
    if (flags.includes("mismatch")) addressMatch = "mismatch";
    else if (flags.length && flags.every((f) => f === "match")) addressMatch = "match";

    if (data.valid === true) {
      return {
        status: "valid",
        countryCode,
        vatNumber,
        valid: true,
        registeredName,
        registeredAddress,
        requestDate: data.requestDate,
        nameMatch,
        addressMatch,
        message: registeredName
          ? `VAT ID is registered in VIES as ${registeredName}.`
          : "VAT ID is registered in VIES. The member state did not return a name.",
        raw: data,
      };
    }
    if (data.valid === false) {
      return {
        status: "invalid",
        countryCode,
        vatNumber,
        valid: false,
        registeredName,
        registeredAddress,
        requestDate: data.requestDate,
        nameMatch: "unknown",
        addressMatch: "unknown",
        message: "VAT ID is not registered in the VIES database.",
        raw: data,
      };
    }
    return {
      status: "inconclusive",
      countryCode,
      vatNumber,
      nameMatch: "unknown",
      addressMatch: "unknown",
      message: "VIES did not return a validity result.",
      raw: data,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      status: "inconclusive",
      countryCode,
      vatNumber,
      nameMatch: "unknown",
      addressMatch: "unknown",
      message: aborted
        ? "VIES request timed out."
        : `VIES request failed: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function vatRequestForRecord(
  supplier: Supplier,
  site: SupplierSite,
  scope: VatScope,
): ViesCheckRequest | { error: string } {
  const vat = scope === "site" ? blank(site.siteVat) : blank(supplier.supplierVat);
  const label = scope === "site" ? "site" : "supplier";
  if (!vat) return { error: `This record has no ${label} VAT ID to validate.` };
  const split = splitVatNumber(vat, site.country);
  if (!split) {
    return { error: `Cannot parse ${label} VAT ID “${vat}” into a country code and number.` };
  }
  return {
    countryCode: split.countryCode,
    vatNumber: split.vatNumber,
    traderName: supplier.name,
    traderStreet: site.addressLine1,
    traderPostalCode: site.postalCode,
    traderCity: site.city,
  };
}
