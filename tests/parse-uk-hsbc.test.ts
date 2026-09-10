import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { PdfTextItem } from "@/lib/parse/pdf";
import {
  looksLikeUkHsbc,
  parseUkAmount,
  parseUkDate,
  parseUkHsbcFromItems,
  parseUkHsbcPdf,
  toBankTransactions,
  UK_HSBC_PARSER_ID,
  ukHsbcParser,
} from "@/lib/parse/pdf";
import {
  buildHsbcFixturePdf,
  defaultTransactions,
} from "./helpers/hsbcPdf";

const LIVE_PDF =
  process.env.HSBC_PDF_PATH ||
  (existsSync("/tmp/hsbc-pdf/statement.pdf")
    ? "/tmp/hsbc-pdf/statement.pdf"
    : "");

function colHeaders(page = 1, y = 354): PdfTextItem[] {
  const cols: [string, number][] = [
    ["Bank reference", 31.2],
    ["Customer reference", 129.2],
    ["TRN type", 227.2],
    ["Value date", 325.2],
    ["Credit amount", 423.2],
    ["Debit amount", 521.2],
    ["Balance", 619.2],
    ["Post date", 717.2],
  ];
  return cols.map(([str, x]) => ({
    page,
    x,
    y,
    width: 40,
    height: 8,
    str,
  }));
}

function item(
  partial: Omit<PdfTextItem, "width" | "height"> & { width?: number; height?: number },
): PdfTextItem {
  return { width: 40, height: 8, ...partial };
}

describe("parseUkDate / parseUkAmount", () => {
  it("parses HSBC dates and grouped amounts into ISO / cents", () => {
    expect(parseUkDate("28 Aug 2026")).toBe("2026-08-28");
    expect(parseUkDate("03 Aug 2026")).toBe("2026-08-03");
    expect(parseUkDate("nope")).toBeNull();
    expect(parseUkAmount("4,472,463.35")).toBe(447_246_335);
    expect(parseUkAmount("-31,666.62")).toBe(-3_166_662);
    expect(parseUkAmount("")).toBeNull();
  });
});

