/**
 * Legacy Word 97–2003 (.doc) text. These files are OLE compound documents.
 * The body lives in the WordDocument stream, addressed by the piece table in
 * 0Table or 1Table. .xls stays unsupported; this reader is only used for .doc.
 */

import { looksLikeOle } from "./office";

const ENDOFCHAIN = 0xfffffffe;
const MAX_SECTORS = 8_192;
const MAX_PIECES = 20_000;
const MAX_CHARS = 500_000;

function sectorOffset(sector: number, sectorSize: number): number {
  return (sector + 1) * sectorSize;
}

function readSector(buf: Buffer, sector: number, sectorSize: number): Buffer | undefined {
  const offset = sectorOffset(sector, sectorSize);
  if (sector < 0 || offset < 0 || offset + sectorSize > buf.length) return undefined;
  return buf.subarray(offset, offset + sectorSize);
}

function readFatSectorIndexes(buf: Buffer, sectorSize: number): number[] {
  const wanted = buf.readUInt32LE(0x2c);
  const indexes: number[] = [];
  for (let i = 0; i < 109 && indexes.length < wanted; i += 1) {
    const sector = buf.readUInt32LE(0x4c + i * 4);
    if (sector >= 0xfffffff0) break;
    indexes.push(sector);
  }
  let difat = buf.readUInt32LE(0x44);
  const difatCount = buf.readUInt32LE(0x48);
  const perSector = Math.floor(sectorSize / 4) - 1;
  let followed = 0;
  while (difat < 0xfffffff0 && followed < difatCount && indexes.length < wanted) {
    const sector = readSector(buf, difat, sectorSize);
    if (!sector) break;
    for (let i = 0; i < perSector && indexes.length < wanted; i += 1) {
      const next = sector.readUInt32LE(i * 4);
      if (next >= 0xfffffff0) break;
      indexes.push(next);
    }
    difat = sector.readUInt32LE(perSector * 4);
    followed += 1;
  }
  return indexes;
}

function buildFat(buf: Buffer, sectorSize: number): Buffer | undefined {
  const indexes = readFatSectorIndexes(buf, sectorSize);
  if (indexes.length === 0) return undefined;
  const fat = Buffer.alloc(indexes.length * sectorSize);
  for (let i = 0; i < indexes.length; i += 1) {
    const sector = readSector(buf, indexes[i], sectorSize);
    if (!sector) return undefined;
    sector.copy(fat, i * sectorSize);
  }
  return fat;
}

function nextFat(fat: Buffer, sector: number): number {
  const offset = sector * 4;
  if (offset < 0 || offset + 4 > fat.length) return ENDOFCHAIN;
  return fat.readUInt32LE(offset);
}

function readChain(buf: Buffer, fat: Buffer, start: number, size: number, sectorSize: number): Buffer {
  if (size <= 0 || start >= 0xfffffff0) return Buffer.alloc(0);
  const out = Buffer.alloc(size);
  let sector = start;
  let written = 0;
  const seen = new Set<number>();
  while (written < size && sector < 0xfffffff0 && seen.size < MAX_SECTORS) {
    if (seen.has(sector)) break;
    seen.add(sector);
    const data = readSector(buf, sector, sectorSize);
    if (!data) break;
    const take = Math.min(sectorSize, size - written);
    data.copy(out, written, 0, take);
    written += take;
    sector = nextFat(fat, sector);
  }
  return out.subarray(0, Math.min(written, size));
}

interface OleEntry {
  name: string;
  type: number;
  start: number;
  size: number;
}

function directoryEntries(directory: Buffer, version4: boolean): OleEntry[] {
  const entries: OleEntry[] = [];
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const entry = directory.subarray(offset, offset + 128);
    const type = entry[0x42];
    if (type !== 1 && type !== 2 && type !== 5) continue;
    const nameBytes = Math.max(0, Math.min(entry.readUInt16LE(0x40), 64) - 2);
    const name = entry.subarray(0, nameBytes).toString("utf16le").replace(/\0/g, "");
    const start = entry.readUInt32LE(0x74);
    const size = version4 ? Number(entry.readBigUInt64LE(0x78)) : entry.readUInt32LE(0x78);
    entries.push({ name, type, start, size: Number.isFinite(size) ? size : 0 });
  }
  return entries;
}

