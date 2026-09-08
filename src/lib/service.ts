import { promises as fs } from "fs";
import path from "path";

import { getConfig } from "./config";
import { getDataSource } from "./datasource";
import { getStorageProvider } from "./storage";
import type { StoredObject } from "./storage";
import { parseBankStatementCsv } from "./parse/bankStatement";
import { reconcile, summarize } from "./recon/reconcile";
import { computeCashPosition } from "./cash/position";
import { detectAnomalies } from "./anomalies/detect";
import type {
  Anomaly,
  BankAccount,
  BankTransaction,
  CashPosition,
  ReconciliationResult,
  Statement,
} from "./domain/types";

const UPLOADS_FILE = path.join(process.cwd(), ".data", "uploads.json");

interface UploadRecord {
  statement: Statement;
  transactions: BankTransaction[];
}

async function readUploads(): Promise<UploadRecord[]> {
  try {
    const raw = await fs.readFile(UPLOADS_FILE, "utf8");
    return JSON.parse(raw) as UploadRecord[];
  } catch {
    return [];
  }
}

async function writeUploads(records: UploadRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(UPLOADS_FILE), { recursive: true });
  await fs.writeFile(UPLOADS_FILE, JSON.stringify(records, null, 2), "utf8");
}

export async function getAccounts(): Promise<BankAccount[]> {
  return getDataSource().getAccounts();
}

/** Load and parse the bundled sample statements. */
async function getSampleData(): Promise<{
  transactions: BankTransaction[];
  statements: Statement[];
}> {
  const ds = getDataSource();
  const [manifest, accounts] = await Promise.all([
    ds.getStatementManifest(),
    ds.getAccounts(),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const transactions: BankTransaction[] = [];
  const statements: Statement[] = [];

  for (const entry of manifest) {
    const csv = await ds.readStatementFile(entry.file);
    const account = accountById.get(entry.accountId);
    const { transactions: parsed } = parseBankStatementCsv(csv, {
      statementId: entry.id,
      accountId: entry.accountId,
      defaultCurrency: account?.currency,
    });
    transactions.push(...parsed);
    statements.push({
      id: entry.id,
      accountId: entry.accountId,
      fileName: path.basename(entry.file),
      source: "sample",
      periodStart: entry.periodStart,
      periodEnd: entry.periodEnd,
      transactionCount: parsed.length,
    });
  }

  return { transactions, statements };
}

export async function getAllTransactions(): Promise<BankTransaction[]> {
  const [{ transactions }, uploads] = await Promise.all([
    getSampleData(),
    readUploads(),
  ]);
  return [...transactions, ...uploads.flatMap((u) => u.transactions)];
}

export async function getStatements(): Promise<Statement[]> {
  const [{ statements }, uploads] = await Promise.all([
    getSampleData(),
    readUploads(),
  ]);
  return [...statements, ...uploads.map((u) => u.statement)];
}

export interface AddStatementParams {
  fileName: string;
  content: Buffer;
  accountId: string;
  currency?: string;
}

export async function addUploadedStatement(
  params: AddStatementParams,
): Promise<{ statement: Statement; errors: string[] }> {
  const { fileName, content, accountId } = params;
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.id === accountId);
  const currency = params.currency || account?.currency || "USD";

  const statementId = `UP-${Date.now()}`;
  const storageKey = `statements/${statementId}-${fileName}`;

  // Persist the raw file via the active storage provider (local or OCI).
  const storage = getStorageProvider();
  await storage.put(storageKey, content, "text/csv");

  const { transactions, errors } = parseBankStatementCsv(content.toString("utf8"), {
    statementId,
    accountId,
    defaultCurrency: currency,
  });

  const dates = transactions.map((t) => t.date).sort();
  const statement: Statement = {
    id: statementId,
    accountId,
    fileName,
    source: "upload",
    periodStart: dates[0] ?? new Date().toISOString().slice(0, 10),
    periodEnd: dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10),
    transactionCount: transactions.length,
    storageKey,
    uploadedAt: new Date().toISOString(),
  };

  const uploads = await readUploads();
  uploads.push({ statement, transactions });
  await writeUploads(uploads);

  return { statement, errors };
}

