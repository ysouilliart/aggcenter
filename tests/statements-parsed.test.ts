import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import type { StatementParseResult } from "@/lib/parse/pdf";
import {
  recordsFromParseFailure,
  recordsFromParseResult,
} from "@/lib/statements/fromParse";
import { LocalJsonStatementRepository } from "@/lib/statements/repository";

function parsedResult(): StatementParseResult {
  return {
    parserId: "uk-hsbc",
    parserVersion: "1.0.0",
    pageCount: 1,
    header: {
      accountName: "ACME HOLDINGS LTD",
      accountNumber: "123456-00000001",
      sortCode: "12-34-56",
      iban: "GB00TEST00000000000000",
      bic: "HBUKGB4B",
      bankName: "HSBC UK Bank PLC",
      currency: "GBP",
      accountType: "Current account",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      closingLedgerBroughtForward: 100_000,
      currentLedgerBalance: 115_000,
    },
    transactions: [
      {
        lineNumber: 1,
        page: 1,
        postDate: "2026-08-28",
        valueDate: "2026-08-28",
        trnType: "BACS",
        customerReference: "R0359X",
        bankReference: "OGILVIE FLEET LTD",
        debitAmount: 5_900,
        amount: -5_900,
        balanceAfter: 94_100,
        narrative: "R0359X, OGILVIE FLEET LTD",
      },
      {
        lineNumber: 2,
        page: 1,
        postDate: "2026-08-27",
        valueDate: "2026-08-27",
        trnType: "Tt",
        customerReference: "ADVICE CONFIRMS",
        creditAmount: 17_500,
        amount: 17_500,
        balanceAfter: 100_000,
        narrative: "/REMI//ROC/10056879539YK1 /ORDP/ACME PARENT INC",
      },
    ],
    warnings: [],
    skipped: [],
    perPageCounts: { 1: 2 },
    trace: [
      {
        level: "info",
        stage: "extract",
        message: "Using 20 text items across 1 page(s).",
      },
      {
        level: "info",
        stage: "header",
        message: "Parsed header for ACME HOLDINGS LTD.",
      },
      {
        level: "info",
        stage: "transaction",
        message: "Parsed 2 transaction(s) (2 with narrative).",
      },
      {
        level: "info",
        stage: "validate",
        message: "Running-balance continuity holds (newest-first).",
      },
    ],
  };
}

describe("recordsFromParseResult + LocalJsonStatementRepository", () => {
  it("persists header, narrative column, and parse-trace events", async () => {
    const repo = new LocalJsonStatementRepository(
      path.join(os.tmpdir(), `aggc-parsed-${Date.now()}.json`),
    );
    const { statement, transactions, job } = recordsFromParseResult(parsedResult(), {
      statementId: "STMT-HSBC-1",
      accountId: "ACC-HSBC",
      fileName: "uk-hsbc-aug.pdf",
      source: "oci",
      storageKey: "aggCenter/bankStatements/UK-HSBC/uk-hsbc-aug.pdf",
      bankCode: "UK-HSBC",
    });

    expect(statement.header?.iban).toBe("GB00TEST00000000000000");
    expect(transactions[0].narrative).toBe("R0359X, OGILVIE FLEET LTD");
    expect(transactions[0].description).toBe(transactions[0].narrative);
    expect(transactions[1].narrative).toContain("/REMI/");

    await repo.addParsedStatement(statement, transactions, job);

    const stored = await repo.getStatement("STMT-HSBC-1");
    expect(stored?.parserId).toBe("uk-hsbc");
    expect(stored?.header?.accountName).toBe("ACME HOLDINGS LTD");
    expect(stored?.header?.closingLedgerBroughtForward).toBe(100_000);

    const txns = await repo.listTransactionsForStatement("STMT-HSBC-1");
    expect(txns).toHaveLength(2);
    expect(txns[0].narrative).toBe("R0359X, OGILVIE FLEET LTD");
    expect(txns[0].trnType).toBe("BACS");
    expect(txns[0].debitAmount).toBe(5_900);
    expect(txns[1].narrative).toContain("/ORDP/ACME PARENT INC");

    const storedJob = await repo.getParseJobForStatement("STMT-HSBC-1");
    expect(storedJob?.parserId).toBe("uk-hsbc");
    expect(storedJob?.transactionCount).toBe(2);
    expect(storedJob?.events.some((e) => e.stage === "extract")).toBe(true);
    expect(storedJob?.events.some((e) => e.stage === "persist")).toBe(true);
  });

  it("records a failed parse with an error event and no transactions", async () => {
    const repo = new LocalJsonStatementRepository(
      path.join(os.tmpdir(), `aggc-parsed-fail-${Date.now()}.json`),
    );
    const { statement, transactions, job } = recordsFromParseFailure({
      statementId: "STMT-FAIL-1",
      accountId: "UNATTRIBUTED",
      fileName: "broken.pdf",
      source: "oci",
      storageKey: "aggCenter/bankStatements/UK-HSBC/broken.pdf",
      bankCode: "UK-HSBC",
      error: "No PDF parser matched this file.",
    });

    expect(statement.parseStatus).toBe("failed");
    expect(transactions).toHaveLength(0);
    expect(job.status).toBe("failed");

    await repo.addParsedStatement(statement, transactions, job);
    const stored = await repo.getParseJobForStatement("STMT-FAIL-1");
    expect(stored?.events.some((e) => e.level === "error")).toBe(true);
  });
});
