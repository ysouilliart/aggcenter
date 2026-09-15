/**
 * Core domain types for aggcenter.
 *
 * The first vertical ("cash position") models two classic operational flows:
 *   - Order to Cash (O2C):  Sales Order -> Invoice -> Customer Remittance -> Bank credit (inflow)
 *   - Procure to Pay (P2P): Purchase Order -> Vendor Bill -> Payment/Remittance -> Bank debit (outflow)
 *
 * The **bank statement is the baseline**. Reconciliation asks: do we have the
 * supporting SO / PO / remittance in the system to identify this payment?
 * Remittances that have not yet hit the statement are a cash forecast
 * (predicted in / predicted out), not anomalies.
 *
 * MONEY: every monetary field below is an integer number of **minor units
 * (cents)**. See `lib/money.ts` — integer math avoids floating-point drift in
 * reconciliation and cash-position calculations.
 */

export type Currency = "USD" | "EUR" | "GBP" | string;

export type FlowType = "O2C" | "P2P";

export interface BankAccount {
  id: string;
  name: string;
  bank: string;
  currency: Currency;
  /** Opening balance at the start of the statement period, in cents. */
  openingBalance: number;
  /** Used to match PDF statement headers to an existing account. */
  iban?: string;
  accountNumber?: string;
  bic?: string;
}

export interface BankTransaction {
  id: string;
  accountId: string;
  /** ISO date (YYYY-MM-DD) the transaction posted. */
  date: string;
  description: string;
  /** Free-text reference, often carrying a PO/SO/invoice number. */
  reference?: string;
  counterparty?: string;
  /** Signed amount in cents: positive = credit/inflow, negative = debit/outflow. */
  amount: number;
  currency: Currency;
  /** Running balance (cents) reported by the bank after this line, if provided. */
  balanceAfter?: number;
  /** Identifier of the statement this line came from. */
  statementId: string;
  /**
   * Full bank "Narrative" / details block. Own column so customer/supplier
   * matching can use it without overloading `description`.
   */
  narrative?: string;
  postDate?: string;
  valueDate?: string;
  trnType?: string;
  customerReference?: string;
  bankReference?: string;
  /** Debit magnitude in cents (positive when present). */
  debitAmount?: number;
  /** Credit magnitude in cents (positive when present). */
  creditAmount?: number;
  page?: number;
  lineNumber?: number;
  /** Bank-statement file this line was parsed from (basename or object key). */
  sourceFile?: string;
}

export interface PurchaseOrder {
  id: string;
  vendor: string;
  amount: number;
  currency: Currency;
  orderDate: string;
  dueDate: string;
  status: "open" | "billed" | "paid" | "cancelled";
  /** Supplier invoice number when this row came from an AP extract. */
  invoiceNumber?: string;
  poNumbers?: string[];
  operatingUnit?: string;
  country?: string;
  /** Extract file basename, e.g. `INV_Header_112.csv`. */
  sourceFile?: string;
  /** 1-based CSV row including the header. */
  sourceRow?: number;
}

export interface SalesOrder {
  id: string;
  customer: string;
  amount: number;
  currency: Currency;
  orderDate: string;
  dueDate: string;
  status: "open" | "invoiced" | "collected" | "cancelled";
  customerPo?: string;
  operatingUnit?: string;
  sourceFile?: string;
  sourceRow?: number;
}

export interface Remittance {
  id: string;
  /** customer = money in (O2C), vendor = money out (P2P). */
  party: "customer" | "vendor";
  name: string;
  /** Reference to the related SO/PO/invoice. */
  reference: string;
  amount: number;
  currency: Currency;
  date: string;
  remittanceNumber?: string;
  invoiceNumbers?: string[];
  operatingUnit?: string;
  status?: string;
  sourceFile?: string;
  sourceRow?: number;
}

export type ParseStatus = "parsed" | "partial" | "failed";

export type ParseTraceLevel = "info" | "warn" | "error";
export type ParseTraceStage =
  | "extract"
  | "header"
  | "transaction"
  | "validate"
  | "persist";

export interface ParseTraceEvent {
  level: ParseTraceLevel;
  stage: ParseTraceStage;
  message: string;
  page?: number;
  line?: number;
  detail?: Record<string, unknown>;
}

/** Header fields extracted from a bank statement (balances + account details). */
export interface StatementHeader {
  accountName?: string;
  accountNumber?: string;
  /** Formatted sort code when the account number is `SSSSSS-AAAAAAAA`. */
  sortCode?: string;
  bankName?: string;
  currency?: string;
  location?: string;
  bic?: string;
  iban?: string;
  accountStatus?: string;
  accountType?: string;
  periodStart?: string;
  periodEnd?: string;
  /** ISO date of the statement (footer / generation date). */
  statementDate?: string;
  /** Bank "As at" timestamp for current balances, e.g. "01 Sep 2026 10:31". */
  currentBalanceAsAt?: string;
  /** ISO date the closing balances were brought forward from. */
  broughtForwardFrom?: string;
  currentAvailableBalance?: number;
  currentLedgerBalance?: number;
  closingAvailableBroughtForward?: number;
  closingLedgerBroughtForward?: number;
  pageCount?: number;
}

