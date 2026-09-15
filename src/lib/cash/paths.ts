/**
 * Cash-management object-storage layout.
 *
 * All UK cash files live under one org root with short folder names:
 *
 *   aggCenter/ORG_112 - UK/INV_112   AP invoices
 *   aggCenter/ORG_112 - UK/PO_112    purchase orders
 *   aggCenter/ORG_112 - UK/SO_112    sales orders
 *   aggCenter/ORG_112 - UK/REM_112   remittances
 *   aggCenter/ORG_112 - UK/BANK_112  bank statements (CSV and PDF)
 *
 * Override the root with `CASH_ORG_ROOT`, or a full prefix with the existing
 * `STATEMENT_*` / `REFERENCE_*` env vars. Folder names themselves are part of
 * the OCI scheme and are not independently configurable.
 */

export const DEFAULT_CASH_ORG_ROOT = "aggCenter/ORG_112 - UK";

export const CASH_FOLDERS = {
  inv: "INV_112",
  po: "PO_112",
  so: "SO_112",
  rem: "REM_112",
  bank: "BANK_112",
} as const;

export type CashFolder = keyof typeof CASH_FOLDERS;

export interface CashFilePrefixes {
  /** Org root without a trailing slash, e.g. `aggCenter/ORG_112 - UK`. */
  orgRoot: string;
  inv: string;
  po: string;
  so: string;
  rem: string;
  bank: string;
  /** CSV statement prefix; defaults to BANK_112. */
  statementCsv: string;
  /** PDF statement prefix; defaults to BANK_112. */
  statementPdf: string;
}

export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/** Join object-key segments, preserving internal spaces and exact casing. */
export function joinObjectPrefix(...parts: string[]): string {
  const joined = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0)
    .join("/");
  return withTrailingSlash(joined);
}

export function cashObjectPrefix(
  folder: CashFolder | string,
  orgRoot: string = DEFAULT_CASH_ORG_ROOT,
): string {
  const folderName =
    folder in CASH_FOLDERS ? CASH_FOLDERS[folder as CashFolder] : folder;
  return joinObjectPrefix(orgRoot, folderName);
}

/**
 * Resolve cash-management prefixes from env.
 *
 * `CASH_ORG_ROOT` sets the shared root; `REFERENCE_*` / `STATEMENT_*` override
 * a single full prefix when a deployment still uses a split layout.
 */
export function resolveCashFilePrefixes(
  env: Record<string, string | undefined> = process.env,
): CashFilePrefixes {
  const orgRoot = stripTrailingSlash(
    env.CASH_ORG_ROOT?.trim() || DEFAULT_CASH_ORG_ROOT,
  );
  const bank = cashObjectPrefix("bank", orgRoot);
  return {
    orgRoot,
    inv: withTrailingSlash(
      env.REFERENCE_AP_PREFIX?.trim() || cashObjectPrefix("inv", orgRoot),
    ),
    po: withTrailingSlash(
      env.REFERENCE_PO_PREFIX?.trim() || cashObjectPrefix("po", orgRoot),
    ),
    so: withTrailingSlash(
      env.REFERENCE_SO_PREFIX?.trim() || cashObjectPrefix("so", orgRoot),
    ),
    rem: withTrailingSlash(
      env.REFERENCE_REMITTANCE_PREFIX?.trim() || cashObjectPrefix("rem", orgRoot),
    ),
    bank,
    statementCsv: withTrailingSlash(env.STATEMENT_CSV_PREFIX?.trim() || bank),
    statementPdf: withTrailingSlash(env.STATEMENT_PDF_PREFIX?.trim() || bank),
  };
}
