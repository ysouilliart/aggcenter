import os from "os";
import path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { BankAccount } from "@/lib/domain/types";
import { ingestStatements } from "@/lib/ingest";
import {
  accountFromHeader,
  accountIdFromHeader,
  matchAccount,
} from "@/lib/ingest/accounts";
import { LocalJsonStatementRepository } from "@/lib/statements/repository";
import { LocalStorageProvider } from "@/lib/storage/local";
import { buildHsbcFixturePdf } from "./helpers/hsbcPdf";

const accounts: BankAccount[] = [
  { id: "ACC-1001", name: "Operating", bank: "First National", currency: "USD", openingBalance: 0 },
  { id: "ACC-2001", name: "EUR", bank: "Euro Bank", currency: "EUR", openingBalance: 0 },
];

const GOOD_CSV = [
  "date,description,reference,counterparty,amount,currency",
  "2026-09-02,Customer payment,SO-5007,Soylent Corp,22000.00,USD",
  "2026-09-04,Vendor payment,,Fresh Vendor LLC,-8000.00,USD",
].join("\n");

const PDF_KEY = "aggCenter/bankStatements/UK-HSBC/acme-aug-26.pdf";

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

async function unrelatedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Not a bank statement", { x: 40, y: 100, size: 12, font });
  return Buffer.from(await doc.save());
}

describe("account identity from statement header", () => {
  it("builds a stable id from the account number", () => {
    expect(
      accountIdFromHeader({ accountNumber: "123456-00000001" }),
    ).toBe("UK-HSBC-123456-00000001");
  });

  it("matches by IBAN / account number ignoring spaces and hyphens", () => {
    const existing: BankAccount = {
      id: "UK-HSBC-123456-00000001",
      name: "ACME HOLDINGS LTD",
      bank: "HSBC UK Bank PLC",
      currency: "GBP",
      openingBalance: 100_000,
      iban: "GB00 HBUK 123456 00000001",
      accountNumber: "123456-00000001",
    };
    expect(
      matchAccount([existing], { iban: "GB00HBUK12345600000001" })?.id,
    ).toBe(existing.id);
    expect(
      matchAccount([existing], { accountNumber: "12345600000001" })?.id,
    ).toBe(existing.id);
  });

  it("creates an account from header fields", () => {
    const created = accountFromHeader({
      accountName: "ACME HOLDINGS LTD",
      accountNumber: "123456-00000001",
      bankName: "HSBC UK Bank PLC",
      currency: "GBP",
      iban: "GB00HBUK12345600000001",
      closingLedgerBroughtForward: 100_000,
    });
    expect(created).toMatchObject({
      id: "UK-HSBC-123456-00000001",
      name: "ACME HOLDINGS LTD",
      openingBalance: 100_000,
      currency: "GBP",
    });
  });
});

