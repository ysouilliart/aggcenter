import { getConfig } from "../config";
import {
  cashObjectPrefix,
  DEFAULT_CASH_ORG_ROOT,
} from "../cash/paths";
import { parseCsv } from "../parse/csv";
import { getStorageProvider, type StorageProvider } from "../storage";
import {
  mapSalesOrders,
  mapUkApInvoices,
  mapUkPurchaseOrders,
  mapUkRemittances,
} from "./fromExtracts";
import { getReferenceRepository, type ReferenceRepository } from "./repository";

export const DEFAULT_AP_PREFIX = cashObjectPrefix("inv");
export const DEFAULT_PO_PREFIX = cashObjectPrefix("po");
export const DEFAULT_SO_PREFIX = cashObjectPrefix("so");
export const DEFAULT_REMITTANCE_PREFIX = cashObjectPrefix("rem");

export interface ReferenceIngestResult {
  provider: string;
  orgRoot: string;
  files: { key: string; rows: number }[];
  salesOrders: number;
  purchaseOrders: number;
  apInvoices: number;
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

function pickByPatterns(keys: string[], patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const hit = pickLatest(keys, (n) => re.test(n));
    if (hit) return hit;
  }
}

async function listCsvKeys(storage: StorageProvider, prefix: string): Promise<string[]> {
  const objects = await storage.list(prefix);
  return objects.filter((obj) => obj.key.toLowerCase().endsWith(".csv")).map((obj) => obj.key);
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
    orgRoot: config.cashFiles.orgRoot || DEFAULT_CASH_ORG_ROOT,
    files: [],
    salesOrders: 0,
    purchaseOrders: 0,
    apInvoices: 0,
    remittances: 0,
    errors: [],
  };

  const apPrefix = config.referenceApPrefix || DEFAULT_AP_PREFIX;
  const poPrefix = config.referencePoPrefix || DEFAULT_PO_PREFIX;
  const soPrefix = config.referenceSalesOrderPrefix || DEFAULT_SO_PREFIX;
  const remPrefix = config.referenceRemittancePrefix || DEFAULT_REMITTANCE_PREFIX;

  const [apKeys, poKeys, soKeys, remKeys] = await Promise.all([
    listCsvKeys(storage, apPrefix),
    listCsvKeys(storage, poPrefix),
    listCsvKeys(storage, soPrefix),
    listCsvKeys(storage, remPrefix),
  ]);

  const apHeaderKey = pickByPatterns(apKeys, [
    /ap_invoice_header/,
    /inv_header/,
    /invoice_header/,
  ]);
  const apLineKey = pickByPatterns(apKeys, [
    /ap_invoice_line/,
    /inv_lines?/,
    /invoice_line/,
  ]);
  const poHeaderKey = pickByPatterns(poKeys, [
    /po_header/,
    /purchase_order_header/,
  ]);
  const poLineKey =
    pickLatest(
      poKeys,
      (n) => /po_lines?/.test(n) && !/location|distribution/.test(n),
    ) || pickLatest(poKeys, (n) => n.includes("purchase_order_line"));
  const soHeaderKey = pickByPatterns(soKeys, [
    /sales_order_header/,
    /so_header/,
  ]);
  const soChargeKey = pickByPatterns(soKeys, [/charges_component/]);
  const remKey = pickLatest(remKeys, (n) => n.includes("remittance"));

  let apHeaders: Record<string, string>[] = [];
  let apLines: Record<string, string>[] = [];
  let poHeaders: Record<string, string>[] = [];
  let poLines: Record<string, string>[] = [];
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
  await take(poHeaderKey, (rows) => {
    poHeaders = rows;
  });
  await take(poLineKey, (rows) => {
    poLines = rows;
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

  const apInvoices = mapUkApInvoices({ headers: apHeaders, lines: apLines });
  const purchaseOrders = mapUkPurchaseOrders({ headers: poHeaders, lines: poLines });
  const seen = new Set(purchaseOrders.map((po) => po.id));
  const mergedPos = [
    ...purchaseOrders,
    ...apInvoices.filter((inv) => !seen.has(inv.id)),
  ];

  const snapshot = {
    salesOrders: mapSalesOrders({ headers: soHeaders, chargeComponents: soCharges }),
    purchaseOrders: mergedPos,
    remittances: mapUkRemittances(remRows),
  };
  await repo.replaceAll(snapshot);
  result.salesOrders = snapshot.salesOrders.length;
  result.purchaseOrders = purchaseOrders.length;
  result.apInvoices = apInvoices.length;
  result.remittances = snapshot.remittances.length;
  return result;
}
