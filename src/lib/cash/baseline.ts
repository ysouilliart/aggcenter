import { getConfig } from "../config";
import { getDataSource } from "../datasource";
import { ingestFromObjectStorage, ingestStatements, type IngestResult } from "../ingest";
import {
  ingestReferenceDocuments,
  type ReferenceIngestResult,
} from "../reference/ingest";
import type { ReferenceRepository } from "../reference/repository";
import { getStatementRepository, type StatementRepository } from "../statements";
import { getStorageProvider, type StorageProvider } from "../storage";

export interface CashBaselineResult {
  /** True when statement tables were emptied before this run. */
  reset: true;
  reference: ReferenceIngestResult;
  statements: IngestResult;
}

/**
 * One cash baseline from the UK org folders: wipe statement/parse tables,
 * reload reference CSVs, then parse bank files once.
 *
 * Reconciliation and cash position are derived from those tables, so this
 * also resets analysis. Bundled sample statements stay out of the way once
 * OCI statements exist (see `usesBundledCashSamples`).
 */
export async function loadCashBaseline(deps?: {
  storage?: StorageProvider;
  statementRepo?: StatementRepository;
  referenceRepo?: ReferenceRepository;
}): Promise<CashBaselineResult> {
  const config = getConfig();
  const storage = deps?.storage ?? getStorageProvider();
  const statementRepo = deps?.statementRepo ?? getStatementRepository();

  await statementRepo.clearAll();

  const reference = await ingestReferenceDocuments({
    storage,
    repo: deps?.referenceRepo,
  });

  const statements =
    deps?.storage || deps?.statementRepo
      ? await ingestStatements({
          storage,
          repo: statementRepo,
          accounts: await getDataSource().getAccounts(),
          prefixes: [config.statementCsvPrefix, config.statementPdfPrefix],
        })
      : await ingestFromObjectStorage(undefined, { replace: true });

  return { reset: true, reference, statements };
}

/** Bundled sample statements/docs are for empty local demos, not an OCI baseline. */
export function usesBundledCashSamples(statements: { source: string }[]): boolean {
  return !statements.some((s) => s.source === "oci");
}

export function usesBundledReferenceSamples(counts: {
  salesOrders: number;
  purchaseOrders: number;
  apInvoices?: number;
  remittances: number;
}): boolean {
  return (
    counts.salesOrders +
      counts.purchaseOrders +
      (counts.apInvoices ?? 0) +
      counts.remittances ===
    0
  );
}