describe("ingestStatements", () => {
  let storage: LocalStorageProvider;
  let repo: LocalJsonStatementRepository;
  let fixturePdf: Buffer;

  beforeAll(async () => {
    fixturePdf = await buildHsbcFixturePdf();
  });

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

  it("ignores non-statement files under the prefix", async () => {
    await storage.put("inbox/ACC-1001/notes.txt", Buffer.from("ignore me"));
    await storage.put("inbox/ACC-1001/a.csv", Buffer.from(GOOD_CSV));
    const result = await ingestStatements({ storage, repo, accounts });
    expect(result.ingested).toHaveLength(1);
  });

  it("ingests a UK-HSBC PDF and upserts the account from the header", async () => {
    await storage.put(PDF_KEY, fixturePdf);

    const result = await ingestStatements({ storage, repo, accounts });

    expect(result.errors).toEqual([]);
    expect(result.ingested).toHaveLength(1);
    expect(result.ingested[0]).toMatchObject({
      accountId: "UK-HSBC-123456-00000001",
      transactionCount: 4,
      parseStatus: "parsed",
    });

    const persistedAccounts = await repo.listAccounts();
    expect(persistedAccounts).toHaveLength(1);
    expect(persistedAccounts[0]).toMatchObject({
      id: "UK-HSBC-123456-00000001",
      name: "ACME HOLDINGS LTD",
      bank: "HSBC UK Bank PLC",
      currency: "GBP",
      iban: "GB00HBUK12345600000001",
      accountNumber: "123456-00000001",
    });

    const statements = await repo.listStatements();
    expect(statements[0]).toMatchObject({
      source: "oci",
      bankCode: "UK-HSBC",
      parserId: "uk-hsbc",
      parseStatus: "parsed",
      storageKey: PDF_KEY,
      accountId: "UK-HSBC-123456-00000001",
    });

    const txns = await repo.listTransactions();
    expect(txns).toHaveLength(4);
    expect(txns.every((t) => t.narrative && t.narrative.length > 0)).toBe(true);

    const job = await repo.getParseJobForStatement(statements[0].id);
    expect(job?.events.some((e) => e.stage === "header")).toBe(true);
    expect(job?.events.some((e) => e.stage === "persist")).toBe(true);
  });

  it("reuses a previously upserted account for a later statement of the same IBAN", async () => {
    await storage.put(PDF_KEY, fixturePdf);
    await ingestStatements({ storage, repo, accounts });

    await repo.upsertAccount({
      id: "UK-HSBC-123456-00000001",
      name: "ACME HOLDINGS LTD",
      bank: "HSBC UK Bank PLC",
      currency: "GBP",
      openingBalance: 100_000,
      iban: "GB00HBUK12345600000001",
      accountNumber: "123456-00000001",
    });

    const laterKey = "aggCenter/bankStatements/UK-HSBC/acme-sep-26.pdf";
    await storage.put(laterKey, fixturePdf);
    const result = await ingestStatements({ storage, repo, accounts });

    expect(result.ingested).toHaveLength(1);
    expect(result.ingested[0].accountId).toBe("UK-HSBC-123456-00000001");
    expect(await repo.listAccounts()).toHaveLength(1);
    expect((await repo.listAccounts())[0].openingBalance).toBe(100_000);
  });

  it("is idempotent for PDFs keyed by storage path", async () => {
    await storage.put(PDF_KEY, fixturePdf);
    const first = await ingestStatements({ storage, repo, accounts });
    expect(first.ingested).toHaveLength(1);
    const second = await ingestStatements({ storage, repo, accounts });
    expect(second.ingested).toHaveLength(0);
    expect(second.skipped[0]).toMatchObject({ key: PDF_KEY, reason: "already ingested" });
    expect(await repo.listStatements()).toHaveLength(1);
  });

  it("persists a failed PDF parse so the reason is available later", async () => {
    const key = "aggCenter/bankStatements/UK-OTHER/not-a-statement.pdf";
    await storage.put(key, await unrelatedPdf());

    const result = await ingestStatements({ storage, repo, accounts });
    expect(result.ingested).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/No PDF parser/);
    expect(result.errors[0].statementId).toBeTruthy();

    const statements = await repo.listStatements();
    expect(statements).toHaveLength(1);
    expect(statements[0].parseStatus).toBe("failed");
    expect(statements[0].transactionCount).toBe(0);
    expect(statements[0].storageKey).toBe(key);

    const job = await repo.getParseJobForStatement(statements[0].id);
    expect(job?.status).toBe("failed");
    expect(job?.events.some((e) => e.level === "error")).toBe(true);

    const retry = await ingestStatements({ storage, repo, accounts });
    expect(retry.skipped).toHaveLength(1);
    expect(await repo.listStatements()).toHaveLength(1);
  });

  it("persists a thrown PDF parse as a failed statement", async () => {
    const key = "aggCenter/bankStatements/UK-HSBC/corrupt.pdf";
    await storage.put(key, Buffer.from("this is not a pdf"));

    const result = await ingestStatements({ storage, repo, accounts });
    expect(result.ingested).toHaveLength(0);
    expect(result.errors[0].statementId).toBeTruthy();
    const stored = (await repo.listStatements())[0];
    expect(stored.parseStatus).toBe("failed");
    expect(stored.accountId).toBe("UNATTRIBUTED");
  });

  it("ingests CSV inbox files and HSBC PDFs in one default sync", async () => {
    await storage.put("inbox/ACC-1001/operating-2026-09.csv", Buffer.from(GOOD_CSV));
    await storage.put(PDF_KEY, fixturePdf);

    const result = await ingestStatements({ storage, repo, accounts });
    expect(result.prefix).toContain("inbox/");
    expect(result.prefix).toContain("aggCenter/bankStatements/");
    expect(result.ingested).toHaveLength(2);
    expect(result.ingested.map((r) => r.accountId).sort()).toEqual([
      "ACC-1001",
      "UK-HSBC-123456-00000001",
    ]);
  });
});
