import { bigint, index, integer, pgSchema, text } from "drizzle-orm/pg-core";

/**
 * Cash persistence lives in the dedicated `aggc-cash` Postgres schema (created by
 * the migration). Monetary amounts are stored as integer minor units (cents),
 * matching the domain model. Supplier master data lives in `aggc-supplier`.
 */
export const cashSchema = pgSchema("aggc-cash");

export const bankAccounts = cashSchema.table("bank_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  bank: text("bank").notNull(),
  currency: text("currency").notNull(),
  /** cents */
  openingBalance: bigint("opening_balance", { mode: "number" }).notNull().default(0),
  iban: text("iban"),
  accountNumber: text("account_number"),
  bic: text("bic"),
});

export const statements = cashSchema.table(
  "statements",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    fileName: text("file_name").notNull(),
    source: text("source").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    storageKey: text("storage_key"),
    uploadedAt: text("uploaded_at"),
    bankCode: text("bank_code"),
    parserId: text("parser_id"),
    parserVersion: text("parser_version"),
    parseStatus: text("parse_status").notNull().default("parsed"),
    accountName: text("account_name"),
    accountNumber: text("account_number"),
    sortCode: text("sort_code"),
    iban: text("iban"),
    bic: text("bic"),
    bankName: text("bank_name"),
    accountType: text("account_type"),
    accountStatus: text("account_status"),
    location: text("location"),
    currency: text("currency"),
    statementDate: text("statement_date"),
    currentBalanceAsAt: text("current_balance_as_at"),
    broughtForwardFrom: text("brought_forward_from"),
    currentAvailableBalance: bigint("current_available_balance", { mode: "number" }),
    currentLedgerBalance: bigint("current_ledger_balance", { mode: "number" }),
    closingAvailableBroughtForward: bigint("closing_available_brought_forward", {
      mode: "number",
    }),
    closingLedgerBroughtForward: bigint("closing_ledger_brought_forward", {
      mode: "number",
    }),
    pageCount: integer("page_count"),
  },
);

export const bankTransactions = cashSchema.table(
  "bank_transactions",
  {
    id: text("id").primaryKey(),
    statementId: text("statement_id").notNull(),
    accountId: text("account_id").notNull(),
    date: text("date").notNull(),
    description: text("description").notNull().default(""),
    reference: text("reference"),
    counterparty: text("counterparty"),
    // cents
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    // cents
    balanceAfter: bigint("balance_after", { mode: "number" }),
    /**
     * Full bank Narrative block — dedicated matching column (customer/supplier).
     * Distinct from `description`, which remains the recon/cash display field.
     */
    narrative: text("narrative").notNull().default(""),
    postDate: text("post_date"),
    valueDate: text("value_date"),
    trnType: text("trn_type"),
    customerReference: text("customer_reference"),
    bankReference: text("bank_reference"),
    debitAmount: bigint("debit_amount", { mode: "number" }),
    creditAmount: bigint("credit_amount", { mode: "number" }),
    pageNumber: integer("page_number"),
    lineNumber: integer("line_number"),
  },
  (t) => [index("bank_transactions_statement_id_idx").on(t.statementId)],
);

export const parseJobs = cashSchema.table(
  "parse_jobs",
  {
    id: text("id").primaryKey(),
    statementId: text("statement_id").notNull(),
    storageKey: text("storage_key"),
    parserId: text("parser_id").notNull(),
    parserVersion: text("parser_version").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    warningCount: integer("warning_count").notNull().default(0),
    skippedNoise: integer("skipped_noise").notNull().default(0),
    skippedUnparsed: integer("skipped_unparsed").notNull().default(0),
    pageCount: integer("page_count").notNull().default(0),
  },
  (t) => [index("parse_jobs_statement_id_idx").on(t.statementId)],
);

export const parseEvents = cashSchema.table(
  "parse_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    seq: integer("seq").notNull(),
    level: text("level").notNull(),
    stage: text("stage").notNull(),
    message: text("message").notNull(),
    page: integer("page"),
    line: integer("line"),
    detail: text("detail"),
  },
  (t) => [index("parse_events_job_id_idx").on(t.jobId)],
);

export const salesOrders = cashSchema.table(
  "sales_orders",
  {
    id: text("id").primaryKey(),
    customer: text("customer").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    orderDate: text("order_date").notNull(),
    dueDate: text("due_date").notNull(),
    status: text("status").notNull(),
    customerPo: text("customer_po"),
    operatingUnit: text("operating_unit"),
    source: text("source").notNull().default("oci-uk"),
  },
);

