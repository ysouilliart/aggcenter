import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

import { currencyFromSymbol, detectCurrency, firstMoney, parseMoney } from "@/lib/parse/invoice/amounts";
import { classifyInvoice, parseInvoiceDocument } from "@/lib/parse/invoice";
import { firstDate, parseInvoiceDate } from "@/lib/parse/invoice/dates";
import { collapseSpacedLetters, linesFromPdfItems, searchText, uniquePush, valueAfterLabel } from "@/lib/parse/invoice/text";
import type { PdfTextItem } from "@/lib/parse/pdf/types";

const LANDING = path.join(process.cwd(), "data/sample/invoices/landing");

describe("invoice money / dates", () => {
  it("parses credit, parentheses and currency detection", () => {
    expect(parseMoney("$302.06")).toBe(30206);
    expect(parseMoney("17.95 CR")).toBe(-1795);
    expect(parseMoney("(12.50)")).toBe(-1250);
    expect(parseMoney("not-a-price")).toBeNull();
    expect(parseMoney("1000.00")).toBe(100000);
    expect(firstMoney("total: 1100.00")).toBe(110000);
    expect(firstMoney("Fee $12.00 extra $3.00")).toBe(1200);
    expect(detectCurrency("TOTAL (USD) $189.00")).toBe("USD");
    expect(detectCurrency("Total Amount (AUD) 18.67")).toBe("AUD");
    expect(detectCurrency("Amount €10")).toBe("EUR");
    expect(detectCurrency("Amount £10")).toBe("GBP");
    expect(detectCurrency("Only $10")).toBe("AUD");
    expect(currencyFromSymbol("£12")).toBe("GBP");
    expect(currencyFromSymbol("€9")).toBe("EUR");
    expect(currencyFromSymbol("$1")).toBe("AUD");
    expect(currencyFromSymbol("none")).toBeUndefined();
    expect(parseMoney("-")).toBeNull();
    expect(detectCurrency("currency: NZD")).toBe("NZD");
    expect(detectCurrency("total (EUR) 9")).toBe("EUR");
  });

  it("parses AU / ISO / named-month dates", () => {
    expect(parseInvoiceDate("2019-09-01")).toBe("2019-09-01");
    expect(parseInvoiceDate("2026/05/29")).toBe("2026-05-29");
    expect(parseInvoiceDate("5 Sep 18")).toBe("2018-09-05");
    expect(parseInvoiceDate("05 / Sep / 18")).toBe("2018-09-05");
    expect(parseInvoiceDate("22 Aug 2018")).toBe("2018-08-22");
    expect(parseInvoiceDate("July 4 1976")).toBe("1976-07-04");
    expect(parseInvoiceDate("13/08/2026")).toBe("2026-08-13");
    expect(parseInvoiceDate("nope")).toBeNull();
    expect(parseInvoiceDate("32/13/2026")).toBeNull();
    expect(parseInvoiceDate("")).toBeNull();
    expect(firstDate("Issued 22 Aug 18 due later")).toBe("2018-08-22");
  });

  it("repairs spaced PDF glyphs without merging Pty Ltd", () => {
    expect(collapseSpacedLetters("Tax I nvo i ce")).toBe("Tax Invoice");
    expect(collapseSpacedLetters("Tesla Motors Australia Pty Ltd")).toBe(
      "Tesla Motors Australia Pty Ltd",
    );
  });

  it("joins neighbouring PDF glyphs and reads a label", () => {
    const items: PdfTextItem[] = [
      { page: 1, x: 10, y: 100, width: 20, height: 10, str: "Invoice" },
      { page: 1, x: 40, y: 100, width: 24, height: 10, str: "Number" },
      { page: 1, x: 90, y: 100, width: 20, height: 10, str: "ABC-1" },
    ];
    const lines = linesFromPdfItems(items, 2);
    expect(lines[0]).toContain("Invoice");
    expect(valueAfterLabel(["Due Date", "", "17/08/2026"], /Due Date/i, /\d{2}\/\d{2}\/\d{4}/)).toBe(
      "17/08/2026",
    );
    expect(valueAfterLabel(["nope"], /Due Date/i, /\d+/)).toBeUndefined();
    expect(searchText("hello", /xyz/)).toBeUndefined();
    const acc: string[] = [];
    uniquePush(acc, undefined);
    uniquePush(acc, "  ");
    uniquePush(acc, "a");
    uniquePush(acc, "a");
    expect(acc).toEqual(["a"]);
  });
});

