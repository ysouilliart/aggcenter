/**
 * A small, dependency-free CSV parser that handles quoted fields, escaped
 * quotes ("") and CRLF/LF line endings. Returns an array of row objects keyed
 * by the (lower-cased, trimmed) header names.
 */
export function parseCsv(input: string): Record<string, string>[] {
  const rows = parseRows(input);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const records: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // Skip fully blank lines.
    if (cells.length === 1 && cells[0].trim() === "") continue;
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = (cells[idx] ?? "").trim();
    });
    records.push(record);
  }

  return records;
}

function parseRows(input: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // ignore; handled by the following \n (or trailing CR)
    } else {
      field += char;
    }
  }

  // Flush the last field/row if the file doesn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Serialize rows using the given header order. Quotes fields that need it. */
export function serializeCsv(
  headers: readonly string[],
  rows: Array<Record<string, string>>,
  lineEnding: "\n" | "\r\n" = "\r\n",
): string {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvField(row[h] ?? "")).join(","));
  }
  return lines.join(lineEnding) + lineEnding;
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
