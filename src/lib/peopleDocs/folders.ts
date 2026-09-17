import type { PeopleDocFolder } from "../parse/peopleDocs/types";
import { PEOPLE_DOC_FOLDERS } from "./types";

export const DEFAULT_PEOPLE_DOCS_PREFIX = "aggcenter/peopleDocs/";

export function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function peopleDocFolderKey(
  prefix: string,
  folder: PeopleDocFolder,
  docId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[/\\]/g, "_");
  return `${withTrailingSlash(prefix)}${folder}/${docId}/${safe}`;
}

export function landingKey(prefix: string, fileName: string): string {
  return `${withTrailingSlash(prefix)}landing/${fileName.replace(/[/\\]/g, "_")}`;
}

export function folderFromKey(key: string, prefix: string): PeopleDocFolder | undefined {
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const first = rest.split("/").filter(Boolean)[0];
  return PEOPLE_DOC_FOLDERS.find((f) => f === first);
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

export const PEOPLE_DOC_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "xlsm",
  "csv",
  "txt",
  "doc",
  "xls",
]);

export function isPeopleDocFileName(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return Boolean(ext && PEOPLE_DOC_EXTENSIONS.has(ext));
}
