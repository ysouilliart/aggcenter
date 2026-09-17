import path from "path";

import { getConfig } from "./config";
import { getDataSource } from "./datasource";
import { getStorageProvider } from "./storage";
import type { StoredObject } from "./storage";
import { getStatementRepository } from "./statements";
import { getReferenceRepository } from "./reference/repository";
import { isDatabaseConfigured } from "./db/client";
import { parseBankStatementCsv } from "./parse/bankStatement";
import { reconcile, summarize } from "./recon/reconcile";
import { computeCashPosition } from "./cash/position";
import { buildCashForecast } from "./cash/forecast";
import {
  cashWorkspaceGeneration,
  getCachedCashWorkspace,
  getInflightCashWorkspace,
  invalidateCashWorkspace,
  setCachedCashWorkspace,
  setInflightCashWorkspace,
} from "./cash/cache";
import {
  usesBundledCashSamples,
  usesBundledReferenceSamples,
} from "./cash/baseline";
import { detectAnomalies } from "./anomalies/detect";
import { sourceFileName } from "./reference/util";
import type {
  Anomaly,
  BankAccount,
  BankTransaction,
  CashPosition,
  ParseJob,
  PurchaseOrder,
  ReconciliationResult,
  Remittance,
  SalesOrder,
  Statement,
  CashForecast,
} from "./domain/types";

export async function getAccounts(): Promise<BankAccount[]> {
  const [seed, persisted, statements] = await Promise.all([
    getDataSource().getAccounts(),
    getStatementRepository().listAccounts(),
    getStatementRepository().listStatements(),
  ]);
  const byId = new Map<string, BankAccount>();
  if (usesBundledCashSamples(statements)) {
    for (const account of seed) byId.set(account.id, account);
  }
  for (const account of persisted) byId.set(account.id, account);
  return [...byId.values()];
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
  const [sample, uploaded, statements] = await Promise.all([
    getSampleData(),
    getStatementRepository().listTransactions(),
    getStatementRepository().listStatements(),
  ]);
  if (!usesBundledCashSamples(statements)) return uploaded;
  return [...sample.transactions, ...uploaded];
}

export async function getStatements(): Promise<Statement[]> {
  const [sample, uploaded] = await Promise.all([
    getSampleData(),
    getStatementRepository().listStatements(),
  ]);
  if (!usesBundledCashSamples(uploaded)) return uploaded;
  return [...sample.statements, ...uploaded];
}

export interface StatementDetail {
  statement: Statement;
  transactions: BankTransaction[];
  job: ParseJob | null;
  account: BankAccount | null;
}

/** One statement plus its lines and parse trace (sample or persisted). */
export async function getStatementDetail(
  id: string,
): Promise<StatementDetail | null> {
  if (!id) return null;
  const repo = getStatementRepository();
  const [uploaded, sample, accounts] = await Promise.all([
    repo.getStatement(id),
    getSampleData(),
    getAccounts(),
  ]);
  const statement = uploaded ?? sample.statements.find((s) => s.id === id);
  if (!statement) return null;

  const transactions = uploaded
    ? await repo.listTransactionsForStatement(id)
    : sample.transactions.filter((t) => t.statementId === id);

  const job = uploaded ? ((await repo.getParseJobForStatement(id)) ?? null) : null;
  let account = accounts.find((a) => a.id === statement.accountId) ?? null;
  if (!account) {
    const seed = await getDataSource().getAccounts();
    account = seed.find((a) => a.id === statement.accountId) ?? null;
  }
  return { statement, transactions, job, account };
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

  await getStatementRepository().addUpload(statement, transactions);
  invalidateCashWorkspace();

  return { statement, errors };
}

