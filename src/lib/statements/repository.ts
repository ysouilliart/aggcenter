import { promises as fs } from "fs";
import path from "path";

import type {
  BankAccount,
  BankTransaction,
  ParseJob,
  ParseTraceEvent,
  Statement,
  StatementHeader,
} from "../domain/types";
import type { BankAccountRow, BankTransactionRow, StatementRow } from "../db/schema";

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
  addParsedStatement(
    statement: Statement,
    transactions: BankTransaction[],
    job: ParseJob,
  ): Promise<void>;
  listStatements(): Promise<Statement[]>;
  listTransactions(): Promise<BankTransaction[]>;
  getStatement(id: string): Promise<Statement | undefined>;
  listTransactionsForStatement(statementId: string): Promise<BankTransaction[]>;
  getParseJobForStatement(statementId: string): Promise<ParseJob | undefined>;
  listAccounts(): Promise<BankAccount[]>;
  upsertAccount(account: BankAccount): Promise<BankAccount>;
}

// --- mapping -----------------------------------------------------------------

function headerFromRow(r: StatementRow): StatementHeader | undefined {
  const header: StatementHeader = {
    accountName: r.accountName ?? undefined,
    accountNumber: r.accountNumber ?? undefined,
    sortCode: r.sortCode ?? undefined,
    bankName: r.bankName ?? undefined,
    currency: r.currency ?? undefined,
    location: r.location ?? undefined,
    bic: r.bic ?? undefined,
    iban: r.iban ?? undefined,
    accountStatus: r.accountStatus ?? undefined,
    accountType: r.accountType ?? undefined,
    statementDate: r.statementDate ?? undefined,
    currentBalanceAsAt: r.currentBalanceAsAt ?? undefined,
    broughtForwardFrom: r.broughtForwardFrom ?? undefined,
    currentAvailableBalance: r.currentAvailableBalance ?? undefined,
    currentLedgerBalance: r.currentLedgerBalance ?? undefined,
    closingAvailableBroughtForward: r.closingAvailableBroughtForward ?? undefined,
    closingLedgerBroughtForward: r.closingLedgerBroughtForward ?? undefined,
    pageCount: r.pageCount ?? undefined,
  };
  const hasValue = Object.values(header).some((v) => v != null && v !== "");
  if (!hasValue) return undefined;
  header.periodStart = r.periodStart;
  header.periodEnd = r.periodEnd;
  return header;
}

function statementFromRow(r: StatementRow): Statement {
  return {
    id: r.id,
    accountId: r.accountId,
    fileName: r.fileName,
    source: r.source as Statement["source"],
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    transactionCount: r.transactionCount,
    storageKey: r.storageKey ?? undefined,
    uploadedAt: r.uploadedAt ?? undefined,
    bankCode: r.bankCode ?? undefined,
    parserId: r.parserId ?? undefined,
    parserVersion: r.parserVersion ?? undefined,
    parseStatus: (r.parseStatus as Statement["parseStatus"]) ?? undefined,
    header: headerFromRow(r),
  };
}

function transactionFromRow(r: BankTransactionRow): BankTransaction {
  return {
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
    narrative: r.narrative,
    postDate: r.postDate ?? undefined,
    valueDate: r.valueDate ?? undefined,
    trnType: r.trnType ?? undefined,
    customerReference: r.customerReference ?? undefined,
    bankReference: r.bankReference ?? undefined,
    debitAmount: r.debitAmount ?? undefined,
    creditAmount: r.creditAmount ?? undefined,
    page: r.pageNumber ?? undefined,
    lineNumber: r.lineNumber ?? undefined,
  };
}

function statementInsertValues(statement: Statement) {
  const h = statement.header;
  return {
    id: statement.id,
    accountId: statement.accountId,
    fileName: statement.fileName,
    source: statement.source,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    transactionCount: statement.transactionCount,
    storageKey: statement.storageKey ?? null,
    uploadedAt: statement.uploadedAt ?? null,
    bankCode: statement.bankCode ?? null,
    parserId: statement.parserId ?? null,
    parserVersion: statement.parserVersion ?? null,
    parseStatus: statement.parseStatus ?? "parsed",
    accountName: h?.accountName ?? null,
    accountNumber: h?.accountNumber ?? null,
    sortCode: h?.sortCode ?? null,
    iban: h?.iban ?? null,
    bic: h?.bic ?? null,
    bankName: h?.bankName ?? null,
    accountType: h?.accountType ?? null,
    accountStatus: h?.accountStatus ?? null,
    location: h?.location ?? null,
    currency: h?.currency ?? null,
    statementDate: h?.statementDate ?? null,
    currentBalanceAsAt: h?.currentBalanceAsAt ?? null,
    broughtForwardFrom: h?.broughtForwardFrom ?? null,
    currentAvailableBalance: h?.currentAvailableBalance ?? null,
    currentLedgerBalance: h?.currentLedgerBalance ?? null,
    closingAvailableBroughtForward: h?.closingAvailableBroughtForward ?? null,
    closingLedgerBroughtForward: h?.closingLedgerBroughtForward ?? null,
    pageCount: h?.pageCount ?? null,
  };
}