describe("parseUkHsbcPdf (synthetic fixture)", () => {
  it("extracts header fields, credits, debits, wrapped refs and overlay noise", async () => {
    const pdf = await buildHsbcFixturePdf();
    const result = await parseUkHsbcPdf(pdf, { fileName: "UK-HSBC-fixture.pdf" });

    expect(result.parserId).toBe(UK_HSBC_PARSER_ID);
    expect(result.header).toMatchObject({
      accountName: "ACME HOLDINGS LTD",
      accountNumber: "123456-00000001",
      sortCode: "12-34-56",
      bankName: "HSBC UK Bank PLC",
      currency: "GBP",
      location: "United Kingdom",
      bic: "HBUKGB4B",
      iban: "GB00HBUK12345600000001",
      accountStatus: "Active",
      accountType: "Current account",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      statementDate: "2026-09-01",
      broughtForwardFrom: "2026-08-31",
      currentAvailableBalance: 115_000,
      currentLedgerBalance: 115_000,
      closingAvailableBroughtForward: 100_000,
      closingLedgerBroughtForward: 100_000,
    });

    expect(result.transactions).toHaveLength(3);
    expect(result.skipped.every((s) => s.reason === "noise")).toBe(true);

    const [creditIn, swift, debit] = result.transactions;
    expect(creditIn).toMatchObject({
      postDate: "2026-08-28",
      valueDate: "2026-08-28",
      trnType: "FBP",
      customerReference: "2000838228",
      bankReference: "06709260106215ASAH9420260828826402080",
      creditAmount: 10_000,
      amount: 10_000,
      balanceAfter: 100_000,
    });
    expect(creditIn.narrative).toContain("/DbAcct/");

    expect(swift.trnType).toBe("Tt");
    expect(swift.creditAmount).toBe(17_500);
    expect(swift.narrative).toContain("/REMI/");
    expect(swift.narrative).toContain("SPECTRUM CENT");

    expect(debit).toMatchObject({
      trnType: "Tt",
      debitAmount: 5_000,
      amount: -5_000,
      balanceAfter: 72_500,
    });

    expect(result.header.closingLedgerBroughtForward).toBe(
      result.transactions[0].balanceAfter,
    );
    expect(result.warnings.filter((w) => w.includes("running balance"))).toHaveLength(
      0,
    );
    expect(result.trace.some((e) => e.stage === "validate" && e.level === "info")).toBe(
      true,
    );

    const mapped = toBankTransactions(result, {
      statementId: "STMT-1",
      accountId: "ACC-HSBC",
    });
    expect(mapped[0]).toMatchObject({
      id: "STMT-1-L1",
      accountId: "ACC-HSBC",
      date: "2026-08-28",
      amount: 10_000,
      currency: "GBP",
      statementId: "STMT-1",
    });
    expect(mapped[2].amount).toBe(-5_000);
  });

  it("attaches a narrative that overflows onto the next page", async () => {
    const txns = defaultTransactions();
    const pdf = await buildHsbcFixturePdf({
      transactions: txns,
      page2Narrative: "OVERFLOW CONTINUATION FOR LAST TXN /OBK/AIBKIE2DXXX",
    });
    const result = await parseUkHsbcPdf(pdf);
    expect(result.pageCount).toBe(2);
    const last = result.transactions[result.transactions.length - 1];
    expect(last.narrative).toContain("OVERFLOW CONTINUATION FOR LAST TXN");
  });

  it("reports a missing column-header row on a non-statement PDF", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Hello", { x: 50, y: 500, size: 12, font });
    const pdf = Buffer.from(await doc.save());
    const result = await parseUkHsbcPdf(pdf);
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings.some((w) => /column-header/i.test(w))).toBe(true);
  });
});

describe("looksLikeUkHsbc / parser registry", () => {
  it("matches by file name or by HSBC header text", () => {
    expect(
      looksLikeUkHsbc({ fileName: "UK GBP HSBC CURRENT.pdf", items: [] }),
    ).toBe(true);
    expect(looksLikeUkHsbc({ fileName: "notes.txt", items: [] })).toBe(false);
    expect(
      looksLikeUkHsbc({
        items: [
          item({ page: 1, x: 10, y: 10, str: "Statement details" }),
          item({ page: 1, x: 20, y: 10, str: "TRN type" }),
          item({ page: 1, x: 30, y: 10, str: "Bank reference" }),
        ],
      }),
    ).toBe(true);
    expect(ukHsbcParser.id).toBe("uk-hsbc");
    expect(ukHsbcParser.canParse({ fileName: "x-hsbc.pdf", items: [] })).toBe(true);
  });
});

