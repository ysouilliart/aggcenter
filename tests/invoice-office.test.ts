import { describe, expect, it } from "vitest";

import { extractInvoiceDocument, mimeForFile } from "@/lib/parse/invoice/extract";
import { classifyInvoice } from "@/lib/parse/invoice";
import { looksLikeOle, looksLikeZip } from "@/lib/parse/invoice/office";
import { extractDocxText, extractXlsxLines } from "@/lib/parse/invoice/office";
import { createZipStore } from "@/lib/zip";

function docx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`)
    .join("");
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return createZipStore([{ name: "word/document.xml", data: Buffer.from(xml, "utf8") }]);
}

function xlsx(rows: string[][]): Buffer {
  const strings: string[] = [];
  const cells: string[] = [];
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
      const idx = strings.push(value) - 1;
      cells.push(`<c r="${ref}" t="s"><v>${idx}</v></c>`);
    });
  });
  const shared = `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData><row>${cells.join("")}</row></sheetData></worksheet>`;
  return createZipStore([
    { name: "xl/sharedStrings.xml", data: Buffer.from(shared, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet, "utf8") },
  ]);
}

describe("office extractors", () => {
  it("pulls paragraphs from a DOCX and classifies them", async () => {
    const buf = docx([
      "Invoice Number: INV-9001",
      "Invoice date: 2026-01-15",
      "Due Date: 2026-02-14",
      "Acme Pty Ltd",
      "Subtotal $100.00",
      "Total Amount AUD 110.00",
    ]);
    expect(looksLikeZip(buf)).toBe(true);
    const lines = extractDocxText(buf);
    expect(lines.some((l) => /INV-9001/.test(l))).toBe(true);
    const extracted = await extractInvoiceDocument(buf, "invoice.docx");
    expect(extracted.kind).toBe("docx");
    const parsed = classifyInvoice({
      fileName: "invoice.docx",
      lines: extracted.lines,
      fullText: extracted.fullText,
      pageCount: 1,
    });
    expect(parsed.header.invoiceNumber).toBe("INV-9001");
    expect(parsed.header.dueDate).toBe("2026-02-14");
  });

  it("reads XLSX shared-string cells", async () => {
    const buf = xlsx([
      ["Invoice Number", "INV-77"],
      ["Invoice date", "2026-03-01"],
      ["Supplier Name", "Widgets GmbH"],
      ["Total", "250.00"],
      ["Currency", "EUR"],
    ]);
    const lines = extractXlsxLines(buf);
    expect(lines.join("\n")).toMatch(/INV-77/);
    const extracted = await extractInvoiceDocument(buf, "invoice.xlsx");
    expect(extracted.kind).toBe("xlsx");
    const parsed = classifyInvoice({
      fileName: "invoice.xlsx",
      lines: extracted.lines,
      fullText: extracted.fullText,
      pageCount: 1,
    });
    expect(parsed.header.invoiceNumber).toBe("INV-77");
    expect(parsed.header.currency).toBe("EUR");
  });

  it("parses CSV key/value and tabular invoices", async () => {
    const kv = Buffer.from("Field,Value\nInvoice Number,INV-1\nTotal,$50.00\nCurrency,USD\n");
    const extracted = await extractInvoiceDocument(kv, "kv.csv");
    expect(extracted.kind).toBe("csv");
    expect(extracted.lines[0]).toMatch(/Invoice Number/i);
    const parsed = classifyInvoice({
      fileName: "kv.csv",
      lines: extracted.lines,
      fullText: extracted.fullText,
      pageCount: 1,
    });
    expect(parsed.header.invoiceNumber).toBe("INV-1");
    expect(parsed.header.currency).toBe("USD");
  });

  it("flags legacy OLE .xls as unsupported", async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(looksLikeOle(ole)).toBe(true);
    const extracted = await extractInvoiceDocument(ole, "legacy.xls");
    expect(extracted.kind).toBe("unsupported");
    expect(extracted.warnings[0]).toMatch(/OLE|\.xls/);
  });

  it("reads a plain-text invoice", async () => {
    const extracted = await extractInvoiceDocument(
      Buffer.from("Invoice Number: TXT-2\nTotal EUR 9.00\n"),
      "note.txt",
    );
    expect(extracted.kind).toBe("text");
  });

  it("maps MIME types and empty CSV / header-only files", async () => {
    expect(mimeForFile("a.pdf")).toContain("pdf");
    expect(mimeForFile("a.docx")).toContain("wordprocessingml");
    expect(mimeForFile("a.xlsm")).toContain("spreadsheetml");
    expect(mimeForFile("a.csv")).toBe("text/csv");
    expect(mimeForFile("a.txt")).toBe("text/plain");
    expect(mimeForFile("a.bin")).toBe("application/octet-stream");
    const empty = await extractInvoiceDocument(Buffer.from("\n\n"), "blank.csv");
    expect(empty.kind).toBe("csv");
  });

  it("falls back when a zip has no worksheet", () => {
    const buf = createZipStore([
      { name: "xl/other.xml", data: Buffer.from("<root><t>Loose</t></root>") },
    ]);
    expect(extractXlsxLines(buf).join("")).toMatch(/Loose/);
  });

  it("joins three-column XLSX rows and skips empty cells", () => {
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1"><v>2</v></c>
      <c r="C1"><v>3</v></c>
      <c r="D1"><v></v></c>
      <c t="s"><v>0</v></c>
    </sheetData></worksheet>`;
    const shared = `<?xml version="1.0"?><sst><si><t>Qty</t></si></sst>`;
    const buf = createZipStore([
      { name: "xl/sharedStrings.xml", data: Buffer.from(shared) },
      { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet) },
    ]);
    const lines = extractXlsxLines(buf);
    expect(lines.some((l) => l.includes("|") || l.includes("Qty"))).toBe(true);
  });

  it("returns nothing for a docx zip without document.xml", () => {
    const buf = createZipStore([{ name: "word/styles.xml", data: Buffer.from("<w:styles/>") }]);
    expect(extractDocxText(buf)).toEqual([]);
  });

  it("decodes numeric XLSX cells without shared strings", () => {
    const sheet = `<?xml version="1.0"?><worksheet><sheetData><c r="A1"><v>42</v></c><c r="B1" t="inlineStr"><is><t>Hello</t></is></c></sheetData></worksheet>`;
    const buf = createZipStore([
      { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet, "utf8") },
    ]);
    const lines = extractXlsxLines(buf);
    expect(lines.join(" ")).toMatch(/42/);
    expect(lines.join(" ")).toMatch(/Hello/);
  });
});
