import { toCents } from "../../money";
import type { PdfTextItem } from "./types";

export interface PdfRow {
  y: number;
  page: number;
  items: PdfTextItem[];
}

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

const UK_DATE_RE =
  /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/;

/** Parse "28 Aug 2026" (and similar) into ISO `YYYY-MM-DD`. */
export function parseUkDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(UK_DATE_RE);
  if (!match) return null;
  const [, day, mon, year] = match;
  return `${year}-${MONTHS[mon]}-${day.padStart(2, "0")}`;
}

/** Parse a UK-formatted amount (`1,234.56` / `-809.82`) into integer cents. */
export function parseUkAmount(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-") return null;
  const major = Number(cleaned);
  if (!Number.isFinite(major)) return null;
  return toCents(major);
}

/**
 * Group glyphs into visual rows.
 * `bucket` is the rounding step in PDF points (0.5 for transaction rows,
 * 1 for the looser header block where a label and its value can sit ~0.5pt apart).
 */
export function clusterRows(items: PdfTextItem[], bucket: number): PdfRow[] {
  const groups = new Map<number, PdfTextItem[]>();
  const scale = 1 / bucket;
  for (const item of items) {
    const key = Math.round(item.y * scale) / scale;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, rowItems]) => ({
      y,
      page: rowItems[0].page,
      items: rowItems.sort((a, b) => a.x - b.x),
    }));
}

export function joinedText(row: PdfRow): string {
  return row.items
    .map((i) => i.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