function transactionInsertValues(t: BankTransaction) {
  return {
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
    narrative: t.narrative ?? "",
    postDate: t.postDate ?? null,
    valueDate: t.valueDate ?? null,
    trnType: t.trnType ?? null,
    customerReference: t.customerReference ?? null,
    bankReference: t.bankReference ?? null,
    debitAmount: t.debitAmount ?? null,
    creditAmount: t.creditAmount ?? null,
    pageNumber: t.page ?? null,
    lineNumber: t.lineNumber ?? null,
  };
}

function accountFromRow(r: BankAccountRow): BankAccount {
  return {
    id: r.id,
    name: r.name,
    bank: r.bank,
    currency: r.currency,
    openingBalance: r.openingBalance,
    iban: r.iban ?? undefined,
    accountNumber: r.accountNumber ?? undefined,
    bic: r.bic ?? undefined,
  };
}

function accountInsertValues(account: BankAccount) {
  return {
    id: account.id,
    name: account.name,
    bank: account.bank,
    currency: account.currency,
    openingBalance: account.openingBalance,
    iban: account.iban ?? null,
    accountNumber: account.accountNumber ?? null,
    bic: account.bic ?? null,
  };
}

function mergeAccount(existing: BankAccount, incoming: BankAccount): BankAccount {
  return {
    ...existing,
    name: incoming.name || existing.name,
    bank: incoming.bank || existing.bank,
    currency: incoming.currency || existing.currency,
    iban: incoming.iban ?? existing.iban,
    accountNumber: incoming.accountNumber ?? existing.accountNumber,
    bic: incoming.bic ?? existing.bic,
    openingBalance: existing.openingBalance,
  };
}

function withPersistEvent(job: ParseJob, transactionCount: number): ParseJob {
  const persist: ParseTraceEvent = {
    level: "info",
    stage: "persist",
    message: `Wrote ${transactionCount} transaction(s) and parse trace.`,
    detail: { transactionCount },
  };
  return { ...job, events: [...job.events, persist] };
}

// --- Local JSON fallback -----------------------------------------------------

interface UploadRecord {
  statement: Statement;
  transactions: BankTransaction[];
  job?: ParseJob;
}

export class LocalJsonStatementRepository implements StatementRepository {
  readonly name = "local-json";
  private readonly file: string;
  private readonly accountsFile: string;

  constructor(file?: string) {
    this.file = file ?? path.join(process.cwd(), ".data", "uploads.json");
    this.accountsFile = this.file.replace(/\.json$/i, ".accounts.json");
  }

