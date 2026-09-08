import os from "os";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";

import type { BankAccount } from "@/lib/domain/types";
import { ingestStatements } from "@/lib/ingest";
import { LocalJsonStatementRepository } from "@/lib/statements/repository";
import { LocalStorageProvider } from "@/lib/storage/local";

const accounts: BankAccount[] = [
  { id: "ACC-1001", name: "Operating", bank: "First National", currency: "USD", openingBalance: 0 },
  { id: "ACC-2001", name: "EUR", bank: "Euro Bank", currency: "EUR", openingBalance: 0 },
];

const GOOD_CSV = [
  "date,description,reference,counterparty,amount,currency",
  "2026-09-02,Customer payment,SO-5007,Soylent Corp,22000.00,USD",
  "2026-09-04,Vendor payment,,Fresh Vendor LLC,-8000.00,USD",
].join("\n");

function freshDeps() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storage = new LocalStorageProvider(
    path.join(os.tmpdir(), `aggc-ingest-store-${stamp}`),
  );
  const repo = new LocalJsonStatementRepository(
    path.join(os.tmpdir(), `aggc-ingest-uploads-${stamp}.json`),
  );
  return { storage, repo };
}

describe("ingestStatements", () => {
  let storage: LocalStorageProvider;
  let repo: LocalJsonStatementRepository;

  beforeEach(() => {
    ({ storage, repo } = freshDeps());
  });

  it("ingests a statement, attributing the account from the path", async () => {
    await storage.put("inbox/ACC-1001/operating-2026-09.csv", Buffer.from(GOOD_CSV));

    const result = await ingestStatements({ storage, repo, accounts });

    expect(result.ingested).toHaveLength(1);
    expect(result.ingested[0]).toMatchObject({
      accountId: "ACC-1001",
      transactionCount: 2,
    });
    const statements = await repo.listStatements();
    expect(statements[0]).toMatchObject({
      source: "oci",
      accountId: "ACC-1001",
      storageKey: "inbox/ACC-1001/operating-2026-09.csv",
    });
    const txns = await repo.listTransactions();
    expect(txns).toHaveLength(2);
    expect(txns[0].amount).toBe(2200000); // 22000.00 in cents
  });

  it("is idempotent — a second sync skips already-ingested files", async () => {
    await storage.put("inbox/ACC-1001/a.csv", Buffer.from(GOOD_CSV));

    const first = await ingestStatements({ storage, repo, accounts });
    expect(first.ingested).toHaveLength(1);

    const second = await ingestStatements({ storage, repo, accounts });
    expect(second.ingested).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
    expect(second.skipped[0].reason).toBe("already ingested");
    expect(await repo.listStatements()).toHaveLength(1);
  });

  it("errors on an unknown account folder", async () => {
    await storage.put("inbox/ACC-9999/x.csv", Buffer.from(GOOD_CSV));
    const result = await ingestStatements({ storage, repo, accounts });
    expect(result.ingested).toHaveLength(0);
    expect(result.errors[0].error).toMatch(/unknown account/);
  });

  it("errors when there is no account subfolder", async () => {
    await storage.put("inbox/loose.csv", Buffer.from(GOOD_CSV));
    const result = await ingestStatements({ storage, repo, accounts });
    expect(result.errors[0].error).toMatch(/<accountId>/);
  });

  it("errors on a file with no parseable transactions", async () => {
    await storage.put("inbox/ACC-1001/bad.csv", Buffer.from("not,a,valid\nstatement,file,x"));
    const result = await ingestStatements({ storage, repo, accounts });
    expect(result.ingested).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it("only considers .csv files under the prefix", async () => {
    await storage.put("inbox/ACC-1001/notes.txt", Buffer.from("ignore me"));
    await storage.put("inbox/ACC-1001/a.csv", Buffer.from(GOOD_CSV));
    const result = await ingestStatements({ storage, repo, accounts });
    expect(result.ingested).toHaveLength(1);
  });
});