describe("parseUkHsbcFromItems", () => {
  it("records an orphan narrative and a continuity break", () => {
    const items: PdfTextItem[] = [
      ...colHeaders(),
      item({ page: 1, x: 31.9, y: 340, str: "Narrative" }),
      item({ page: 1, x: 81.6, y: 340, str: "ORPHAN BODY" }),
      item({ page: 1, x: 31.2, y: 300, str: "AAA" }),
      item({ page: 1, x: 129.2, y: 300, str: "CUST" }),
      item({ page: 1, x: 227.2, y: 300, str: "BACS" }),
      item({ page: 1, x: 325.2, y: 300, str: "28 Aug 2026" }),
      item({ page: 1, x: 484.2, y: 300, width: 30, str: "10.00" }),
      item({ page: 1, x: 670, y: 300, width: 40, str: "100.00" }),
      item({ page: 1, x: 717.2, y: 300, str: "28 Aug 2026" }),
      item({ page: 1, x: 31.2, y: 250, str: "BBB" }),
      item({ page: 1, x: 129.2, y: 250, str: "CUST2" }),
      item({ page: 1, x: 227.2, y: 250, str: "BACS" }),
      item({ page: 1, x: 325.2, y: 250, str: "27 Aug 2026" }),
      item({ page: 1, x: 484.2, y: 250, width: 30, str: "5.00" }),
      item({ page: 1, x: 670, y: 250, width: 40, str: "50.00" }),
      item({ page: 1, x: 717.2, y: 250, str: "27 Aug 2026" }),
    ];

    const result = parseUkHsbcFromItems(items, 1);
    expect(result.transactions).toHaveLength(2);
    expect(result.warnings.some((w) => /Orphan narrative/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /running balance/.test(w))).toBe(true);
    // 50 + 10 = 60, but first balance is 100 → break
    expect(result.transactions[0].balanceAfter).toBe(10_000);
    expect(result.transactions[1].balanceAfter).toBe(5_000);
  });

  it("records leftover rows that are neither a transaction nor narrative", () => {
    const items: PdfTextItem[] = [
      ...colHeaders(),
      item({ page: 1, x: 400, y: 200, str: "STRAY ANNOTATION" }),
    ];
    const result = parseUkHsbcFromItems(items, 1);
    expect(result.skipped.some((s) => s.reason === "unparsed")).toBe(true);
    expect(result.warnings.some((w) => /could not be parsed/.test(w))).toBe(true);
  });

  it("skips overlay rows that repeat the same token in every column", () => {
    const overlay = "SA51260106290760";
    const items: PdfTextItem[] = [
      ...colHeaders(),
      item({ page: 1, x: 31.2, y: 300, str: "REF1" }),
      item({ page: 1, x: 129.2, y: 300, str: "CUST" }),
      item({ page: 1, x: 227.2, y: 300, str: "BACS" }),
      item({ page: 1, x: 325.2, y: 300, str: "28 Aug 2026" }),
      item({ page: 1, x: 484.2, y: 300, width: 30, str: "10.00" }),
      item({ page: 1, x: 670, y: 300, width: 40, str: "10.00" }),
      item({ page: 1, x: 717.2, y: 300, str: "28 Aug 2026" }),
      ...colHeaders(1, 280).map((c) => ({ ...c, y: 280, str: overlay })),
    ];
    const result = parseUkHsbcFromItems(items, 1);
    expect(result.transactions).toHaveLength(1);
    expect(result.skipped.some((s) => s.reason === "noise")).toBe(true);
  });
});

describe.skipIf(!LIVE_PDF)("live HSBC UK statement PDF", () => {
  it("parses every line with continuous running balances", async () => {
    const buf = await readFile(LIVE_PDF);
    const result = await ukHsbcParser.parse(buf, { fileName: LIVE_PDF });

    expect(result.pageCount).toBe(56);
    expect(result.transactions.length).toBe(608);
    expect(result.header.currency).toBe("GBP");
    expect(result.header.periodStart).toBe("2026-08-01");
    expect(result.header.periodEnd).toBe("2026-08-31");
    expect(result.header.closingLedgerBroughtForward).toBe(
      result.transactions[0].balanceAfter,
    );
    expect(result.header.closingAvailableBroughtForward).toBe(
      result.header.closingLedgerBroughtForward,
    );
    expect(result.warnings.filter((w) => w.includes("running balance"))).toEqual([]);
    expect(result.skipped.every((s) => s.reason === "noise")).toBe(true);

    const types = new Set(result.transactions.map((t) => t.trnType));
    expect(types.has("BACS")).toBe(true);
    expect(types.has("FBP")).toBe(true);
    expect(types.has("Tt")).toBe(true);

    const debit = result.transactions.find((t) => t.debitAmount);
    const credit = result.transactions.find((t) => t.creditAmount);
    expect(debit?.amount).toBeLessThan(0);
    expect(credit?.amount).toBeGreaterThan(0);

    const wrapped = result.transactions.find((t) => (t.narrative ?? "").length > 160);
    expect(wrapped).toBeTruthy();
  });
});