export const purchaseOrders = cashSchema.table(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    vendor: text("vendor").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    orderDate: text("order_date").notNull(),
    dueDate: text("due_date").notNull(),
    status: text("status").notNull(),
    invoiceNumber: text("invoice_number"),
    poNumbers: text("po_numbers"),
    operatingUnit: text("operating_unit"),
    country: text("country"),
    source: text("source").notNull().default("oci-uk"),
  },
);

export const remittances = cashSchema.table(
  "remittances",
  {
    id: text("id").primaryKey(),
    party: text("party").notNull(),
    name: text("name").notNull(),
    reference: text("reference").notNull().default(""),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    date: text("date").notNull(),
    remittanceNumber: text("remittance_number"),
    invoiceNumbers: text("invoice_numbers"),
    operatingUnit: text("operating_unit"),
    status: text("status"),
    source: text("source").notNull().default("oci-uk"),
  },
  (t) => [index("remittances_currency_date_idx").on(t.currency, t.date)],
);

export const supplierSchema = pgSchema("aggc-supplier");

export const suppliers = supplierSchema.table(
  "suppliers",
  {
    id: text("id").primaryKey(),
    supplierNumber: text("supplier_number").notNull().default(""),
    name: text("name").notNull(),
    type: text("type").notNull().default(""),
    status: text("status").notNull().default("active"),
    supplierVat: text("supplier_vat").notNull().default(""),
    taxRegistrationNumber: text("tax_registration_number").notNull().default(""),
    taxpayerId: text("taxpayer_id").notNull().default(""),
    oneTime: text("one_time").notNull().default("N"),
    inactiveDate: text("inactive_date"),
    source: text("source").notNull().default("oci-supplier"),
    version: integer("version").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("suppliers_number_idx").on(t.supplierNumber)],
);

export const supplierSites = supplierSchema.table(
  "supplier_sites",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    siteCode: text("site_code").notNull().default(""),
    addressName: text("address_name").notNull().default(""),
    procurementBu: text("procurement_bu").notNull().default(""),
    operatingUnit: text("operating_unit"),
    inactiveDate: text("inactive_date"),
    paymentTerms: text("payment_terms").notNull().default(""),
    payGroup: text("pay_group").notNull().default(""),
    paymentMethod: text("payment_method").notNull().default(""),
    invoiceCurrency: text("invoice_currency").notNull().default(""),
    paymentCurrency: text("payment_currency").notNull().default(""),
    country: text("country").notNull().default(""),
    addressLine1: text("address_line_1").notNull().default(""),
    addressLine2: text("address_line_2"),
    city: text("city").notNull().default(""),
    state: text("state"),
    province: text("province"),
    county: text("county"),
    postalCode: text("postal_code").notNull().default(""),
    siteVat: text("site_vat").notNull().default(""),
    email: text("email"),
    source: text("source").notNull().default("oci-supplier"),
    version: integer("version").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("supplier_sites_supplier_id_idx").on(t.supplierId)],
);

/** Immutable snapshots of a supplier or site after each user (or ingest) change. */
export const supplierRecordVersions = supplierSchema.table(
  "supplier_record_versions",
  {
    id: text("id").primaryKey(),
    recordType: text("record_type").notNull(),
    recordId: text("record_id").notNull(),
    version: integer("version").notNull(),
    snapshot: text("snapshot").notNull(),
    createdAt: text("created_at").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason"),
  },
  (t) => [index("supplier_record_versions_record_idx").on(t.recordType, t.recordId)],
);

/** Field-level audit trail — separate from the working copy. */
export const supplierAuditEvents = supplierSchema.table(
  "supplier_audit_events",
  {
    id: text("id").primaryKey(),
    recordType: text("record_type").notNull(),
    recordId: text("record_id").notNull(),
    action: text("action").notNull(),
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    actor: text("actor").notNull(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
    version: integer("version").notNull(),
  },
  (t) => [index("supplier_audit_events_record_idx").on(t.recordType, t.recordId)],
);

export type BankAccountRow = typeof bankAccounts.$inferSelect;
export type StatementRow = typeof statements.$inferSelect;
export type BankTransactionRow = typeof bankTransactions.$inferSelect;
export type ParseJobRow = typeof parseJobs.$inferSelect;
export type ParseEventRow = typeof parseEvents.$inferSelect;
export type SalesOrderRow = typeof salesOrders.$inferSelect;
export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
export type RemittanceRow = typeof remittances.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type SupplierSiteRow = typeof supplierSites.$inferSelect;
export type SupplierVersionRow = typeof supplierRecordVersions.$inferSelect;
export type SupplierAuditRow = typeof supplierAuditEvents.$inferSelect;