export interface Statement {
  id: string;
  accountId: string;
  fileName: string;
  source: "sample" | "upload" | "oci";
  periodStart: string;
  periodEnd: string;
  transactionCount: number;
  /** Object-storage key where the raw file lives (via the StorageProvider). */
  storageKey?: string;
  uploadedAt?: string;
  bankCode?: string;
  parserId?: string;
  parserVersion?: string;
  parseStatus?: ParseStatus;
  header?: StatementHeader;
}

export interface ParseJob {
  id: string;
  statementId: string;
  storageKey?: string;
  parserId: string;
  parserVersion: string;
  status: ParseStatus;
  startedAt: string;
  finishedAt: string;
  transactionCount: number;
  warningCount: number;
  skippedNoise: number;
  skippedUnparsed: number;
  pageCount: number;
  events: ParseTraceEvent[];
}

export type MatchStatus = "matched" | "partial" | "unmatched";
export type MatchedDocType = "SO" | "PO" | "remittance";

/** Supporting SO / PO / remittance row used to identify a bank line. */
export interface SupportingDocRef {
  kind: MatchedDocType;
  id: string;
  /** Remittance number, PO number, invoice, or document id. */
  number: string;
  /** Full label for the Matched to column. */
  label: string;
  sourceFile?: string;
  sourceRow?: number;
}

/** One step in the path from source files to a reconciliation result. */
export interface AnalysisStep {
  step: number;
  label: string;
  detail: string;
  fileName?: string;
  row?: number;
  page?: number;
}

/** Winning (or last) lookup pattern used for a bank line. */
export type MatchPattern =
  | "so_po_id"
  | "po_invoice_number"
  | "remittance_invoice_ref"
  | "remittance_amount_window"
  | "remittance_amount_name"
  | "so_po_unique_amount"
  | "exhausted";

/** What was searched, how, and whether SO / remittance / PO rows were found. */
export interface MatchLookup {
  /** Bank fields used as the source of the lookup (not shown in Notes). */
  source: string;
  /** Supporting-file pool searched (not shown in Notes). */
  target: string;
  /** Lookup steps tried, with hit counts (page header lists the rules). */
  approach: string;
  /** Bank narrative / description shown on the reconciliation row. */
  narrative: string;
  soFound: boolean;
  remittanceFound: boolean;
  poFound: boolean;
  candidateCount: number;
  tokens: string[];
  /** Supporting documents found (winner first, then corroborating / candidates). */
  supportingDocs: SupportingDocRef[];
  /** Ordered path from bank file/line through extract rows to the result. */
  analysisPlan?: AnalysisStep[];
}

export interface ReconciliationResult {
  transactionId: string;
  accountId: string;
  date: string;
  amount: number;
  currency: Currency;
  flow: FlowType;
  status: MatchStatus;
  matchedType?: MatchedDocType;
  matchedId?: string;
  /** 0..1 confidence score for the match. */
  confidence: number;
  /** Signed difference between bank amount and matched document amount. */
  amountDiff: number;
  /** Human-readable diagnostic lines (narrative, found, next). */
  reasons: string[];
  matchPattern?: MatchPattern;
  lookup?: MatchLookup;
  /** Proposed next step when status is partial or unmatched. */
  remediation?: string;
}

export type AnomalySeverity = "high" | "medium" | "low";

export type AnomalyType =
  | "duplicate"
  | "amount_mismatch"
  | "unmatched_large"
  | "outlier"
  | "overdraft_risk";

export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  amount?: number;
  currency?: Currency;
  date?: string;
  relatedIds: string[];
}

export interface AccountCashPosition {
  accountId: string;
  accountName: string;
  bank: string;
  currency: Currency;
  openingBalance: number;
  inflows: number;
  outflows: number;
  closingBalance: number;
  transactionCount: number;
  /** Newest bank running balance when the statement provided one. */
  reportedClosingBalance?: number;
}

export interface CashFlowPoint {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
  /** Running balance across all accounts of the reporting currency. */
  runningBalance: number;
}

export interface CashPosition {
  currency: Currency;
  openingBalance: number;
  totalInflows: number;
  totalOutflows: number;
  netCashFlow: number;
  closingBalance: number;
  accounts: AccountCashPosition[];
  series: CashFlowPoint[];
  o2cInflows: number;
  p2pOutflows: number;
  generatedAt: string;
}

export type ForecastDirection = "in" | "out";

/** One remittance that has not yet identified a bank-statement line. */
export interface CashForecastLine {
  id: string;
  party: Remittance["party"];
  direction: ForecastDirection;
  name: string;
  reference: string;
  amount: number;
  currency: Currency;
  date: string;
  remittanceNumber?: string;
  status?: string;
}

/**
 * Predicted cash from remittances that are not on the loaded bank statement.
 * Customer remittances = predicted in; vendor remittances = predicted out.
 */
export interface CashForecast {
  currency: Currency;
  predictedInflows: number;
  predictedOutflows: number;
  netPredicted: number;
  statementClosing: number;
  projectedClosing: number;
  identifiedCount: number;
  forecastCount: number;
  inflowCount: number;
  outflowCount: number;
  lines: CashForecastLine[];
}
