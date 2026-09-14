const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function expandYear(year: string): string {
  if (year.length === 4) return year;
  const n = Number(year);
  if (!Number.isFinite(n)) return year;
  return n >= 70 ? `19${year.padStart(2, "0")}` : `20${year.padStart(2, "0")}`;
}

function iso(year: string, month: string, day: string): string | null {
  const y = expandYear(year);
  const m = month.padStart(2, "0");
  const d = day.padStart(2, "0");
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${m}-${d}`;
}

/** Parse common invoice date formats into ISO `YYYY-MM-DD`. */
export function parseInvoiceDate(value: string | undefined | null): string | null {
  if (!value) return null;
  const raw = value.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  let m = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (m) return iso(m[1], m[2], m[3]);

  m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) return iso(m[3], m[2], m[1]);

  m = raw.match(/^(\d{1,2})\s*\/?\s*([A-Za-z]{3,9})\s*\/?\s*(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) return iso(m[3], month, m[1]);
  }

  m = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) return iso(m[3], month, m[2]);
  }

  return null;
}

const DATE_TOKEN =
  /(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s*\/?\s*[A-Za-z]{3,9}\s*\/?\s*\d{2,4})/;

/** First plausible date in a snippet. */
export function firstDate(text: string): string | null {
  const match = text.match(DATE_TOKEN);
  return match ? parseInvoiceDate(match[1]) : null;
}
