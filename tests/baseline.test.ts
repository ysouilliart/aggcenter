import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  loadCashBaseline,
  usesBundledCashSamples,
  usesBundledReferenceSamples,
} from "@/lib/cash/baseline";
import { cashObjectPrefix } from "@/lib/cash/paths";
import type { BankAccount } from "@/lib/domain/types";
import { ingestStatements } from "@/lib/ingest";
import { LocalJsonReferenceRepository } from "@/lib/reference/repository";
import { LocalJsonStatementRepository } from "@/lib/statements/repository";
import { LocalStorageProvider } from "@/lib/storage/local";
import { buildHsbcFixturePdf } from "./helpers/hsbcPdf";

const accounts: BankAccount[] = [
  { id: "ACC-1001", name: "Operating", bank: "First National", currency: "USD", openingBalance: 0 },
];

const BANK = cashObjectPrefix("bank");

describe("bundled sample gating", () => {
  it("keeps samples when no OCI statement is present", () => {
    expect(usesBundledCashSamples([{ source: "sample" }, { source: "upload" }])).toBe(
      true,
    );
    expect(
      usesBundledReferenceSamples({
        salesOrders: 0,
        purchaseOrders: 0,
        apInvoices: 0,
        remittances: 0,
      }),
    ).toBe(true);
  });

  it("drops samples once an OCI baseline exists", () => {
    expect(usesBundledCashSamples([{ source: "oci" }])).toBe(false);
    expect(
      usesBundledReferenceSamples({
        salesOrders: 1,
        purchaseOrders: 0,
        remittances: 0,
      }),
    ).toBe(false);
  });
});

describe("loadCashBaseline", () => {
  let fixturePdf: Buffer;

  beforeAll(async () => {
    fixturePdf = await buildHsbcFixturePdf();
  });

  function fresh() {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const storage = new LocalStorageProvider(
      path.join(os.tmpdir(), `aggc-baseline-store-${stamp}`),
    );
    const statementRepo = new LocalJsonStatementRepository(
      path.join(os.tmpdir(), `aggc-baseline-uploads-${stamp}.json`),
    );
    const referenceRepo = new LocalJsonReferenceRepository(
      path.join(os.tmpdir(), `aggc-baseline-ref-${stamp}.json`),
    );
    return { storage, statementRepo, referenceRepo };
  }

  it("clears prior statement rows so one HSBC file is parsed once", async () => {
    const { storage, statementRepo, referenceRepo } = fresh();
    const firstKey = `${BANK}UK-HSBC/first.pdf`;
    const secondKey = `${BANK}UK-HSBC/current.pdf`;
    await storage.put(firstKey, fixturePdf);
    await ingestStatements({ storage, repo: statementRepo, accounts });
    await storage.put(secondKey, fixturePdf);
    await ingestStatements({ storage, repo: statementRepo, accounts });
    expect(await statementRepo.listStatements()).toHaveLength(2);

    await storage.delete(firstKey);
    const result = await loadCashBaseline({
      storage,
      statementRepo,
      referenceRepo,
    });

    const statements = await statementRepo.listStatements();
    expect(statements).toHaveLength(1);
    expect(statements[0].storageKey).toBe(secondKey);
    expect(result.reset).toBe(true);
    expect(result.statements.ingested).toHaveLength(1);
    expect(result.statements.skipped).toHaveLength(0);
    expect(await statementRepo.listAccounts()).toHaveLength(1);
  });

  it("clearAll drops statements, transactions, jobs and accounts", async () => {
    const { storage, statementRepo } = fresh();
    await storage.put(`${BANK}UK-HSBC/stmt.pdf`, fixturePdf);
    await ingestStatements({ storage, repo: statementRepo, accounts });
    expect(await statementRepo.listStatements()).toHaveLength(1);
    expect((await statementRepo.listTransactions()).length).toBeGreaterThan(0);

    await statementRepo.clearAll();
    expect(await statementRepo.listStatements()).toHaveLength(0);
    expect(await statementRepo.listTransactions()).toHaveLength(0);
    expect(await statementRepo.listAccounts()).toHaveLength(0);
  });
});
