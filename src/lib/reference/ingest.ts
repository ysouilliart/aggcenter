import { getConfig } from "../config";
import { parseCsv } from "../parse/csv";
import { getStorageProvider, type StorageProvider } from "../storage";
import { mapSalesOrders, mapUkApInvoices, mapUkRemittances } from "./fromExtracts";
import { getReferenceRepository, type ReferenceRepository } from "./repository";

export const DEFAULT_AP_PREFIX = "aggCenter/APInvoices/";
export const DEFAULT_SO_PREFIX = "aggCenter/salesOrder/";
export const DEFAULT_REMITTANCE_PREFIX = "aggCenter/remittance/";

export interface ReferenceIngestResult {
  provider: string;
  files: { key: string; rows: number }[];
  salesOrders: number;
  purchaseOrders: number;
  remittances: number;
  errors: { key: string; error: string }[];
}

async function loadCsv(
  storage: StorageProvider,
  key: string,
): Promise<Record<string, string>[]> {
  const buf = await storage.get(key);
  return parseCsv(buf.toString("utf8"));
}

function pickLatest(keys: string[], match: (name: string) => boolean): string | undefined {
  const hits = keys.filter((k) => match(k.split("/").pop()?.toLowerCase() ?? ""));
  return hits.at(-1);
}

export async function ingestReferenceDocuments(deps?: {
  storage?: StorageProvider;
  repo?: ReferenceRepository;
}): Promise<ReferenceIngestResult> {
  const config = getConfig();
  const storage = deps?.storage ?? getStorageProvider();
  const repo = deps?.repo ?? getReferenceRepository();
  const result: ReferenceIngestResult = {
    provider: storage.name,
    files: [],
    salesOrders: 0,
    purchaseOrders: 0,
    remittances: 0,
    errors: [],
  };

  const prefixes = [
    config.referenceApPrefix || DEFAULT_AP_PREFIX,
    config.referenceSalesOrderPrefix || DEFAULT_SO_PREFIX,
    config.referenceRemittancePrefix || DEFAULT_REMITTANCE_PREFIX,
  ];
  const keys: string[] = [];
  for (const prefix of prefixes) {
    const objects = await storage.list(prefix);
    for (const obj of objects) {
      if (obj.key.toLowerCase().endsWith(".csv")) keys.push(obj.key);
    }
  }

  const apHeaderKey = pickLatest(keys, (n) => n.includes("ap_invoice_header"));
  const apLineKey = pickLatest(keys, (n) => n.includes("ap_invoice_line"));
  const soHeaderKey = pickLatest(keys, (n) => n.includes("sales_order_header"));
  const soChargeKey = pickLatest(keys, (n) => n.includes("charges_component"));
  const remKey = pickLatest(keys, (n) => n.includes("remittance"));

  let apHeaders: Record<string, string>[] = [];
  let apLines: Record<string, string>[] = [];
  let soHeaders: Record<string, string>[] = [];
  let soCharges: Record<string, string>[] = [];
  let remRows: Record<string, string>[] = [];

  async function take(key: string | undefined, assign: (rows: Record<string, string>[]) => void) {
    if (!key) return;
    try {
      const rows = await loadCsv(storage, key);
      assign(rows);
      result.files.push({ key, rows: rows.length });
    } catch (err) {
      result.errors.push({
        key,
        error: err instanceof Error ? err.message : "failed to read",
      });
    }
  }

  await take(apHeaderKey, (rows) => {
    apHeaders = rows;
  });
  await take(apLineKey, (rows) => {
    apLines = rows;
  });
  await take(soHeaderKey, (rows) => {
    soHeaders = rows;
  });
  await take(soChargeKey, (rows) => {
    soCharges = rows;
  });
  await take(remKey, (rows) => {
    remRows = rows;
  });

  const snapshot = {
    salesOrders: mapSalesOrders({ headers: soHeaders, chargeComponents: soCharges }),
    purchaseOrders: mapUkApInvoices({ headers: apHeaders, lines: apLines }),
    remittances: mapUkRemittances(remRows),
  };
  await repo.replaceAll(snapshot);
  result.salesOrders = snapshot.salesOrders.length;
  result.purchaseOrders = snapshot.purchaseOrders.length;
  result.remittances = snapshot.remittances.length;
  return result;
}