async function getSupportingDocuments(): Promise<{
  salesOrders: SalesOrder[];
  purchaseOrders: PurchaseOrder[];
  remittances: Remittance[];
}> {
  const ds = getDataSource();
  const repo = getReferenceRepository();
  const [salesOrders, purchaseOrders, remittances, persisted] = await Promise.all([
    ds.getSalesOrders(),
    ds.getPurchaseOrders(),
    ds.getRemittances(),
    Promise.all([
      repo.listSalesOrders(),
      repo.listPurchaseOrders(),
      repo.listRemittances(),
    ]).then(([so, po, rem]) => ({ so, po, rem })),
  ]);
  const includeSamples = usesBundledReferenceSamples({
    salesOrders: persisted.so.length,
    purchaseOrders: persisted.po.filter((p) => !p.id.startsWith("AP-")).length,
    apInvoices: persisted.po.filter((p) => p.id.startsWith("AP-")).length,
    remittances: persisted.rem.length,
  });
  return {
    salesOrders: includeSamples ? [...salesOrders, ...persisted.so] : persisted.so,
    purchaseOrders: includeSamples
      ? [...purchaseOrders, ...persisted.po]
      : persisted.po,
    remittances: includeSamples
      ? [...remittances, ...persisted.rem]
      : persisted.rem,
  };
}

function ensureAccountsForTransactions(
  accounts: BankAccount[],
  transactions: BankTransaction[],
): BankAccount[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const txn of transactions) {
    if (byId.has(txn.accountId)) continue;
    byId.set(txn.accountId, {
      id: txn.accountId,
      name: txn.accountId,
      bank: "Unknown",
      currency: txn.currency,
      openingBalance: 0,
    });
  }
  return [...byId.values()];
}

interface CashWorkspace {
  recon: {
    results: ReconciliationResult[];
    summary: ReturnType<typeof summarize>;
  };
  positions: CashPosition[];
  forecasts: CashForecast[];
  anomalies: Anomaly[];
}

function withBankSource(
  transactions: BankTransaction[],
  statements: Statement[],
): BankTransaction[] {
  const fileById = new Map(
    statements.map((s) => [s.id, sourceFileName(s.fileName) ?? s.fileName]),
  );
  return transactions.map((txn) => ({
    ...txn,
    sourceFile: txn.sourceFile || fileById.get(txn.statementId),
  }));
}

async function buildCashWorkspace(): Promise<CashWorkspace> {
  const [transactionsRaw, accounts, statements, supporting] = await Promise.all([
    getAllTransactions(),
    getAccounts(),
    getStatements(),
    getSupportingDocuments(),
  ]);
  const transactions = withBankSource(transactionsRaw, statements);
  const merged = ensureAccountsForTransactions(accounts, transactions);
  const reconResults = reconcile({
    transactions,
    salesOrders: supporting.salesOrders,
    purchaseOrders: supporting.purchaseOrders,
    remittances: supporting.remittances,
  });
  const recon = { results: reconResults, summary: summarize(reconResults) };

  const reporting = getConfig().reportingCurrency;
  const currencies = [...new Set(merged.map((a) => a.currency))];
  currencies.sort((a, b) => {
    if (a === reporting) return -1;
    if (b === reporting) return 1;
    return a.localeCompare(b);
  });
  const positions = currencies.map((currency) =>
    computeCashPosition({ currency, accounts: merged, transactions }),
  );

  const periodStart = [...statements.map((s) => s.periodStart)].sort()[0];
  const closingByCurrency: Record<string, number> = {};
  for (const position of positions) {
    closingByCurrency[position.currency] = position.closingBalance;
  }
  const forecasts = buildCashForecast({
    remittances: supporting.remittances,
    reconciliation: recon.results,
    transactions,
    periodStart,
    closingByCurrency,
  });
  const anomalies = detectAnomalies({
    transactions,
    reconciliation: recon.results,
    accounts: merged,
  });
  return { recon, positions, forecasts, anomalies };
}

