import { extractPdfTextItems } from "../pdf/extract";
import { parseCsv } from "../csv";
import { extractDocLines } from "./doc";
import {
  extractDocxText,
  extractXlsxLines,
  looksLikeOle,
  looksLikeZip,
} from "./office";
import { linesFromPdfItems, normalizeSpace } from "./text";
import type { ExtractedDocument } from "./types";

export type InvoiceFileKind = ExtractedDocument["kind"];

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  text: "text/plain",
  unsupported: "application/octet-stream",
};

export function extensionOf(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function mimeForFile(fileName: string, kind?: InvoiceFileKind): string {
  const ext = extensionOf(fileName);
  if (ext === "pdf") return MIME.pdf;
  if (ext === "docx") return MIME.docx;
  if (ext === "doc") return MIME.doc;
  if (ext === "xlsx" || ext === "xlsm") return MIME.xlsx;
  if (ext === "csv") return MIME.csv;
  if (ext === "txt") return MIME.text;
  if (kind && MIME[kind]) return MIME[kind];
  return MIME.unsupported;
}

function kindFromName(fileName: string, buf: Buffer): InvoiceFileKind {
  const ext = extensionOf(fileName);
  if (ext === "pdf" || buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (ext === "csv" || ext === "txt") return ext === "txt" ? "text" : "csv";
  if (ext === "docx") return "docx";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  if (ext === "doc" && looksLikeZip(buf)) return "docx";
  if (ext === "doc" && looksLikeOle(buf)) return "doc";
  if (ext === "xls" || looksLikeOle(buf)) return "unsupported";
  return "unsupported";
}

function fromLines(
  kind: InvoiceFileKind,
  fileName: string,
  lines: string[],
  pageCount: number,
  warnings: string[] = [],
): ExtractedDocument {
  const cleaned = lines.map(normalizeSpace).filter(Boolean);
  return {
    kind,
    fileName,
    mimeType: mimeForFile(fileName, kind),
    pageCount,
    lines: cleaned,
    fullText: cleaned.join("\n"),
    warnings,
  };
}

function csvLines(content: string): string[] {
  const rows = parseCsv(content);
  if (rows.length === 0) {
    return content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  const keys = Object.keys(rows[0] ?? {});
  if (keys.length === 2) {
    return rows.map((row) => {
      const [a, b] = keys;
      return `${row[a]}: ${row[b]}`;
    });
  }
  const pairs = keys.map((k) => `${k}: ${rows[0]?.[k] ?? ""}`);
  const header = keys.join(" | ");
  const body = rows.map((row) => keys.map((k) => row[k] ?? "").join(" | "));
  return [...pairs, header, ...body];
}

/**
 * Extract normalised text lines from an invoice document.
 * Legacy .xls (OLE) stays empty. A .doc is read as Word zip when the bytes are
 * a package, and from the Word piece table when they are OLE.
 */
export async function extractInvoiceDocument(
  buf: Buffer,
  fileName: string,
): Promise<ExtractedDocument> {
  const kind = kindFromName(fileName, buf);
  if (kind === "doc") {
    const lines = extractDocLines(buf);
    if (lines.length === 0) {
      return fromLines("unsupported", fileName, [], 0, [
        "Legacy .doc text could not be read; save as .docx.",
      ]);
    }
    return fromLines("doc", fileName, lines, 1);
  }
  if (kind === "unsupported") {
    const why =
      extensionOf(fileName) === "xls" || looksLikeOle(buf)
        ? "Legacy .xls (OLE) is not supported; save as .xlsx."
        : `Unsupported file type (${extensionOf(fileName) || "unknown"}).`;
    return fromLines(kind, fileName, [], 0, [why]);
  }
  if (kind === "pdf") {
    const extracted = await extractPdfTextItems(buf);
    return fromLines("pdf", fileName, linesFromPdfItems(extracted.items), extracted.pageCount);
  }
  if (kind === "docx") {
    return fromLines("docx", fileName, extractDocxText(buf), 1);
  }
  if (kind === "xlsx") {
    return fromLines("xlsx", fileName, extractXlsxLines(buf), 1);
  }
  const text = buf.toString("utf8");
  if (kind === "csv") return fromLines("csv", fileName, csvLines(text), 1);
  return fromLines("text", fileName, text.split(/\r?\n/), 1);
}