  private async read(): Promise<UploadRecord[]> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as UploadRecord[];
    } catch {
      return [];
    }
  }

  private async write(records: UploadRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(records, null, 2), "utf8");
  }

  async addUpload(statement: Statement, transactions: BankTransaction[]): Promise<void> {
    const records = await this.read();
    records.push({ statement, transactions });
    await this.write(records);
  }

  async addParsedStatement(
    statement: Statement,
    transactions: BankTransaction[],
    job: ParseJob,
  ): Promise<void> {
    const records = await this.read();
    records.push({
      statement,
      transactions,
      job: withPersistEvent(job, transactions.length),
    });
    await this.write(records);
  }

  async listStatements(): Promise<Statement[]> {
    return (await this.read()).map((r) => r.statement);
  }

  async listTransactions(): Promise<BankTransaction[]> {
    return (await this.read()).flatMap((r) => r.transactions);
  }

  async getStatement(id: string): Promise<Statement | undefined> {
    return (await this.read()).find((r) => r.statement.id === id)?.statement;
  }

  async listTransactionsForStatement(statementId: string): Promise<BankTransaction[]> {
    return (await this.read()).flatMap((r) =>
      r.statement.id === statementId ? r.transactions : [],
    );
  }

  async getParseJobForStatement(statementId: string): Promise<ParseJob | undefined> {
    const matches = (await this.read()).filter(
      (r) => r.job && r.statement.id === statementId,
    );
    return matches.at(-1)?.job;
  }

  async listAccounts(): Promise<BankAccount[]> {
    try {
      return JSON.parse(await fs.readFile(this.accountsFile, "utf8")) as BankAccount[];
    } catch {
      return [];
    }
  }

  async upsertAccount(account: BankAccount): Promise<BankAccount> {
    const accounts = await this.listAccounts();
    const index = accounts.findIndex((a) => a.id === account.id);
    const stored =
      index === -1 ? account : mergeAccount(accounts[index], account);
    if (index === -1) accounts.push(stored);
    else accounts[index] = stored;
    await fs.mkdir(path.dirname(this.accountsFile), { recursive: true });
    await fs.writeFile(this.accountsFile, JSON.stringify(accounts, null, 2), "utf8");
    return stored;
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
      await tx.insert(statements).values(statementInsertValues(statement));
      if (transactions.length > 0) {
        await tx
          .insert(bankTransactions)
          .values(transactions.map(transactionInsertValues));
      }
    });
  }

  async addParsedStatement(
    statement: Statement,
    transactions: BankTransaction[],
    job: ParseJob,
  ): Promise<void> {
    const { getDb } = await import("../db/client");
    const { statements, bankTransactions, parseJobs, parseEvents } =
      await import("../db/schema");
    const db = getDb();
    const persisted = withPersistEvent(job, transactions.length);

    await db.transaction(async (tx) => {
      await tx.insert(statements).values(statementInsertValues(statement));
      if (transactions.length > 0) {
        await tx
          .insert(bankTransactions)
          .values(transactions.map(transactionInsertValues));
      }
      await tx.insert(parseJobs).values({
        id: persisted.id,
        statementId: persisted.statementId,
        storageKey: persisted.storageKey ?? null,
        parserId: persisted.parserId,
        parserVersion: persisted.parserVersion,
        status: persisted.status,
        startedAt: persisted.startedAt,
        finishedAt: persisted.finishedAt,
        transactionCount: persisted.transactionCount,
        warningCount: persisted.warningCount,
        skippedNoise: persisted.skippedNoise,
        skippedUnparsed: persisted.skippedUnparsed,
        pageCount: persisted.pageCount,
      });
      if (persisted.events.length > 0) {
        await tx.insert(parseEvents).values(
          persisted.events.map((event, index) => ({
            id: `${persisted.id}-E${index + 1}`,
            jobId: persisted.id,
            seq: index + 1,
            level: event.level,
            stage: event.stage,
            message: event.message,
            page: event.page ?? null,
            line: event.line ?? null,
            detail: event.detail ? JSON.stringify(event.detail) : null,
          })),
        );
      }
    });
  }

  async listStatements(): Promise<Statement[]> {
    const { getDb } = await import("../db/client");
    const { statements } = await import("../db/schema");
    const rows = await getDb().select().from(statements);
    return rows.map(statementFromRow);
  }

  async listTransactions(): Promise<BankTransaction[]> {
    const { getDb } = await import("../db/client");
    const { bankTransactions } = await import("../db/schema");
    const rows = await getDb().select().from(bankTransactions);
    return rows.map(transactionFromRow);
  }

  async getStatement(id: string): Promise<Statement | undefined> {
    const { getDb } = await import("../db/client");
    const { statements } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await getDb().select().from(statements).where(eq(statements.id, id));
    return rows[0] ? statementFromRow(rows[0]) : undefined;
  }

  async listTransactionsForStatement(statementId: string): Promise<BankTransaction[]> {
    const { getDb } = await import("../db/client");
    const { bankTransactions } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await getDb()
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.statementId, statementId));
    return rows.map(transactionFromRow);
  }

  async getParseJobForStatement(statementId: string): Promise<ParseJob | undefined> {
    const { getDb } = await import("../db/client");
    const { parseJobs, parseEvents } = await import("../db/schema");
    const { desc, eq } = await import("drizzle-orm");
    const jobs = await getDb()
      .select()
      .from(parseJobs)
      .where(eq(parseJobs.statementId, statementId))
      .orderBy(desc(parseJobs.startedAt))
      .limit(1);
    const job = jobs[0];
    if (!job) return undefined;
    const events = await getDb()
      .select()
      .from(parseEvents)
      .where(eq(parseEvents.jobId, job.id))
      .orderBy(parseEvents.seq);
    return {
      id: job.id,
      statementId: job.statementId,
      storageKey: job.storageKey ?? undefined,
      parserId: job.parserId,
      parserVersion: job.parserVersion,
      status: job.status as ParseJob["status"],
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      transactionCount: job.transactionCount,
      warningCount: job.warningCount,
      skippedNoise: job.skippedNoise,
      skippedUnparsed: job.skippedUnparsed,
      pageCount: job.pageCount,
      events: events.map((e) => ({
        level: e.level as ParseTraceEvent["level"],
        stage: e.stage as ParseTraceEvent["stage"],
        message: e.message,
        page: e.page ?? undefined,
        line: e.line ?? undefined,
        detail: e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : undefined,
      })),
    };
  }

  async listAccounts(): Promise<BankAccount[]> {
    const { getDb } = await import("../db/client");
    const { bankAccounts } = await import("../db/schema");
    const rows = await getDb().select().from(bankAccounts);
    return rows.map(accountFromRow);
  }

  async upsertAccount(account: BankAccount): Promise<BankAccount> {
    const { getDb } = await import("../db/client");
    const { bankAccounts } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const existing = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, account.id));
    if (existing[0]) {
      const merged = mergeAccount(accountFromRow(existing[0]), account);
      await db
        .update(bankAccounts)
        .set({
          name: merged.name,
          bank: merged.bank,
          currency: merged.currency,
          iban: merged.iban ?? null,
          accountNumber: merged.accountNumber ?? null,
          bic: merged.bic ?? null,
        })
        .where(eq(bankAccounts.id, account.id));
      return merged;
    }
    await db.insert(bankAccounts).values(accountInsertValues(account));
    return account;
  }
}
