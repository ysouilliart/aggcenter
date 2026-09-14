import { unzip } from "../../zip";

function decodeXml(buf: Buffer): string {
  const head = buf.subarray(0, 80).toString("latin1");
  if (head.includes("utf-16") || head.includes("UTF-16")) {
    return buf.toString("utf16le");
  }
  return buf.toString("utf8");
}

function tagTexts(xml: string, localName: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${localName}\\b[^>]*>([^<]*)</(?:\\w+:)?${localName}>`, "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    out.push(decodeEntities(match[1]));
  }
  return out;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export function extractDocxText(buf: Buffer): string[] {
  const entries = unzip(buf);
  const doc = entries.find((e) => /word\/document\.xml$/i.test(e.name));
  if (!doc) return [];
  const xml = decodeXml(doc.data);
  const paragraphs = xml.split(/<\/(?:w:)?p>/i);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const texts = tagTexts(paragraph, "t");
    const line = texts.join("").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  }
  return lines;
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function rowIndex(ref: string): number {
  const n = Number(ref.match(/\d+/)?.[0] ?? "1");
  return Number.isFinite(n) ? n : 1;
}

function parseSharedStrings(xml: string): string[] {
  const items: string[] = [];
  const re = /<(?:\w+:)?si\b[^>]*>[\s\S]*?<\/(?:\w+:)?si>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    items.push(tagTexts(match[0], "t").join(""));
  }
  return items;
}

export function extractXlsxLines(buf: Buffer): string[] {
  const entries = unzip(buf);
  const shared = entries.find((e) => /xl\/sharedStrings\.xml$/i.test(e.name));
  const strings = shared ? parseSharedStrings(decodeXml(shared.data)) : [];
  const sheets = entries
    .filter((e) => /xl\/worksheets\/sheet\d+\.xml$/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sheets.length === 0) {
    return entries.flatMap((e) => tagTexts(decodeXml(e.data), "t")).filter(Boolean);
  }
  const lines: string[] = [];
  for (const sheet of sheets) {
    const xml = decodeXml(sheet.data);
    const rows = new Map<number, string[]>();
    const cellRe = /<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/gi;
    let match: RegExpExecArray | null;
    while ((match = cellRe.exec(xml))) {
      const attrs = match[1];
      const body = match[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? "A1";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const raw = tagTexts(body, "v")[0] ?? tagTexts(body, "t")[0] ?? "";
      let value = raw;
      if (type === "s") {
        const idx = Number(raw);
        value = Number.isFinite(idx) ? (strings[idx] ?? raw) : raw;
      } else if (type === "inlineStr") {
        value = tagTexts(body, "t").join("");
      }
      value = value.trim();
      if (!value) continue;
      const r = rowIndex(ref);
      const c = colIndex(ref);
      const row = rows.get(r) ?? [];
      row[c] = value;
      rows.set(r, row);
    }
    const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, cells] of ordered) {
      const filled = Array.from({ length: cells.length }, (_, i) => cells[i] ?? "");
      const present = filled.filter((c) => c);
      if (present.length === 2) {
        lines.push(`${present[0]}: ${present[1]}`);
        continue;
      }
      const line = filled
        .join(" | ")
        .replace(/\s+\|\s+/g, " | ")
        .replace(/^(?: \| )+|(?: \| )+$/g, "")
        .trim();
      if (line) lines.push(line);
    }
  }
  return lines;
}

export function looksLikeZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
}

export function looksLikeOle(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0
  );
}
