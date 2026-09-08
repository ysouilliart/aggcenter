import { promises as fs } from "fs";
import path from "path";

import type { BankTransaction, Statement } from "../domain/types";

/**
 * Persistence for uploaded statements and their parsed transactions.
 *
 * Two implementations:
 *  - PostgresStatementRepository: Drizzle over Postgres (Neon in production),
 *    data stored in the `aggc-cash` schema.
 *  - LocalJsonStatementRepository: a `.data/uploads.json` fallback so the app
 *    runs with no database configured (dev / demo).
 *
 * Bundled sample statements are not stored here; only user uploads are persisted.
 */
export interface StatementRepository {
  readonly name: string;
  addUpload(statement: Statement, transactions: BankTransaction[]): Promise<void>;
  listStatements(): Promise<Statement[]>;
  listTransactions(): Promise<BankTransaction[]>;
}

// --- Local JSON fallback -----------------------------------------------------

interface UploadRecord {
  statement: Statement;
  transactions: BankTransaction[];
}

export class LocalJsonStatementRepository implements StatementRepository {
  readonly name = "local-json";
  private readonly file: string;

  constructor(file?: string) {
    this.file = file ?? path.join(process.cwd(), ".data", "uploads.json");
  }

  private async read(): Promise<UploadRecord[]> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as UploadRecord[];
    } catch {
      return [];
    }
  }

  async addUpload(statement: Statement, transactions: BankTransaction[]): Promise<void> {
    const records = await this.read();
    records.push({ statement, transactions });
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(records, null, 2), "utf8");
  }

  async listStatements(): Promise<Statement[]> {
    return (await this.read()).map((r) => r.statement);
  }

  async listTransactions(): Promise<BankTransaction[]> {
    return (await this.read()).flatMap((r) => r.transactions);
  }
}

// --- Postgres (Drizzle) ------------------------------------------------------

export class PostgresStatementRepository implements StatementRepository {
  readonly name = "postgres";

  async addUpload(statement: Statement, transactions: BankTransaction[]): Promise<void> {
    const { getDb } = await import("../db/client");
    const { statements, bankTransactions } = await import("../db/schema");
    const db = getDb();

    await db.transaction(async (tx) => {
      await tx.insert(statements).values({
        id: statement.id,
        accountId: statement.accountId,
        fileName: statement.fileName,
        source: statement.source,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        transactionCount: statement.transactionCount,
        storageKey: statement.storageKey ?? null,
        uploadedAt: statement.uploadedAt ?? null,
      });
      if (transactions.length > 0) {
        await tx.insert(bankTransactions).values(
          transactions.map((t) => ({
            id: t.id,
            statementId: t.statementId,
            accountId: t.accountId,
            date: t.date,
            description: t.description ?? "",
            reference: t.reference ?? null,
            counterparty: t.counterparty ?? null,
            amount: t.amount,
            currency: t.currency,
            balanceAfter: t.balanceAfter ?? null,
          })),
        );
      }
    });
  }

  async listStatements(): Promise<Statement[]> {
    const { getDb } = await import("../db/client");
    const { statements } = await import("../db/schema");
    const rows = await getDb().select().from(statements);
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      fileName: r.fileName,
      source: r.source as Statement["source"],
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      transactionCount: r.transactionCount,
      storageKey: r.storageKey ?? undefined,
      uploadedAt: r.uploadedAt ?? undefined,
    }));
  }

  async listTransactions(): Promise<BankTransaction[]> {
    const { getDb } = await import("../db/client");
    const { bankTransactions } = await import("../db/schema");
    const rows = await getDb().select().from(bankTransactions);
    return rows.map((r) => ({
      id: r.id,
      statementId: r.statementId,
      accountId: r.accountId,
      date: r.date,
      description: r.description,
      reference: r.reference ?? undefined,
      counterparty: r.counterparty ?? undefined,
      amount: r.amount,
      currency: r.currency,
      balanceAfter: r.balanceAfter ?? undefined,
    }));
  }
}