function readMiniChain(miniStream: Buffer, miniFat: Buffer, start: number, size: number, miniSize: number): Buffer {
  if (size <= 0 || start >= 0xfffffff0) return Buffer.alloc(0);
  const out = Buffer.alloc(size);
  let sector = start;
  let written = 0;
  const seen = new Set<number>();
  while (written < size && sector < 0xfffffff0 && seen.size < MAX_SECTORS) {
    if (seen.has(sector)) break;
    seen.add(sector);
    const offset = sector * miniSize;
    if (offset >= miniStream.length) break;
    const take = Math.min(miniSize, size - written, miniStream.length - offset);
    miniStream.copy(out, written, offset, offset + take);
    written += take;
    const fatOffset = sector * 4;
    if (fatOffset + 4 > miniFat.length) break;
    sector = miniFat.readUInt32LE(fatOffset);
  }
  return out.subarray(0, Math.min(written, size));
}

function oleStreams(buf: Buffer): Map<string, Buffer> {
  const streams = new Map<string, Buffer>();
  if (!looksLikeOle(buf) || buf.length < 512) return streams;
  const sectorShift = buf.readUInt16LE(0x1e);
  if (sectorShift < 9 || sectorShift > 12) return streams;
  const sectorSize = 1 << sectorShift;
  const miniShift = buf.readUInt16LE(0x20);
  const miniSize = miniShift >= 6 && miniShift <= 10 ? 1 << miniShift : 64;
  const fat = buildFat(buf, sectorSize);
  if (!fat) return streams;
  const directory = readChain(buf, fat, buf.readUInt32LE(0x30), sectorSize * 32, sectorSize);
  const version4 = buf.readUInt16LE(0x1a) >= 4;
  const entries = directoryEntries(directory, version4);
  const root = entries.find((entry) => entry.type === 5);
  const cutoff = buf.readUInt32LE(0x38);
  const miniFatCount = buf.readUInt32LE(0x40);
  const miniFat = root
    ? readChain(buf, fat, buf.readUInt32LE(0x3c), miniFatCount * sectorSize, sectorSize)
    : Buffer.alloc(0);
  const miniStream = root ? readChain(buf, fat, root.start, root.size, sectorSize) : Buffer.alloc(0);

  for (const entry of entries) {
    if (entry.type !== 2 || !entry.name) continue;
    const data =
      cutoff > 0 && entry.size < cutoff
        ? readMiniChain(miniStream, miniFat, entry.start, entry.size, miniSize)
        : readChain(buf, fat, entry.start, entry.size, sectorSize);
    streams.set(entry.name.toLowerCase(), data);
  }
  return streams;
}

function stream(streams: Map<string, Buffer>, name: string): Buffer | undefined {
  return streams.get(name.toLowerCase());
}

const WIN1252 = new TextDecoder("windows-1252");

function decodePiece(word: Buffer, filePos: number, chars: number, unicode: boolean): string {
  if (chars <= 0 || filePos < 0 || filePos >= word.length) return "";
  if (unicode) {
    const end = Math.min(word.length, filePos + chars * 2);
    return word.subarray(filePos, end - ((end - filePos) % 2)).toString("utf16le");
  }
  const end = Math.min(word.length, filePos + chars);
  return WIN1252.decode(word.subarray(filePos, end));
}