describe("invoice PDF fixtures", () => {
  it("classifies the Hotjar tax invoice", async () => {
    const buf = await readFile(path.join(LANDING, "Hotjar_invoice.pdf"));
    const parsed = await parseInvoiceDocument(buf, { fileName: "Hotjar_invoice.pdf" });
    expect(parsed.vendor).toBe("hotjar");
    expect(parsed.status).toBe("parsed");
    expect(parsed.header.invoiceNumber).toBe("737749");
    expect(parsed.header.invoiceDate).toBe("2019-09-01");
    expect(parsed.header.supplierName).toBe("Hotjar Ltd");
    expect(parsed.header.supplierVat).toBe("MT21846014");
    expect(parsed.header.customerName).toMatch(/Qantas/);
    expect(parsed.header.currency).toBe("USD");
    expect(parsed.header.total).toBe(18900);
    expect(parsed.lineItems).toHaveLength(2);
    expect(parsed.taxLines[0]?.rate).toBe(0);
  });

  it("classifies Tesla charging invoices", async () => {
    const buf = await readFile(path.join(LANDING, "tesla_invoice_eastlakes.pdf"));
    const parsed = await parseInvoiceDocument(buf, { fileName: "tesla_invoice_eastlakes.pdf" });
    expect(parsed.vendor).toBe("tesla");
    expect(parsed.header.invoiceNumber).toBe("2010P0004108357");
    expect(parsed.header.invoiceDate).toBe("2026-05-29");
    expect(parsed.header.supplierTaxId).toBe("68142889816");
    expect(parsed.header.customerName).toMatch(/Souilliart/);
    expect(parsed.header.total).toBe(1867);
    expect(parsed.lineItems[0]?.description).toBe("Energy fee");
    expect(parsed.fields.some((f) => f.key === "vehicleIdentificationNumber")).toBe(true);
  });

  it("classifies an Origin Energy electricity bill", async () => {
    const buf = await readFile(path.join(LANDING, "Origin_electricity_invoice.pdf"));
    const parsed = await parseInvoiceDocument(buf, { fileName: "Origin_electricity_invoice.pdf" });
    expect(parsed.vendor).toBe("origin");
    expect(parsed.header.invoiceNumber).toBe("100007075508");
    expect(parsed.header.accountNumber).toBe("200032868685");
    expect(parsed.header.invoiceDate).toBe("2018-08-22");
    expect(parsed.header.dueDate).toBe("2018-09-05");
    expect(parsed.header.amountDue).toBe(30206);
    expect(parsed.header.supplierName).toMatch(/Origin Energy/);
    expect(parsed.bank?.billerCode).toBe("130112");
    expect(parsed.bank?.paymentMethod).toBe("BPAY");
    expect(parsed.lineItems.length).toBeGreaterThan(5);
    expect(parsed.lineItems[0]?.quantity).toBe(419.494);
  });

  it("sends a scanned PDF to anomaly review", async () => {
    const buf = await readFile(path.join(LANDING, "scanned_invoice_3A1DBBABB32F.pdf"));
    const parsed = await parseInvoiceDocument(buf, { fileName: "scanned.pdf" });
    expect(parsed.status).toBe("anomaly");
    expect(parsed.confidence).toBe(0);
    expect(parsed.reviewReasons[0]).toMatch(/scanned|image-only/i);
  });
});

