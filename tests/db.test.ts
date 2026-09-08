import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { BankTransaction, Statement } from "@/lib/domain/types";
import { PostgresStatementRepository } from "@/lib/statements/repository";

// This integration test only runs when a Postgres DATABASE_URL is available
// (locally / in a DB-enabled CI job). It is skipped otherwise.
const run = describe.skipIf(!process.env.DATABASE_URL);

async function truncate() {
  const { getDb } = await import("@/lib/db/client");
  const { sql } = await import("drizzle-orm");
  await getDb().execute(
    sql.raw('TRUNCATE "aggc-cash"."bank_transactions", "aggc-cash"."statements"'),
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
    await truncate();
  });
  afterAll(async () => {
    await truncate();
  });

  it("persists an uploaded statement and its transactions", async () => {
    await repo.addUpload(statement, transactions);

    const statements = await repo.listStatements();
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      id: "UP-test-1",
      accountId: "ACC-1001",
      source: "upload",
      transactionCount: 2,
      storageKey: "statements/UP-test-1-test.csv",
    });

    const txns = await repo.listTransactions();
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
    expect(await repo.listStatements()).toHaveLength(2);
    expect(await repo.listTransactions()).toHaveLength(3);
  });
});