function pieceText(word: Buffer, table: Buffer): string {
  if (word.length < 0x1aa || table.length < 16) return "";
  if (word.readUInt16LE(0) !== 0xa5ec) return "";
  let pos = word.readUInt32LE(0x01a2);
  const clxLength = word.readUInt32LE(0x01a6);
  if (clxLength < 16 || pos < 0 || pos >= table.length) return "";
  const limit = Math.min(table.length, pos + clxLength);
  let guard = 0;
  while (pos < limit && guard < 64) {
    const flag = table[pos];
    if (flag !== 1) break;
    if (pos + 3 > limit) return "";
    const skip = table.readUInt16LE(pos + 1);
    pos += 3 + skip;
    guard += 1;
  }
  if (pos >= limit || table[pos] !== 2) return "";
  pos += 1;
  if (pos + 4 > limit) return "";
  const pieceTableSize = table.readUInt32LE(pos);
  pos += 4;
  if (pieceTableSize < 16 || (pieceTableSize - 4) % 12 !== 0) return "";
  const pieces = (pieceTableSize - 4) / 12;
  if (pieces <= 0 || pieces > MAX_PIECES) return "";
  const cpBytes = (pieces + 1) * 4;
  const pcdBytes = pieces * 8;
  if (pos + cpBytes + pcdBytes > table.length) return "";

  const ccpText = word.readUInt32LE(0x4c);
  const bounded = ccpText > 0 && ccpText < 5_000_000;
  let text = "";
  for (let i = 0; i < pieces && text.length < MAX_CHARS; i += 1) {
    const cpStart = table.readUInt32LE(pos + i * 4);
    const cpEnd = table.readUInt32LE(pos + (i + 1) * 4);
    if (cpEnd < cpStart) continue;
    let from = cpStart;
    let to = cpEnd;
    if (bounded) {
      if (cpEnd <= 0 || cpStart >= ccpText) continue;
      from = Math.max(cpStart, 0);
      to = Math.min(cpEnd, ccpText);
    }
    if (to <= from) continue;
    const pcd = pos + cpBytes + i * 8;
    let filePos = table.readUInt32LE(pcd + 2);
    const unicode = (filePos & 0x40000000) === 0;
    if (!unicode) filePos = Math.floor((filePos & 0x3fffffff) / 2);
    else filePos &= 0x3fffffff;
    const skip = from - cpStart;
    const chars = Math.min(to - from, MAX_CHARS - text.length);
    const bytePos = filePos + (unicode ? skip * 2 : skip);
    text += decodePiece(word, bytePos, chars, unicode);
  }
  return text;
}

function readableLines(text: string): string[] {
  let out = "";
  let inField = false;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 0x13) {
      inField = true;
      continue;
    }
    if (code === 0x14 || code === 0x15) {
      inField = false;
      continue;
    }
    if (inField) continue;
    if (code === 0x0d || code === 0x0b || code === 0x0c || code === 0x07) {
      out += "\n";
      continue;
    }
    if (code === 0x09) {
      out += " ";
      continue;
    }
    if (code < 0x20 || code === 0xfffe || code === 0xffff) continue;
    out += ch;
  }
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t\u0000]+/g, " ").trim())
    .filter((line) => line.length >= 2);
}

function letterCount(lines: string[]): number {
  return lines.join("").replace(/[^A-Za-z]/g, "").length;
}

function utf16Fallback(buf: Buffer): string[] {
  let best: string[] = [];
  let bestLetters = 0;
  for (const align of [0, 1]) {
    const even = buf.length - align - ((buf.length - align) % 2);
    const view = buf.subarray(align, align + Math.max(0, even));
    const runs: string[] = [];
    let current = "";
    const flush = (min: number) => {
      const trimmed = current.replace(/\s+/g, " ").trim();
      if (trimmed.length >= min) runs.push(trimmed);
      current = "";
    };
    for (let i = 0; i + 1 < view.length && runs.join("").length < MAX_CHARS; i += 2) {
      const code = view.readUInt16LE(i);
      const readable =
        (code >= 0x20 && code <= 0x7e) ||
        code === 0xa3 ||
        code === 0x20ac ||
        (code >= 0xa0 && code <= 0xff);
      if (readable) {
        current += String.fromCharCode(code);
        if (current.length > 240) flush(8);
      } else if (code === 0x0d || code === 0x0a || code === 0x09 || code === 0x0b) {
        flush(4);
      } else {
        flush(12);
      }
    }
    flush(12);
    const letters = letterCount(runs);
    if (letters > bestLetters) {
      best = runs;
      bestLetters = letters;
    }
  }
  return best;
}

/** Lines of body text from a .doc buffer. Empty when the file is not Word. */
export function extractDocLines(buf: Buffer): string[] {
  try {
    const streams = oleStreams(buf);
    const word = stream(streams, "WordDocument");
    if (!word) return utf16Fallback(buf);
    const flags = word.length > 0x0b ? word.readUInt16LE(0x0a) : 0;
    const preferred = (flags & 0x0200) !== 0 ? "1Table" : "0Table";
    const table = stream(streams, preferred) ?? stream(streams, "0Table") ?? stream(streams, "1Table");
    const fromPieces = table ? readableLines(pieceText(word, table)) : [];
    if (letterCount(fromPieces) >= 40) return fromPieces;
    const fallback = utf16Fallback(word);
    return letterCount(fallback) > letterCount(fromPieces) ? fallback : fromPieces;
  } catch {
    return [];
  }
}
