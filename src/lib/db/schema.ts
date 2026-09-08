import { bigint, integer, pgSchema, text } from "drizzle-orm/pg-core";

/**
 * All persistence lives in the dedicated `aggc-cash` Postgres schema (created by
 * the migration). Monetary amounts are stored as integer minor units (cents),
 * matching the domain model.
 */
export const cashSchema = pgSchema("aggc-cash");

export const statements = cashSchema.table("statements", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  fileName: text("file_name").notNull(),
  source: text("source").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  transactionCount: integer("transaction_count").notNull(),
  storageKey: text("storage_key"),
  uploadedAt: text("uploaded_at"),
});

export const bankTransactions = cashSchema.table("bank_transactions", {
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
});

export type StatementRow = typeof statements.$inferSelect;
export type BankTransactionRow = typeof bankTransactions.$inferSelect;
