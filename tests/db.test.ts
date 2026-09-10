import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { BankTransaction, Statement } from "@/lib/domain/types";
import { recordsFromParseResult } from "@/lib/statements/fromParse";
import { PostgresStatementRepository } from "@/lib/statements/repository";
import type { StatementParseResult } from "@/lib/parse/pdf";

// This integration test only runs when a Postgres DATABASE_URL is available
// (locally / in a DB-enabled CI job). It is skipped otherwise.
const run = describe.skipIf(!process.env.DATABASE_URL);

async function cleanup() {
  const { getDb } = await import("@/lib/db/client");
  const { sql } = await import("drizzle-orm");
  await getDb().execute(
    sql.raw(`
      DELETE FROM "aggc-cash"."parse_events"
        WHERE job_id LIKE 'UP-test-%' OR job_id LIKE 'STMT-HSBC-%';
      DELETE FROM "aggc-cash"."parse_jobs"
        WHERE id LIKE 'UP-test-%' OR id LIKE 'STMT-HSBC-%';
      DELETE FROM "aggc-cash"."bank_transactions"
        WHERE statement_id LIKE 'UP-test-%' OR statement_id LIKE 'STMT-HSBC-%';
      DELETE FROM "aggc-cash"."statements"
        WHERE id LIKE 'UP-test-%' OR id LIKE 'STMT-HSBC-%';
      DELETE FROM "aggc-cash"."bank_accounts"
        WHERE id LIKE 'UK-HSBC-123456-%';
    `),
  );
}

const statement: Statement = {
  id: "UP-test-1",
  accountId: "ACC-1001",
  fileName: "test.csv",
  source: "upload",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-02",
  transactionCount: 2,
  storageKey: "statements/UP-test-1-test.csv",
  uploadedAt: "2026-08-03T00:00:00.000Z",
};

const transactions: BankTransaction[] = [
  {
    id: "UP-test-1-L1",
    statementId: "UP-test-1",
    accountId: "ACC-1001",
    date: "2026-08-01",
    description: "Customer payment",
    reference: "SO-5001",
    counterparty: "Acme Corp",
    amount: 4825000, // cents
    currency: "USD",
    balanceAfter: 4825000,
  },
  {
    id: "UP-test-1-L2",
    statementId: "UP-test-1",
    accountId: "ACC-1001",
    date: "2026-08-02",
    description: "Vendor payment",
    amount: -1200000,
    currency: "USD",
  },
];

