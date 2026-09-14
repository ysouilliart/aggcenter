import { readFile } from "fs/promises";
import path from "path";

import { parseInvoiceDocument } from "@/lib/parse/invoice";

const dir = "data/sample/invoices/landing";
const files = [
  "Hotjar_invoice.pdf",
  "tesla_invoice_eastlakes.pdf",
  "tesla_invoice_batemans-bay.pdf",
  "Origin_electricity_invoice.pdf",
  "scanned_invoice_3A1DBBABB32F.pdf",
];

async function main() {
  for (const file of files) {
    const buf = await readFile(path.join(dir, file));
    const parsed = await parseInvoiceDocument(buf, { fileName: file });
    const summary = {
      file,
      vendor: parsed.vendor,
      status: parsed.status,
      confidence: parsed.confidence,
      header: parsed.header,
      lines: parsed.lineItems.length,
      tax: parsed.taxLines,
      bank: parsed.bank,
      reasons: parsed.reviewReasons,
      warnings: parsed.warnings,
      sampleLines: parsed.lineItems.slice(0, 8),
    };
    console.log(JSON.stringify(summary, null, 2));
    console.log("-----");
  }
}

void main();
