/**
 * Dump a parsed bank-statement PDF (header + txn summary) to stdout.
 *
 *   npm run parse:statement -- /path/to/statement.pdf
 *   npm run parse:statement -- --json /path/to/statement.pdf
 */
import { readFile, writeFile } from "fs/promises";
import path from "path";

import { parseUkHsbcPdf } from "@/lib/parse/pdf";

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const jsonMode = process.argv.includes("--json");
  const outPath = argValue("--out");
  const positional = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--") && a !== outPath);
  const file =
    positional[0] ||
    process.env.HSBC_PDF_PATH ||
    "/tmp/hsbc-pdf/statement.pdf";

  const buf = await readFile(file);
  const parsed = await parseUkHsbcPdf(buf, { fileName: path.basename(file) });

  const credits = parsed.transactions.filter((t) => t.amount > 0).length;
  const debits = parsed.transactions.filter((t) => t.amount < 0).length;
  const types: Record<string, number> = {};
  for (const txn of parsed.transactions) {
    const key = txn.trnType ?? "?";
    types[key] = (types[key] ?? 0) + 1;
  }

  const dump = {
    file,
    parserId: parsed.parserId,
    parserVersion: parsed.parserVersion,
    pageCount: parsed.pageCount,
    header: parsed.header,
    transactionCount: parsed.transactions.length,
    credits,
    debits,
    types,
    perPageCounts: parsed.perPageCounts,
    warnings: parsed.warnings,
    skipped: {
      noise: parsed.skipped.filter((s) => s.reason === "noise").length,
      unparsed: parsed.skipped.filter((s) => s.reason === "unparsed").length,
    },
    trace: parsed.trace,
    first: parsed.transactions.slice(0, 3),
    last: parsed.transactions.slice(-3),
    sampleDebit: parsed.transactions.find((t) => t.debitAmount),
    sampleWrappedNarrative: parsed.transactions.find(
      (t) => (t.narrative ?? "").length > 160,
    ),
  };

  if (outPath) {
    await writeFile(outPath, JSON.stringify(dump, null, 2), "utf8");
  }

  if (jsonMode) {
    process.stdout.write(JSON.stringify(dump, null, 2) + "\n");
    return;
  }

  const h = parsed.header;
  const lines = [
    `File: ${file}`,
    `Parser: ${parsed.parserId}@${parsed.parserVersion}  pages=${parsed.pageCount}`,
    `Account: ${h.accountName ?? "?"}  ${h.accountNumber ?? ""}  ${h.currency ?? ""}`,
    `Bank: ${h.bankName ?? "?"}  IBAN=${h.iban ?? "?"}  BIC=${h.bic ?? "?"}`,
    `Period: ${h.periodStart ?? "?"} → ${h.periodEnd ?? "?"}  statementDate=${h.statementDate ?? "?"}`,
    `Balances (cents): currentLedger=${h.currentLedgerBalance ?? "?"}  closingBF=${h.closingLedgerBroughtForward ?? "?"}`,
    `Transactions: ${parsed.transactions.length}  credits=${credits}  debits=${debits}  types=${JSON.stringify(types)}`,
    `Warnings: ${parsed.warnings.length || "none"}`,
    `Skipped: noise=${dump.skipped.noise} unparsed=${dump.skipped.unparsed}`,
    "",
    "First 3:",
    ...dump.first.map(
      (t) =>
        `  L${t.lineNumber} p${t.page} ${t.postDate} ${t.trnType ?? ""} amt=${t.amount} bal=${t.balanceAfter} ${t.customerReference ?? ""}`,
    ),
    "Last 3:",
    ...dump.last.map(
      (t) =>
        `  L${t.lineNumber} p${t.page} ${t.postDate} ${t.trnType ?? ""} amt=${t.amount} bal=${t.balanceAfter} ${t.customerReference ?? ""}`,
    ),
    "",
    "Trace:",
    ...parsed.trace.map((e) => `  [${e.level}] ${e.stage}: ${e.message}`),
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
