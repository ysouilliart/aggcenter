import type { PeopleDocFolder } from "../parse/peopleDocs/types";
import { PEOPLE_DOC_FOLDERS } from "./types";

export const DEFAULT_PEOPLE_DOCS_PREFIX = "aggcenter/peopleDocs/";

export function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/**
 * Process day as dd-mm-yyyy. Object keys cannot use `/` inside one folder
 * name, so 23/09/2026 is stored as the single subfolder `23-09-2026`.
 */
export function peopleDocProcessDay(iso: string): string {
  const parsed = new Date(iso);
  const when = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const dd = String(when.getUTCDate()).padStart(2, "0");
  const mm = String(when.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(when.getUTCFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

export function isPeopleDocProcessDay(segment: string): boolean {
  if (!/^\d{2}-\d{2}-\d{4}$/.test(segment)) return false;
  const [dd, mm, yyyy] = segment.split("-").map((part) => Number(part));
  const when = new Date(Date.UTC(yyyy, mm - 1, dd));
  return (
    when.getUTCFullYear() === yyyy && when.getUTCMonth() === mm - 1 && when.getUTCDate() === dd
  );
}

/** File name, with an id suffix only when two documents would share one day folder. */
export function peopleDocObjectName(fileName: string, disambiguator?: string): string {
  const safe = fileName.replace(/[/\\]/g, "_").trim() || "document";
  if (!disambiguator) return safe;
  const dot = safe.lastIndexOf(".");
  if (dot <= 0) return `${safe}__${disambiguator}`;
  return `${safe.slice(0, dot)}__${disambiguator}${safe.slice(dot)}`;
}

export function peopleDocFolderKey(
  prefix: string,
  folder: PeopleDocFolder,
  fileName: string,
  processedOn: string,
  disambiguator?: string,
): string {
  const name = peopleDocObjectName(fileName, disambiguator);
  if (folder === "landing") return landingKey(prefix, name);
  return `${withTrailingSlash(prefix)}${folder}/${peopleDocProcessDay(processedOn)}/${name}`;
}

export function landingKey(prefix: string, fileName: string): string {
  return `${withTrailingSlash(prefix)}landing/${fileName.replace(/[/\\]/g, "_")}`;
}

/**
 * Object-storage folders are prefixes. A kept object under landing/ remains
 * when the last document is moved out, so the landing folder stays visible.
 */
export const PEOPLE_DOC_LANDING_MARKER = ".keep";

export function peopleDocLandingMarkerKey(prefix: string): string {
  return `${withTrailingSlash(prefix)}landing/${PEOPLE_DOC_LANDING_MARKER}`;
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
  if (ext === "doc") return "application/msword";
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

/** List label: the document title from its file name, not agreement ID or other fields. */
export function peopleDocDisplayTitle(fileName: string): string {
  const base = (fileName.split(/[/\\]/).pop() ?? fileName).trim();
  if (!base) return "Untitled document";
  const stripped = base.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  return stripped.trim() || base;
}