export async function getReconciliation(): Promise<{
  results: ReconciliationResult[];
  summary: ReturnType<typeof summarize>;
}> {
  const ds = getDataSource();
  const [transactions, salesOrders, purchaseOrders] = await Promise.all([
    getAllTransactions(),
    ds.getSalesOrders(),
    ds.getPurchaseOrders(),
  ]);
  const results = reconcile({ transactions, salesOrders, purchaseOrders });
  return { results, summary: summarize(results) };
}

export async function getCashPositions(): Promise<CashPosition[]> {
  const [accounts, transactions] = await Promise.all([
    getAccounts(),
    getAllTransactions(),
  ]);
  const currencies = [...new Set(accounts.map((a) => a.currency))];
  return currencies.map((currency) =>
    computeCashPosition({ currency, accounts, transactions }),
  );
}

export async function getAnomalies(): Promise<Anomaly[]> {
  const ds = getDataSource();
  const [transactions, remittances, accounts, recon] = await Promise.all([
    getAllTransactions(),
    ds.getRemittances(),
    getAccounts(),
    getReconciliation(),
  ]);
  return detectAnomalies({
    transactions,
    reconciliation: recon.results,
    remittances,
    accounts,
  });
}

export interface IntegrationStatus {
  storageProvider: string;
  dataSource: string;
  oci: {
    active: boolean;
    configured: boolean;
    authMode: string;
    bucket?: string;
    region?: string;
    namespace?: string;
  };
  snowflake: { active: boolean; configured: boolean; account?: string; database?: string };
  externalApi: { configured: boolean; baseUrl?: string };
  reportingCurrency: string;
}

export function getIntegrationStatus(): IntegrationStatus {
  const config = getConfig();
  return {
    storageProvider: getStorageProvider().name,
    dataSource: getDataSource().name,
    oci: {
      active: getStorageProvider().name === "oci",
      configured: config.oci.configured,
      authMode: config.oci.authMode,
      bucket: config.oci.bucket,
      region: config.oci.region,
      namespace: config.oci.namespace,
    },
    snowflake: {
      active: getDataSource().name === "snowflake",
      configured: config.snowflake.configured,
      account: config.snowflake.account,
      database: config.snowflake.database,
    },
    externalApi: {
      configured: Boolean(config.externalApiBaseUrl),
      baseUrl: config.externalApiBaseUrl,
    },
    reportingCurrency: config.reportingCurrency,
  };
}

// --- Object storage browsing / on-request file preview -----------------------

/** Reject keys that could escape the bucket/root or contain control characters. */
export function assertSafeKey(key: string): void {
  if (!key || key.length > 1024) {
    throw new Error("Invalid object key.");
  }
  if (
    key.includes("\0") ||
    key.includes("..") ||
    key.startsWith("/") ||
    key.startsWith("\\") ||
    key.includes("\\")
  ) {
    throw new Error("Invalid object key.");
  }
}

export interface StorageOverview {
  provider: string;
  objects: StoredObject[];
}

export async function listStorageObjects(prefix = ""): Promise<StorageOverview> {
  const provider = getStorageProvider();
  const objects = await provider.list(prefix);
  return { provider: provider.name, objects };
}

const MAX_PREVIEW_BYTES = 512 * 1024; // 512 KiB

export interface ObjectPreview {
  key: string;
  provider: string;
  size: number;
  truncated: boolean;
  isBinary: boolean;
  text: string;
}

/** Pure preview builder (size cap + binary guard); separated for testability. */
export function buildObjectPreview(
  key: string,
  provider: string,
  buffer: Buffer,
): ObjectPreview {
  const truncated = buffer.length > MAX_PREVIEW_BYTES;
  const slice = truncated ? buffer.subarray(0, MAX_PREVIEW_BYTES) : buffer;
  // Heuristic: a NUL byte in the sampled range indicates binary content.
  const isBinary = slice.subarray(0, 8000).includes(0);
  return {
    key,
    provider,
    size: buffer.length,
    truncated,
    isBinary,
    text: isBinary ? "" : slice.toString("utf8"),
  };
}

/** Fetch a single object's content on request, with a size cap and binary guard. */
export async function getStorageObjectPreview(key: string): Promise<ObjectPreview> {
  assertSafeKey(key);
  const provider = getStorageProvider();
  const buffer = await provider.get(key);
  return buildObjectPreview(key, provider.name, buffer);
}