run("PostgresStatementRepository (aggc-cash schema)", () => {
  const repo = new PostgresStatementRepository();

  beforeEach(async () => {
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
  });

  it("persists an uploaded statement and its transactions", async () => {
    await repo.addUpload(statement, transactions);

    const statements = (await repo.listStatements()).filter((s) =>
      s.id.startsWith("UP-test-"),
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      id: "UP-test-1",
      accountId: "ACC-1001",
      source: "upload",
      transactionCount: 2,
      storageKey: "statements/UP-test-1-test.csv",
    });

    const txns = (await repo.listTransactions()).filter((t) =>
      t.statementId.startsWith("UP-test-"),
    );
    expect(txns).toHaveLength(2);
    const byId = Object.fromEntries(txns.map((t) => [t.id, t]));
    expect(byId["UP-test-1-L1"]).toMatchObject({
      amount: 4825000, // integer cents preserved
      reference: "SO-5001",
      counterparty: "Acme Corp",
      balanceAfter: 4825000,
    });
    expect(byId["UP-test-1-L2"].amount).toBe(-1200000);
    // Optional fields round-trip as undefined, not null.
    expect(byId["UP-test-1-L2"].reference).toBeUndefined();
  });

  it("accumulates multiple uploads", async () => {
    await repo.addUpload(statement, transactions);
    await repo.addUpload(
      { ...statement, id: "UP-test-2" },
      [{ ...transactions[0], id: "UP-test-2-L1", statementId: "UP-test-2" }],
    );
    const statements = (await repo.listStatements()).filter((s) =>
      s.id.startsWith("UP-test-"),
    );
    const txns = (await repo.listTransactions()).filter((t) =>
      t.statementId.startsWith("UP-test-"),
    );
    expect(statements).toHaveLength(2);
    expect(txns).toHaveLength(3);
  });

  it("persists HSBC header, narrative column and parse-trace events", async () => {
    const parsed: StatementParseResult = {
      parserId: "uk-hsbc",
      parserVersion: "1.0.0",
      pageCount: 1,
      header: {
        accountName: "ACME HOLDINGS LTD",
        iban: "GB00TEST00000000000000",
        currency: "GBP",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        closingLedgerBroughtForward: 100_000,
      },
      transactions: [
        {
          lineNumber: 1,
          page: 1,
          postDate: "2026-08-28",
          trnType: "BACS",
          customerReference: "R0359X",
          bankReference: "OGILVIE FLEET LTD",
          debitAmount: 5_900,
          amount: -5_900,
          balanceAfter: 94_100,
          narrative: "R0359X, OGILVIE FLEET LTD",
        },
      ],
      warnings: [],
      skipped: [],
      perPageCounts: { 1: 1 },
      trace: [
        { level: "info", stage: "header", message: "Parsed header for ACME HOLDINGS LTD." },
        { level: "info", stage: "transaction", message: "Parsed 1 transaction(s)." },
      ],
    };

    const { statement, transactions: txns, job } = recordsFromParseResult(parsed, {
      statementId: "STMT-HSBC-1",
      accountId: "ACC-HSBC",
      fileName: "uk-hsbc.pdf",
      source: "oci",
      storageKey: "aggCenter/bankStatements/UK-HSBC/uk-hsbc.pdf",
      bankCode: "UK-HSBC",
    });

    await repo.addParsedStatement(statement, txns, job);

    const stored = await repo.getStatement("STMT-HSBC-1");
    expect(stored?.header?.accountName).toBe("ACME HOLDINGS LTD");
    expect(stored?.header?.iban).toBe("GB00TEST00000000000000");
    expect(stored?.parserId).toBe("uk-hsbc");
    expect(stored?.bankCode).toBe("UK-HSBC");

    const lines = await repo.listTransactionsForStatement("STMT-HSBC-1");
    expect(lines).toHaveLength(1);
    expect(lines[0].narrative).toBe("R0359X, OGILVIE FLEET LTD");
    expect(lines[0].description).toBe("R0359X, OGILVIE FLEET LTD");
    expect(lines[0].trnType).toBe("BACS");
    expect(lines[0].debitAmount).toBe(5_900);

    const storedJob = await repo.getParseJobForStatement("STMT-HSBC-1");
    expect(storedJob?.events.map((e) => e.stage)).toEqual(
      expect.arrayContaining(["header", "transaction", "persist"]),
    );
  });

  it("upserts a bank account and keeps the original opening balance", async () => {
    await repo.upsertAccount({
      id: "UK-HSBC-123456-00000001",
      name: "ACME HOLDINGS LTD",
      bank: "HSBC UK Bank PLC",
      currency: "GBP",
      openingBalance: 100_000,
      iban: "GB00TEST00000000000000",
      accountNumber: "123456-00000001",
    });
    const second = await repo.upsertAccount({
      id: "UK-HSBC-123456-00000001",
      name: "ACME HOLDINGS LTD",
      bank: "HSBC UK Bank PLC",
      currency: "GBP",
      openingBalance: 999_999,
      iban: "GB00TEST00000000000000",
      accountNumber: "123456-00000001",
      bic: "HBUKGB4B",
    });
    expect(second.openingBalance).toBe(100_000);
    expect(second.bic).toBe("HBUKGB4B");
    const listed = (await repo.listAccounts()).filter((a) =>
      a.id.startsWith("UK-HSBC-123456-"),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0].openingBalance).toBe(100_000);

    const repaired = await repo.upsertAccount(
      {
        id: "UK-HSBC-123456-00000001",
        name: "ACME HOLDINGS LTD",
        bank: "HSBC UK Bank PLC",
        currency: "GBP",
        openingBalance: 80_000,
        iban: "GB00TEST00000000000000",
        accountNumber: "123456-00000001",
        bic: "HBUKGB4B",
      },
      { updateOpening: true },
    );
    expect(repaired.openingBalance).toBe(80_000);
  });
});