describe("generic invoice classifier", () => {
  it("reads labelled fields, IBAN, line items and PO", () => {
    const lines = [
      "TAX INVOICE",
      "CloudHost Ltd",
      "Invoice Number: PO-INV-88",
      "Invoice date: 03/08/2026",
      "Due Date: 17/08/2026",
      "Payment Terms: Net 14",
      "PO Number: PO-8001",
      "Customer Number: CUST-9",
      "IBAN: GB82 WEST 1234 5698 7654 32",
      "BIC: WESTGB2L",
      "BSB: 062-000",
      "Description Qty Price Amount",
      "Hosting 1 $1,200.00",
      "Support hours 2 $150.00",
      "Subtotal $1,350.00",
      "VAT @ 20 $270.00",
      "Total Amount GBP 1,620.00",
    ];
    const parsed = classifyInvoice({
      fileName: "cloudhost.pdf",
      lines,
      fullText: lines.join("\n"),
      pageCount: 1,
    });
    expect(parsed.vendor).toBe("generic");
    expect(parsed.header.invoiceNumber).toBe("PO-INV-88");
    expect(parsed.header.invoiceDate).toBe("2026-08-03");
    expect(parsed.header.dueDate).toBe("2026-08-17");
    expect(parsed.header.poNumber).toBe("PO-8001");
    expect(parsed.header.paymentTerms).toMatch(/Net 14/i);
    expect(parsed.bank?.iban).toMatch(/^GB82/);
    expect(parsed.bank?.bic).toBe("WESTGB2L");
    expect(parsed.bank?.bsb).toBe("062-000");
    expect(parsed.lineItems.length).toBeGreaterThanOrEqual(2);
    expect(parsed.header.currency).toBe("GBP");
    expect(parsed.status).toBe("parsed");
  });

  it("marks empty extracts as anomaly and guesses a supplier name", () => {
    const empty = classifyInvoice({
      fileName: "blank.pdf",
      lines: [],
      fullText: "",
      pageCount: 1,
      warnings: ["unsupported"],
    });
    expect(empty.status).toBe("anomaly");

    const weak = classifyInvoice({
      fileName: "weak.pdf",
      lines: ["Random GmbH", "something 12.00"],
      fullText: "Random GmbH\nsomething 12.00",
      pageCount: 1,
    });
    expect(weak.header.supplierName).toMatch(/GmbH/);
    expect(["anomaly", "partial"]).toContain(weak.status);
  });

  it("covers vendor fallbacks, amount-due lines and opening-balance noise", () => {
    const teslaSparse = classifyInvoice({
      fileName: "tesla.com-receipt.pdf",
      lines: ["Tesla Motors", "Invoice Number 9X", "www.tesla.com"],
      fullText: "Tesla Motors\nInvoice Number 9X\nwww.tesla.com",
      pageCount: 1,
    });
    expect(teslaSparse.vendor).toBe("tesla");
    expect(teslaSparse.header.supplierName).toMatch(/Tesla/);

    const hotjarSparse = classifyInvoice({
      fileName: "hotjar.txt",
      lines: ["Hotjar Ltd", "Invoice Number: 1", "Date Issued: 2019-09-01", "TOTAL (USD) $1.00"],
      fullText: "Hotjar Ltd\nInvoice Number: 1\nDate Issued: 2019-09-01\nTOTAL (USD) $1.00",
      pageCount: 1,
    });
    expect(hotjarSparse.vendor).toBe("hotjar");
    expect(hotjarSparse.header.customerName).toBeUndefined();

    const originSparse = classifyInvoice({
      fileName: "originenergy-bill.pdf",
      lines: [
        "Origin Energy Electricity Ltd",
        "Account number",
        "200 111 222 333",
        "Tax invoice",
        "100 111 222 333",
        "Opening balance $10.00",
        "Payments received $10.00",
        "Amount due $55.00",
        "Biller Code: 99",
        "Peak Usage 1.0 2.0 c/kWh $2.00",
        "Supply Charge 1.0 c/Day $3.00",
      ],
      fullText: [
        "originenergy.com.au",
        "Account number 200 111 222 333",
        "Tax invoice 100 111 222 333",
        "Issue date 01 Jan 20",
        "Due date 15 Jan 20",
        "Total amount due $55.00",
        "GST $5.00",
        "(excl GST) $50.00",
        "National Meter Identifier (NMI) 41038409966",
        "U 1101 208 COWARD ST MASCOT NSW 2020",
        "Biller Code: 99",
      ].join("\n"),
      pageCount: 1,
    });
    expect(originSparse.vendor).toBe("origin");
    expect(originSparse.header.accountNumber).toBe("200111222333");
    expect(originSparse.bank?.billerCode).toBe("99");

    const due = classifyInvoice({
      fileName: "due.pdf",
      lines: [
        "Widgets Inc.",
        "Invoice Number: ZZ-10001",
        "Invoice date: 2026-01-01",
        "Amount due $40.00",
        "Description Qty Amount",
        "Opening balance $9.00",
        "Widget $40.00",
      ],
      fullText: "Widgets Inc.\nInvoice Number: ZZ-10001\nInvoice date: 2026-01-01\nAmount due $40.00",
      pageCount: 1,
      warnings: ["layout shifted"],
    });
    expect(due.header.invoiceNumber).toBe("ZZ-10001");
    expect(due.header.total).toBe(4000);
  });
});
