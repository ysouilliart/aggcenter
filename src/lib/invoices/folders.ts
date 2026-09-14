import type { InvoiceFolder } from "../parse/invoice/types";
import { INVOICE_FOLDERS } from "./types";

export const DEFAULT_INVOICE_PREFIX = "aggcenter/invoices/";

export function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function invoiceFolderKey(
  prefix: string,
  folder: InvoiceFolder,
  invoiceId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[/\\]/g, "_");
  return `${withTrailingSlash(prefix)}${folder}/${invoiceId}/${safe}`;
}

export function landingKey(prefix: string, fileName: string): string {
  return `${withTrailingSlash(prefix)}landing/${fileName.replace(/[/\\]/g, "_")}`;
}

export function folderFromKey(key: string, prefix: string): InvoiceFolder | undefined {
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const first = rest.split("/").filter(Boolean)[0];
  return INVOICE_FOLDERS.find((f) => f === first);
}

export function contentTypeForName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === "xlsx" || ext === "xlsm") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (ext === "csv") return "text/csv";
  if (ext === "txt") return "text/plain";
  return "application/octet-stream";
}

export const INVOICE_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "xlsm",
  "csv",
  "txt",
  "doc",
  "xls",
]);

export function isInvoiceFileName(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return Boolean(ext && INVOICE_EXTENSIONS.has(ext));
}