async function getCashWorkspace(): Promise<CashWorkspace> {
  const cached = getCachedCashWorkspace<CashWorkspace>();
  if (cached) return cached;
  const pending = getInflightCashWorkspace<CashWorkspace>();
  if (pending) return pending;
  const generation = cashWorkspaceGeneration();
  const promise = buildCashWorkspace().then((workspace) => {
    if (generation === cashWorkspaceGeneration()) {
      setCachedCashWorkspace(workspace);
    }
    return workspace;
  });
  setInflightCashWorkspace(promise);
  try {
    return await promise;
  } finally {
    setInflightCashWorkspace(null);
  }
}

export { invalidateCashWorkspace };

export async function getReconciliation(): Promise<{
  results: ReconciliationResult[];
  summary: ReturnType<typeof summarize>;
}> {
  const workspace = await getCashWorkspace();
  return workspace.recon;
}

export async function getCashPositions(): Promise<CashPosition[]> {
  const workspace = await getCashWorkspace();
  return workspace.positions;
}

export async function getAnomalies(): Promise<Anomaly[]> {
  const workspace = await getCashWorkspace();
  return workspace.anomalies;
}

export async function getCashForecasts(): Promise<CashForecast[]> {
  const workspace = await getCashWorkspace();
  return workspace.forecasts;
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
    baseUrl?: string;
  };
  snowflake: { active: boolean; configured: boolean; account?: string; database?: string };
  externalApi: { configured: boolean; baseUrl?: string };
  database: { configured: boolean; provider: string };
  reportingCurrency: string;
  cashFiles: {
    orgRoot: string;
    inv: string;
    po: string;
    so: string;
    rem: string;
    bank: string;
    statementCsv: string;
    statementPdf: string;
  };
  invoiceClassify: {
    mode: "llm" | "static";
    llmEnabled: boolean;
    llmReady: boolean;
    model: string;
    provider: "openai" | "xai";
    staticFastPath: boolean;
    warning?: string;
    seedSamples: boolean;
  };
  peopleDocsClassify: {
    mode: "llm" | "static";
    llmEnabled: boolean;
    llmReady: boolean;
    model: string;
    provider: "openai" | "xai";
    warning?: string;
    seedSamples: boolean;
    prefix: string;
  };
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
      baseUrl: config.oci.swiftBaseUrl,
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
    database: {
      configured: isDatabaseConfigured(),
      provider: getStatementRepository().name,
    },
    reportingCurrency: config.reportingCurrency,
    cashFiles: {
      orgRoot: config.cashFiles.orgRoot,
      inv: config.cashFiles.inv,
      po: config.cashFiles.po,
      so: config.cashFiles.so,
      rem: config.cashFiles.rem,
      bank: config.cashFiles.bank,
      statementCsv: config.cashFiles.statementCsv,
      statementPdf: config.cashFiles.statementPdf,
    },
    invoiceClassify: {
      mode: config.invoiceClassify.llmReady ? "llm" : "static",
      llmEnabled: config.invoiceClassify.llmEnabled,
      llmReady: config.invoiceClassify.llmReady,
      model: config.invoiceClassify.model,
      provider: config.invoiceClassify.provider,
      staticFastPath: config.invoiceClassify.staticFastPath,
      warning: config.invoiceClassify.warning,
      seedSamples: config.invoiceSeedSamples,
    },
    peopleDocsClassify: {
      mode: config.invoiceClassify.llmReady ? "llm" : "static",
      llmEnabled: config.invoiceClassify.llmEnabled,
      llmReady: config.invoiceClassify.llmReady,
      model: config.invoiceClassify.model,
      provider: config.invoiceClassify.provider,
      warning: config.invoiceClassify.warning,
      seedSamples: config.peopleDocsSeedSamples,
      prefix: config.peopleDocsPrefix,
    },
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
  const looksLikePdf =
    key.toLowerCase().endsWith(".pdf") ||
    slice.subarray(0, 5).toString("latin1") === "%PDF-";
  // Heuristic: a NUL byte in the sampled range indicates binary content.
  const isBinary = looksLikePdf || slice.subarray(0, 8000).includes(0);
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
