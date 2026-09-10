import type { PdfTextItem } from "./types";
import type { StatementPdfParser } from "./types";
import { ukHsbcParser } from "./ukHsbc";

/**
 * PDF parsers keyed by the bank-code folder under
 * `aggCenter/bankStatements/<bankCode>/`.
 */
export const PARSER_BY_BANK_CODE: Record<string, StatementPdfParser> = {
  "UK-HSBC": ukHsbcParser,
};

export const STATEMENT_PDF_PARSERS: StatementPdfParser[] = Object.values(
  PARSER_BY_BANK_CODE,
);

export function parserForBankCode(bankCode: string): StatementPdfParser | undefined {
  return PARSER_BY_BANK_CODE[bankCode.trim().toUpperCase()];
}

export function bankCodeForParser(parser: StatementPdfParser): string {
  for (const [code, candidate] of Object.entries(PARSER_BY_BANK_CODE)) {
    if (candidate.id === parser.id) return code;
  }
  return parser.id.toUpperCase();
}

/** Read a bank-code folder or HSBC filename from an object-storage key. */
export function bankCodeFromObjectKey(key: string): string | undefined {
  const parts = key.split("/").filter(Boolean);
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (PARSER_BY_BANK_CODE[upper]) return upper;
  }
  if (/\bhsbc\b/i.test(key)) return "UK-HSBC";
  return undefined;
}

export function parserForPdf(input: {
  key: string;
  fileName: string;
  items?: PdfTextItem[];
}): { bankCode: string; parser: StatementPdfParser } | undefined {
  const fromPath = bankCodeFromObjectKey(input.key);
  if (fromPath) {
    const parser = parserForBankCode(fromPath);
    if (parser) return { bankCode: fromPath, parser };
  }
  if (input.items) {
    for (const parser of STATEMENT_PDF_PARSERS) {
      if (parser.canParse({ fileName: input.fileName, items: input.items })) {
        return { bankCode: bankCodeForParser(parser), parser };
      }
    }
  }
  return undefined;
}
