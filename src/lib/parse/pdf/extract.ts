import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { PdfTextItem } from "./types";

interface PdfJsTextItem {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
  fontName?: string;
}

function isPdfJsTextItem(value: unknown): value is PdfJsTextItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as { str?: unknown; transform?: unknown };
  return typeof item.str === "string" && Array.isArray(item.transform);
}

export interface ExtractedPdf {
  items: PdfTextItem[];
  pageCount: number;
}

/**
 * Extract positioned text items from a PDF using pdf.js (no worker).
 * Whitespace-only glyphs are dropped — layout spacers are not useful.
 */
export async function extractPdfTextItems(
  data: Buffer | Uint8Array,
): Promise<ExtractedPdf> {
  // pdf.js rejects Node Buffer even though it is a Uint8Array subclass.
  const bytes = Uint8Array.from(data);
  const init = {
    data: bytes,
    disableWorker: true,
    verbosity: VerbosityLevel.ERRORS,
    isEvalSupported: false,
    useSystemFonts: true,
  };
  // pdf.js 4 types omit the Node `disableWorker` flag.
  const loadingTask = getDocument(init as never);

  const pdf = await loadingTask.promise;
  try {
    const items: PdfTextItem[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      for (const raw of content.items) {
        if (!isPdfJsTextItem(raw)) continue;
        if (!raw.str.trim()) continue;
        const [, , , , x, y] = raw.transform;
        items.push({
          page: pageNum,
          x,
          y,
          width: raw.width ?? 0,
          height: raw.height ?? 0,
          str: raw.str,
          fontName: raw.fontName,
        });
      }
    }
    return { items, pageCount: pdf.numPages };
  } finally {
    await pdf.destroy();
  }
}
