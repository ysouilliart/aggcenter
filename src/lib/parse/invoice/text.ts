import type { PdfTextItem } from "../pdf/types";
import { clusterRows } from "../pdf/util";

/** Join a visual row, omitting the space when glyphs sit next to each other. */
export function joinPdfRow(items: PdfTextItem[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let out = "";
  let prevRight = -Infinity;
  for (const item of sorted) {
    const gap = item.x - prevRight;
    const threshold = Math.max(1.2, (item.height || 8) * 0.28);
    if (out && gap > threshold) out += " ";
    out += item.str;
    prevRight = item.x + (item.width || 0);
  }
  return out.replace(/\s+/g, " ").trim();
}

export function linesFromPdfItems(items: PdfTextItem[], bucket = 2): string[] {
  return clusterRows(items, bucket)
    .map((row) => joinPdfRow(row.items))
    .map((line) => collapseSpacedLetters(line))
    .filter(Boolean);
}

/**
 * Repair PDF splits like "Tax I nvo i ce" → "Tax Invoice" and "ABN" fragments.
 * Consecutive 1–4 letter alphabetic tokens are concatenated.
 */
export function collapseSpacedLetters(line: string): string {
  const tokens = line.split(" ");
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    if (run[0].length >= 3 && run.slice(1).some((t) => t.length === 1)) {
      out.push(run[0]);
      run = run.slice(1);
    }
    if (!run.length) return;
    const join = run.some((t) => t.length === 1);
    out.push(join ? run.join("") : run.join(" "));
    run = [];
  };
  for (const token of tokens) {
    if (/^[A-Za-z]{1,4}$/.test(token)) {
      run.push(token);
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export function normalizeSpace(value: string): string {
  return value.replace(/[\u00a0]/g, " ").replace(/\s+/g, " ").trim();
}

export function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Value sitting on the same line after a label, or on the following line. */
export function valueAfterLabel(
  lines: string[],
  labels: RegExp,
  valueRe: RegExp,
  windowLines = 3,
): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!labels.test(line)) continue;
    const same = line.replace(labels, " ").trim();
    const sameMatch = same.match(valueRe);
    if (sameMatch) return sameMatch[0].trim();
    for (let j = 1; j <= windowLines && i + j < lines.length; j++) {
      const next = lines[i + j].trim();
      if (!next) continue;
      const m = next.match(valueRe);
      if (m) return m[0].trim();
    }
  }
  return undefined;
}

export function searchText(text: string, re: RegExp): string | undefined {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  const match = global.exec(text);
  if (!match) return undefined;
  return (match[1] ?? match[0]).trim();
}

export function uniquePush(list: string[], value: string | undefined): void {
  if (!value) return;
  const key = value.trim();
  if (!key) return;
  if (!list.includes(key)) list.push(key);
}
