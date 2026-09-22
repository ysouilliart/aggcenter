import { bigint, boolean, index, integer, pgSchema, text } from "drizzle-orm/pg-core";

/**
 * Cash persistence lives in the dedicated `aggc-cash` Postgres schema (created by
 * the migration). Monetary amounts are stored as integer minor units (cents),
 * matching the domain model. Supplier master data lives in `aggc-supplier`.
 * Parsed AP invoices live in `aggc-invoice`.
 * People / HR agreements live in `aggc-people`.
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
    sourceFile: text("source_file"),
    sourceRow: integer("source_row"),
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
    sourceFile: text("source_file"),
    sourceRow: integer("source_row"),
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
    sourceFile: text("source_file"),
    sourceRow: integer("source_row"),
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
    orgId: text("org_id"),
    operatingUnits: text("operating_units"),
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

/** Persist VIES (or equivalent) VAT registry lookups against a site. */
export const supplierVatChecks = supplierSchema.table(
  "supplier_vat_checks",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    supplierId: text("supplier_id").notNull(),
    vatNumber: text("vat_number").notNull(),
    vatScope: text("vat_scope").notNull().default("site"),
    countryCode: text("country_code").notNull(),
    validity: text("validity").notNull(),
    registeredName: text("registered_name"),
    registeredAddress: text("registered_address"),
    requestDate: text("request_date"),
    nameMatch: text("name_match").notNull().default("unknown"),
    addressMatch: text("address_match").notNull().default("unknown"),
    message: text("message").notNull().default(""),
    actor: text("actor").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("supplier_vat_checks_site_idx").on(t.siteId)],
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
export type SupplierVatCheckRow = typeof supplierVatChecks.$inferSelect;

export const invoiceSchema = pgSchema("aggc-invoice");

export const invoices = invoiceSchema.table(
  "invoices",
  {
    id: text("id").primaryKey(),
    invoiceNumber: text("invoice_number").notNull().default(""),
    invoiceDate: text("invoice_date"),
    issueDate: text("issue_date"),
    dueDate: text("due_date"),
    paymentTerms: text("payment_terms"),
    currency: text("currency").notNull().default(""),
    subtotal: bigint("subtotal", { mode: "number" }),
    taxTotal: bigint("tax_total", { mode: "number" }),
    total: bigint("total", { mode: "number" }),
    amountDue: bigint("amount_due", { mode: "number" }),
    poNumber: text("po_number"),
    accountNumber: text("account_number"),
    referenceNumber: text("reference_number"),
    customerNumber: text("customer_number"),
    customerName: text("customer_name"),
    customerAddress: text("customer_address"),
    customerEmail: text("customer_email"),
    supplierName: text("supplier_name").notNull().default(""),
    supplierLegalName: text("supplier_legal_name"),
    supplierTaxId: text("supplier_tax_id"),
    supplierVat: text("supplier_vat"),
    supplierAddress: text("supplier_address"),
    supplierCountry: text("supplier_country"),
    supplierEmail: text("supplier_email"),
    supplierPhone: text("supplier_phone"),
    supplierWebsite: text("supplier_website"),
    notes: text("notes"),
    extraJson: text("extra_json"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    contentHash: text("content_hash").notNull().default(""),
    source: text("source").notNull().default("upload"),
    folder: text("folder").notNull().default("landing"),
    storageKey: text("storage_key"),
    originalKey: text("original_key"),
    parseStatus: text("parse_status").notNull().default("parsed"),
    parserId: text("parser_id"),
    parserVersion: text("parser_version"),
    vendor: text("vendor"),
    confidence: integer("confidence").notNull().default(0),
    pageCount: integer("page_count"),
    reviewReason: text("review_reason"),
    extractedText: text("extracted_text"),
    classifyMode: text("classify_mode"),
    classifierWarning: text("classifier_warning"),
    needsConfirm: boolean("needs_confirm").notNull().default(false),
    confirmedAt: text("confirmed_at"),
    confirmedBy: text("confirmed_by"),
    confirmAction: text("confirm_action"),
    uploadedAt: text("uploaded_at").notNull(),
    processedAt: text("processed_at"),
    archivedAt: text("archived_at"),
  },
  (t) => [
    index("invoices_folder_idx").on(t.folder),
    index("invoices_storage_key_idx").on(t.storageKey),
    index("invoices_content_hash_idx").on(t.contentHash),
  ],
);

export const invoiceLineItems = invoiceSchema.table(
  "invoice_line_items",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    description: text("description").notNull().default(""),
    quantity: text("quantity"),
    unit: text("unit"),
    unitPrice: bigint("unit_price", { mode: "number" }),
    taxRate: integer("tax_rate"),
    taxAmount: bigint("tax_amount", { mode: "number" }),
    lineTotal: bigint("line_total", { mode: "number" }),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    extraJson: text("extra_json"),
  },
  (t) => [index("invoice_line_items_invoice_id_idx").on(t.invoiceId)],
);

export const invoiceTaxLines = invoiceSchema.table(
  "invoice_tax_lines",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    label: text("label").notNull(),
    rate: integer("rate"),
    taxableAmount: bigint("taxable_amount", { mode: "number" }),
    taxAmount: bigint("tax_amount", { mode: "number" }),
  },
  (t) => [index("invoice_tax_lines_invoice_id_idx").on(t.invoiceId)],
);

export const invoiceBankDetails = invoiceSchema.table(
  "invoice_bank_details",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    bankName: text("bank_name"),
    accountName: text("account_name"),
    accountNumber: text("account_number"),
    bsb: text("bsb"),
    iban: text("iban"),
    bic: text("bic"),
    billerCode: text("biller_code"),
    bpayReference: text("bpay_reference"),
    paymentMethod: text("payment_method"),
    extraJson: text("extra_json"),
  },
  (t) => [index("invoice_bank_details_invoice_id_idx").on(t.invoiceId)],
);

export const invoiceFields = invoiceSchema.table(
  "invoice_fields",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    category: text("category").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    confidence: integer("confidence").notNull().default(0),
  },
  (t) => [index("invoice_fields_invoice_id_idx").on(t.invoiceId)],
);

export const invoiceParseJobs = invoiceSchema.table(
  "invoice_parse_jobs",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    storageKey: text("storage_key"),
    parserId: text("parser_id").notNull(),
    parserVersion: text("parser_version").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at").notNull(),
    lineItemCount: integer("line_item_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    pageCount: integer("page_count").notNull().default(0),
    confidence: integer("confidence").notNull().default(0),
  },
  (t) => [index("invoice_parse_jobs_invoice_id_idx").on(t.invoiceId)],
);

export const invoiceParseEvents = invoiceSchema.table(
  "invoice_parse_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    seq: integer("seq").notNull(),
    level: text("level").notNull(),
    stage: text("stage").notNull(),
    message: text("message").notNull(),
    page: integer("page"),
    detail: text("detail"),
  },
  (t) => [index("invoice_parse_events_job_id_idx").on(t.jobId)],
);

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceLineItemRow = typeof invoiceLineItems.$inferSelect;
export type InvoiceTaxLineRow = typeof invoiceTaxLines.$inferSelect;
export type InvoiceBankRow = typeof invoiceBankDetails.$inferSelect;
export type InvoiceFieldRow = typeof invoiceFields.$inferSelect;
export type InvoiceParseJobRow = typeof invoiceParseJobs.$inferSelect;
export type InvoiceParseEventRow = typeof invoiceParseEvents.$inferSelect;

export const invoiceConfirmEvents = invoiceSchema.table(
  "invoice_confirm_events",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    action: text("action").notNull(),
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    actor: text("actor").notNull(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("invoice_confirm_events_invoice_id_idx").on(t.invoiceId)],
);

export type InvoiceConfirmEventRow = typeof invoiceConfirmEvents.$inferSelect;

export const peopleSchema = pgSchema("aggc-people");

export const peopleDocs = peopleSchema.table(
  "people_docs",
  {
    id: text("id").primaryKey(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    contentHash: text("content_hash").notNull().default(""),
    source: text("source").notNull().default("upload"),
    folder: text("folder").notNull().default("landing"),
    storageKey: text("storage_key"),
    originalKey: text("original_key"),
    parseStatus: text("parse_status").notNull().default("parsed"),
    parserId: text("parser_id"),
    parserVersion: text("parser_version"),
    confidence: integer("confidence").notNull().default(0),
    pageCount: integer("page_count"),
    reviewReason: text("review_reason"),
    extractedText: text("extracted_text"),
    synopsis: text("synopsis"),
    llmModel: text("llm_model"),
    classifyMode: text("classify_mode"),
    classifierWarning: text("classifier_warning"),
    needsConfirm: boolean("needs_confirm").notNull().default(false),
    uploadedAt: text("uploaded_at").notNull(),
    processedAt: text("processed_at"),
    archivedAt: text("archived_at"),
    agreementId: text("agreement_id"),
    requestor: text("requestor"),
    agreementType: text("agreement_type"),
    agreementSubType: text("agreement_sub_type"),
    businessFunction: text("business_function"),
    resmedEntity: text("resmed_entity"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    autoRenew: boolean("auto_renew"),
    perpetual: boolean("perpetual"),
    fieldsJson: text("fields_json"),
    jobJson: text("job_json"),
  },
  (t) => [
    index("people_docs_folder_idx").on(t.folder),
    index("people_docs_storage_key_idx").on(t.storageKey),
    index("people_docs_content_hash_idx").on(t.contentHash),
  ],
);

export type PeopleDocRow = typeof peopleDocs.$inferSelect;
