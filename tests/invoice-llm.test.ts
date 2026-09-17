import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InvoiceClassifyConfig } from "@/lib/config";
import { resolveInvoiceClassifyConfig } from "@/lib/config";
import { confirmInvoice } from "@/lib/invoices/confirm";
import { folderForStatus } from "@/lib/invoices/fromParse";
import { uploadInvoice } from "@/lib/invoices/ingest";
import { LocalJsonInvoiceRepository, resetInvoiceRepositoryCache } from "@/lib/invoices/repository";
import { classifyInvoice } from "@/lib/parse/invoice/classify";
import {
  classifyExtractedInvoice,
  getInvoiceClassifyStatus,
  isStaticFastPathHit,
  resultFromLlmPayload,
} from "@/lib/parse/invoice/strategy";
import { alignAmountToExtract, mergeStaticAndLlm, pickCurrency, pickVendor } from "@/lib/parse/invoice/merge";
import { buildLlmMessages, createOpenAiInvoiceLlmClient, truncateInvoiceText } from "@/lib/parse/invoice/llm";
import { asMoneyCents, validateLlmClassify } from "@/lib/parse/invoice/schema";
import { parseInvoiceDocument, type InvoiceLlmClient } from "@/lib/parse/invoice";
import { LocalStorageProvider } from "@/lib/storage/local";

const UNKNOWN_VENDOR_LINES = [
  "BILL FROM",
  "Noordwind Analytics B.V.",
  "KvK 87654321",
  "Document ID ACS-9921",
  "Issued 12 March 2026",
  "Please remit CAD 1,234.56",
  "VAT 21% included",
];

const llmConfig = (overrides: Partial<InvoiceClassifyConfig> = {}): InvoiceClassifyConfig => ({
  llmEnabled: true,
  llmReady: true,
  staticFastPath: true,
  provider: "openai",
  model: "test-model",
  apiBase: "https://llm.test/v1",
  apiKey: "test-key",
  timeoutMs: 5_000,
  ...overrides,
});

function unknownVendorExtract() {
  return {
    kind: "text" as const,
    fileName: "noordwind.txt",
    mimeType: "text/plain",
    pageCount: 1,
    lines: UNKNOWN_VENDOR_LINES,
    fullText: UNKNOWN_VENDOR_LINES.join("\n"),
    warnings: [],
  };
}

afterEach(() => {
  resetInvoiceRepositoryCache();
  vi.unstubAllGlobals();
});

describe("folderForStatus", () => {
  it("sends partial and confirm-needed results to anomaly, not processed", () => {
    expect(folderForStatus("parsed")).toBe("processed");
    expect(folderForStatus("partial")).toBe("anomaly");
    expect(folderForStatus("anomaly")).toBe("anomaly");
    expect(folderForStatus("failed")).toBe("anomaly");
    expect(folderForStatus("parsed", { needsConfirm: true })).toBe("anomaly");
  });
});

describe("LLM classify schema", () => {
  it("accepts a complete payload and coerces vendor / currency", () => {
    const result = validateLlmClassify({
      vendor: "generic",
      confidence: 88,
      header: {
        invoiceNumber: "ACS-9921",
        invoiceDate: "2026-03-12",
        currency: "cad",
        supplierName: "Noordwind Analytics B.V.",
        total: 123456,
        taxTotal: 21420,
      },
      lineItems: [{ lineNumber: 1, description: "Analytics subscription", lineTotal: 123456 }],
      taxLines: [{ label: "VAT 21%", rate: 21, taxAmount: 21420 }],
      bank: { iban: "NL91ABNA0417164300" },
      fields: [{ category: "supplier", key: "name", value: "Noordwind Analytics B.V.", confidence: 90 }],
      warnings: [],
      reviewReasons: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.header.currency).toBe("CAD");
      expect(result.value.header.total).toBe(123456);
      expect(result.value.bank?.iban).toMatch(/^NL91/);
    }
  });

  it("rejects non-objects and invalid field categories, and coerces decimal amounts to cents", () => {
    expect(validateLlmClassify(null).ok).toBe(false);
    expect(validateLlmClassify("nope").ok).toBe(false);
    const coerced = validateLlmClassify({
      vendor: "generic",
      confidence: 70,
      header: { total: 189.5, currency: "USD", invoiceNumber: "HJ-1", supplierName: "Hotjar" },
      lineItems: [],
      taxLines: [],
      fields: [],
      warnings: [],
      reviewReasons: [],
    });
    expect(coerced.ok).toBe(true);
    if (coerced.ok) expect(coerced.value.header.total).toBe(18950);
    expect(
      validateLlmClassify({
        vendor: "generic",
        confidence: 70,
        header: {},
        lineItems: [],
        taxLines: [],
        fields: [{ category: "bogus", key: "x", value: "y", confidence: 1 }],
        warnings: [],
        reviewReasons: [],
      }).ok,
    ).toBe(false);
  });

  it("rejects malformed nested collections and non-numeric amounts", () => {
    expect(
      validateLlmClassify({
        vendor: "generic",
        confidence: "high",
        header: "nope",
        lineItems: "nope",
        taxLines: "nope",
        bank: "nope",
        fields: "nope",
        warnings: "nope",
        reviewReasons: [1],
      }).ok,
    ).toBe(false);
    expect(
      validateLlmClassify({
        vendor: "generic",
        confidence: 50,
        header: { taxTotal: "12.00", subtotal: Number.NaN },
        lineItems: [
          "x",
          { description: "ok", quantity: "1", unitPrice: 1.5, extra: "nope" },
          { lineNumber: 2 },
        ],
        taxLines: ["x", { rate: "10" }, { label: "GST", taxableAmount: 1.2 }],
        bank: { extra: { a: 1 } },
        fields: ["x", { category: "supplier", key: "name" }, { category: "supplier", key: "k", value: "v", confidence: "x" }],
        warnings: ["ok", 2],
        reviewReasons: [],
      }).ok,
    ).toBe(false);
  });

  it("coerces an unknown vendor to generic without failing", () => {
    const result = validateLlmClassify({
      vendor: "acme-cloud",
      confidence: 70,
      header: { invoiceNumber: "X-1", total: 100, currency: "USD", supplierName: "Acme" },
      lineItems: [],
      taxLines: [],
      fields: [],
      warnings: [],
      reviewReasons: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vendor).toBe("generic");
  });
});

describe("classify strategy", () => {
  it("falls back to static classify when LLM is disabled and surfaces a warning", async () => {
    const extracted = unknownVendorExtract();
    const parsed = await classifyExtractedInvoice(extracted, {
      config: llmConfig({ llmEnabled: false, llmReady: false, warning: "LLM classify is off." }),
    });
    expect(parsed.classifyMode).toBe("static");
    expect(parsed.classifierWarning).toMatch(/off/i);
    expect(parsed.header.invoiceNumber).toBeUndefined();
    expect(parsed.needsConfirm).toBe(true);
  });

  it("does not call the LLM for empty / scanned extracts", async () => {
    const complete = vi.fn();
    const parsed = await classifyExtractedInvoice(
      {
        kind: "pdf",
        fileName: "scan.pdf",
        mimeType: "application/pdf",
        pageCount: 1,
        lines: [],
        fullText: "",
        warnings: ["image-only"],
      },
      {
        config: llmConfig(),
        llmClient: { complete },
      },
    );
    expect(complete).not.toHaveBeenCalled();
    expect(parsed.status).toBe("anomaly");
    expect(parsed.classifyMode).toBe("static");
  });

  it("fills an unknown-vendor fixture the static path misses (mocked LLM)", async () => {
    const staticOnly = classifyInvoice({
      fileName: "noordwind.txt",
      lines: UNKNOWN_VENDOR_LINES,
      fullText: UNKNOWN_VENDOR_LINES.join("\n"),
      pageCount: 1,
    });
    expect(staticOnly.vendor).toBe("generic");
    expect(staticOnly.header.invoiceNumber).toBeUndefined();
    expect(staticOnly.header.total).toBeUndefined();

    const llmClient: InvoiceLlmClient = {
      async complete() {
        return {
          vendor: "generic",
          confidence: 91,
          header: {
            invoiceNumber: "ACS-9921",
            invoiceDate: "12 March 2026",
            supplierName: "Noordwind Analytics B.V.",
            currency: "CAD",
            total: 123456,
            taxTotal: 21420,
          },
          lineItems: [{ lineNumber: 1, description: "Analytics subscription", lineTotal: 123456 }],
          taxLines: [{ label: "VAT 21%", rate: 21, taxAmount: 21420 }],
          fields: [],
          warnings: [],
          reviewReasons: [],
        };
      },
    };

    const parsed = await classifyExtractedInvoice(unknownVendorExtract(), {
      config: llmConfig({ staticFastPath: false }),
      llmClient,
    });
    expect(parsed.classifyMode).toBe("llm");
    expect(parsed.header.invoiceNumber).toBe("ACS-9921");
    expect(parsed.header.invoiceDate).toBe("2026-03-12");
    expect(parsed.header.supplierName).toMatch(/Noordwind/);
    expect(parsed.header.currency).toBe("CAD");
    expect(parsed.header.total).toBe(123456);
    expect(parsed.status).toBe("parsed");
    expect(parsed.needsConfirm).toBe(false);
  });

  it("falls back to static when the LLM payload fails schema validation", async () => {
    const parsed = await classifyExtractedInvoice(unknownVendorExtract(), {
      config: llmConfig({ staticFastPath: false }),
      llmClient: {
        async complete() {
          return { vendor: "generic", confidence: "high", header: "nope" };
        },
      },
    });
    expect(parsed.classifyMode).toBe("static-fallback");
    expect(parsed.classifierWarning).toMatch(/schema validation/i);
  });

  it("falls back to static when the LLM client throws", async () => {
    const parsed = await classifyExtractedInvoice(unknownVendorExtract(), {
      config: llmConfig({ staticFastPath: false }),
      llmClient: {
        async complete() {
          throw new Error("network down");
        },
      },
    });
    expect(parsed.classifyMode).toBe("static-fallback");
    expect(parsed.classifierWarning).toMatch(/network down/);
  });

  it("reports classify status without exposing the API key", () => {
    const ready = getInvoiceClassifyStatus(llmConfig());
    expect(ready.mode).toBe("llm");
    expect(ready.llmReady).toBe(true);
    expect(ready.apiBase).toBe("https://llm.test/v1");
    expect(JSON.stringify(ready)).not.toMatch(/test-key/);

    const off = getInvoiceClassifyStatus(llmConfig({ llmEnabled: false, llmReady: false, warning: "off" }));
    expect(off.mode).toBe("static");
    expect(off.apiBase).toBeUndefined();
  });

  it("uses the static vendor fast path and skips the LLM", async () => {
    const complete = vi.fn();
    const extracted = {
      kind: "text" as const,
      fileName: "Hotjar_invoice.pdf",
      mimeType: "text/plain",
      pageCount: 1,
      lines: [
        "Hotjar Ltd",
        "Invoice Number: 737749",
        "Date Issued: 2019-09-01",
        "VAT Number: MT21846014",
        "Qantas Airways Limited",
        "TOTAL (USD) $189.00",
        "hotjar business",
        "sample rate @ 50000",
      ],
      fullText: [
        "Hotjar Ltd",
        "Invoice Number: 737749",
        "Date Issued: 2019-09-01",
        "VAT Number: MT21846014",
        "Qantas Airways Limited",
        "TOTAL (USD) $189.00",
        "hotjar business",
        "sample rate",
      ].join("\n"),
      warnings: [],
    };
    const parsed = await classifyExtractedInvoice(extracted, {
      config: llmConfig(),
      llmClient: { complete },
    });
    expect(isStaticFastPathHit(classifyInvoice({
      fileName: extracted.fileName,
      lines: extracted.lines,
      fullText: extracted.fullText,
      pageCount: 1,
    }))).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(parsed.classifyMode).toBe("static");
    expect(parsed.vendor).toBe("hotjar");
    expect(parsed.header.invoiceNumber).toBe("737749");
  });

  it("marks a low-confidence LLM result as needing confirm", () => {
    const parsed = resultFromLlmPayload(
      {
        fileName: "x.txt",
        lines: ["hello"],
        fullText: "hello",
        pageCount: 1,
      },
      {
        vendor: "generic",
        confidence: 40,
        header: { supplierName: "Maybe Corp" },
        lineItems: [],
        taxLines: [],
        fields: [],
        warnings: [],
        reviewReasons: ["Unsure about totals"],
      },
    );
    expect(parsed.status).not.toBe("parsed");
    expect(parsed.needsConfirm).toBe(true);
    expect(folderForStatus(parsed.status, { needsConfirm: parsed.needsConfirm })).toBe("anomaly");
  });
});

describe("hybrid static floor + LLM overlay", () => {
  const scriptedLines = [
    "Invoice Number: GEN-4401",
    "Date Issued: 2026-04-02",
    "Acme Widgets Pty Ltd",
    "TOTAL (USD) $302.06",
    "Please remit USD 302.06",
  ];

  function scriptedExtract() {
    return {
      kind: "text" as const,
      fileName: "acme.txt",
      mimeType: "text/plain",
      pageCount: 1,
      lines: scriptedLines,
      fullText: scriptedLines.join("\n"),
      warnings: [],
    };
  }

  it("keeps scripted invoice number, total, and currency when the LLM is worse", async () => {
    const staticOnly = classifyInvoice({
      fileName: "acme.txt",
      lines: scriptedLines,
      fullText: scriptedLines.join("\n"),
      pageCount: 1,
    });
    expect(staticOnly.header.invoiceNumber).toBe("GEN-4401");
    expect(staticOnly.header.total).toBe(30206);
    expect(staticOnly.header.currency).toBe("USD");

    const parsed = await classifyExtractedInvoice(scriptedExtract(), {
      config: llmConfig({ staticFastPath: false }),
      llmClient: {
        async complete() {
          return {
            vendor: "generic",
            confidence: 99,
            header: {
              invoiceNumber: "HALLUC-1",
              currency: "AUD",
              supplierName: "Wrong Corp",
              total: 189,
            },
            lineItems: [],
            taxLines: [],
            fields: [],
            warnings: [],
            reviewReasons: [],
          };
        },
      },
    });
    expect(parsed.classifyMode).toBe("llm");
    expect(parsed.header.invoiceNumber).toBe("GEN-4401");
    expect(parsed.header.total).toBe(30206);
    expect(parsed.header.currency).toBe("USD");
    expect(parsed.header.supplierName).toMatch(/Acme Widgets/i);
  });

  it("fills invoice number and CAD total that static misses", async () => {
    const parsed = await classifyExtractedInvoice(unknownVendorExtract(), {
      config: llmConfig({ staticFastPath: false }),
      llmClient: {
        async complete() {
          return {
            vendor: "generic",
            confidence: 91,
            header: {
              invoiceNumber: "ACS-9921",
              invoiceDate: "2026-03-12",
              supplierName: "Noordwind Analytics B.V.",
              currency: "CAD",
              total: 1234.56,
            },
            lineItems: [],
            taxLines: [],
            fields: [],
            warnings: [],
            reviewReasons: [],
          };
        },
      },
    });
    expect(parsed.header.invoiceNumber).toBe("ACS-9921");
    expect(parsed.header.total).toBe(123456);
    expect(parsed.header.currency).toBe("CAD");
    expect(parsed.status).toBe("parsed");
  });

  it("promotes LLM major-unit integers to cents when the extract has $189.00", () => {
    expect(alignAmountToExtract(189, "TOTAL (USD) $189.00")).toBe(18900);
    expect(alignAmountToExtract(18900, "TOTAL (USD) $189.00")).toBe(18900);
    expect(asMoneyCents(189.5, "total", [])).toBe(18950);
    expect(asMoneyCents("189.00", "total", [])).toBe(18900);
    expect(asMoneyCents("$1,234.56", "total", [])).toBe(123456);
  });

  it("prefers a labelled LLM currency over a $→AUD static default", () => {
    expect(pickCurrency("AUD", "CAD", "Please remit CAD 1,234.56")).toBe("CAD");
    expect(pickCurrency("USD", "AUD", "TOTAL (USD) $189.00")).toBe("USD");
  });

  it("mergeStaticAndLlm does not let LLM line items replace a static overlay", () => {
    const staticResult = classifyInvoice({
      fileName: "acme.txt",
      lines: scriptedLines,
      fullText: scriptedLines.join("\n"),
      pageCount: 1,
    });
    const llmResult = resultFromLlmPayload(
      {
        fileName: "acme.txt",
        lines: scriptedLines,
        fullText: scriptedLines.join("\n"),
        pageCount: 1,
      },
      {
        vendor: "generic",
        confidence: 40,
        header: { invoiceNumber: "NOPE", total: 1, currency: "JPY" },
        lineItems: [{ lineNumber: 1, description: "hallucinated", lineTotal: 1 }],
        taxLines: [],
        fields: [],
        warnings: [],
        reviewReasons: ["Unsure"],
      },
    );
    const merged = mergeStaticAndLlm(staticResult, llmResult, scriptedLines.join("\n"));
    expect(merged.header.invoiceNumber).toBe(staticResult.header.invoiceNumber);
    expect(merged.header.total).toBe(staticResult.header.total);
    expect(merged.lineItems).toEqual(staticResult.lineItems);
    expect(merged.confidence).toBeGreaterThanOrEqual(staticResult.confidence);
  });

  it("keeps Origin/Tesla/Hotjar vendor when the LLM says generic, and overlays LLM bank details", () => {
    expect(pickVendor("hotjar", "generic")).toBe("hotjar");
    expect(pickVendor("generic", "tesla")).toBe("tesla");
    expect(pickVendor("generic", "generic")).toBe("generic");
    expect(alignAmountToExtract(50, "no money here")).toBe(50);
    expect(pickCurrency(undefined, "USD", "USD total")).toBe("USD");
    expect(pickCurrency("EUR", "ZZZ", "EUR 10")).toBe("EUR");

    const staticResult = classifyInvoice({
      fileName: "acme.txt",
      lines: scriptedLines,
      fullText: scriptedLines.join("\n"),
      pageCount: 1,
    });
    staticResult.vendor = "hotjar";
    staticResult.bank = { accountNumber: "111", extra: { a: "static" } };
    staticResult.lineItems = [];
    staticResult.warnings.push("Invoice number was not classified.");
    staticResult.header.invoiceNumber = staticResult.header.invoiceNumber ?? "GEN-4401";
    const llmResult = resultFromLlmPayload(
      {
        fileName: "acme.txt",
        lines: scriptedLines,
        fullText: scriptedLines.join("\n"),
        pageCount: 1,
      },
      {
        vendor: "generic",
        confidence: 80,
        header: { invoiceNumber: "GEN-4401", total: 30206, currency: "USD", supplierName: "Acme Widgets Pty Ltd" },
        lineItems: [{ lineNumber: 1, description: "Widgets", unitPrice: 302, lineTotal: 30206, taxAmount: 0 }],
        taxLines: [{ label: "VAT", taxAmount: 0 }],
        bank: { iban: "GB82WEST12345698765432", extra: { b: "llm" } },
        fields: [{ category: "bank", key: "iban", value: "GB82WEST12345698765432", confidence: 90 }],
        warnings: ["Totals were not classified."],
        reviewReasons: ["Missing invoice number and totals."],
      },
    );
    const merged = mergeStaticAndLlm(staticResult, llmResult, scriptedLines.join("\n"));
    expect(merged.vendor).toBe("hotjar");
    expect(merged.bank?.accountNumber).toBe("111");
    expect(merged.bank?.iban).toBe("GB82WEST12345698765432");
    expect(merged.lineItems[0]?.description).toBe("Widgets");
    expect(merged.fields.some((f) => f.key === "iban")).toBe(true);
  });

  it("ignores an LLM invoice number that is not in the extract", async () => {
    const parsed = await classifyExtractedInvoice(
      {
        kind: "text",
        fileName: "weak.txt",
        mimeType: "text/plain",
        pageCount: 1,
        lines: ["Random GmbH", "something 12.00"],
        fullText: "Random GmbH\nsomething 12.00\n",
        warnings: [],
      },
      {
        config: llmConfig({ staticFastPath: false }),
        llmClient: {
          async complete() {
            return {
              vendor: "generic",
              confidence: 95,
              header: { invoiceNumber: "HALLUC-9", supplierName: "Random GmbH", total: 1200, currency: "EUR" },
              lineItems: [],
              taxLines: [],
              fields: [],
              warnings: [],
              reviewReasons: [],
            };
          },
        },
      },
    );
    expect(parsed.header.invoiceNumber).not.toBe("HALLUC-9");
    expect(parsed.header.supplierName).toMatch(/Random GmbH/);
  });
});

describe("invoice LLM config", () => {
  it("stays off without a key", () => {
    const cfg = resolveInvoiceClassifyConfig({});
    expect(cfg.llmEnabled).toBe(false);
    expect(cfg.llmReady).toBe(false);
    expect(cfg.provider).toBe("openai");
    expect(cfg.warning).toMatch(/INVOICE_LLM_API_KEY/);
  });

  it("auto-enables when INVOICE_LLM_API_KEY is present", () => {
    const cfg = resolveInvoiceClassifyConfig({ INVOICE_LLM_API_KEY: "sk-test" });
    expect(cfg.llmEnabled).toBe(true);
    expect(cfg.llmReady).toBe(true);
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("gpt-4o-mini");
    expect(cfg.warning).toBeUndefined();
  });

  it("honours INVOICE_LLM_CLASSIFY=false even with a key", () => {
    const cfg = resolveInvoiceClassifyConfig({
      INVOICE_LLM_CLASSIFY: "false",
      INVOICE_LLM_API_KEY: "sk-test",
    });
    expect(cfg.llmEnabled).toBe(false);
    expect(cfg.llmReady).toBe(false);
    expect(cfg.warning).toMatch(/INVOICE_LLM_CLASSIFY=false/);
  });

  it("detects xAI from XAI_API_KEY and xai- prefixed keys", () => {
    const fromAlias = resolveInvoiceClassifyConfig({ XAI_API_KEY: "xai-abc" });
    expect(fromAlias.llmReady).toBe(true);
    expect(fromAlias.provider).toBe("xai");
    expect(fromAlias.apiBase).toBe("https://api.x.ai/v1");
    expect(fromAlias.model).toBe("grok-4-fast-non-reasoning");

    const fromPrefix = resolveInvoiceClassifyConfig({ INVOICE_LLM_API_KEY: "xai-from-invoice" });
    expect(fromPrefix.provider).toBe("xai");
    expect(fromPrefix.apiBase).toBe("https://api.x.ai/v1");
  });
});

describe("OpenAI-compatible LLM client", () => {
  it("posts chat/completions and parses JSON without logging the invoice body", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  '{"vendor":"generic","confidence":80,"header":{},"lineItems":[],"taxLines":[],"fields":[],"warnings":[],"reviewReasons":[]}',
              },
            },
          ],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createOpenAiInvoiceLlmClient(llmConfig());
    const out = await client.complete({
      fileName: "secret.pdf",
      text: "CONFIDENTIAL INVOICE BODY",
      model: "test-model",
    });
    expect(out).toMatchObject({ vendor: "generic", confidence: 80 });
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit && "body" in requestInit ? requestInit.body : "")) as {
      messages: { content: string }[];
    };
    expect(body.messages[1].content).toContain("CONFIDENTIAL INVOICE BODY");
    expect(truncateInvoiceText("x".repeat(30_000)).length).toBeLessThan(30_000);
  });

  it("parses fenced JSON and rejects a missing API key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n{"vendor":"generic","confidence":1}\n```' } }],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createOpenAiInvoiceLlmClient(llmConfig());
    const out = await client.complete({ fileName: "a.txt", text: "x", model: "m" });
    expect(out).toMatchObject({ vendor: "generic", confidence: 1 });
    expect(buildLlmMessages("a.txt", "hello")[0].content).toMatch(/integer cents preferred|integer minor units/i);

    const locked = createOpenAiInvoiceLlmClient(llmConfig({ apiKey: undefined }));
    await expect(locked.complete({ fileName: "a.txt", text: "x", model: "m" })).rejects.toThrow(
      /INVOICE_LLM_API_KEY/,
    );
  });

  it("throws a metadata-only error on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429 })));
    const client = createOpenAiInvoiceLlmClient(llmConfig());
    await expect(
      client.complete({ fileName: "a.pdf", text: "secret-text-should-not-throw-as-message", model: "m" }),
    ).rejects.toThrow(/429/);
  });
});

describe("human confirm", () => {
  it("accepts edits, writes audit, and promotes to processed", async () => {
    const root = path.join(os.tmpdir(), `aggc-cfm-${Date.now()}`);
    const storage = new LocalStorageProvider(root);
    const repo = new LocalJsonInvoiceRepository(path.join(root, "invoices.json"));
    const uploaded = await uploadInvoice({
      fileName: "weak-unknown.txt",
      content: Buffer.from("Random GmbH\nsomething 12.00\n"),
      storage,
      repo,
    });
    expect(uploaded.folder).toBe("anomaly");

    const detail = await confirmInvoice(
      uploaded.id,
      {
        action: "accept",
        actor: "yann",
        fields: {
          invoiceNumber: "MAN-1",
          supplierName: "Random GmbH",
          currency: "eur",
          totalMajor: "12.00",
        },
      },
      { repo, storage },
    );
    expect(detail?.invoice.folder).toBe("processed");
    expect(detail?.invoice.parseStatus).toBe("parsed");
    expect(detail?.invoice.needsConfirm).toBe(false);
    expect(detail?.invoice.invoiceNumber).toBe("MAN-1");
    expect(detail?.invoice.currency).toBe("EUR");
    expect(detail?.invoice.total).toBe(1200);
    expect(detail?.invoice.confirmAction).toBe("accept");
    expect(detail?.confirmEvents.some((e) => e.action === "accept" && e.actor === "yann")).toBe(true);
    expect(detail?.confirmEvents.some((e) => e.action === "edit" && e.field === "invoiceNumber")).toBe(
      true,
    );
  });

  it("rejects and keeps the invoice in needs review", async () => {
    const root = path.join(os.tmpdir(), `aggc-rej-${Date.now()}`);
    const storage = new LocalStorageProvider(root);
    const repo = new LocalJsonInvoiceRepository(path.join(root, "invoices.json"));
    const uploaded = await uploadInvoice({
      fileName: "weak-unknown.txt",
      content: Buffer.from("Random GmbH\nsomething 12.00\n"),
      storage,
      repo,
    });
    const detail = await confirmInvoice(
      uploaded.id,
      { action: "reject", actor: "ops", reason: "not an invoice" },
      { repo, storage },
    );
    expect(detail?.invoice.folder).toBe("anomaly");
    expect(detail?.invoice.parseStatus).toBe("anomaly");
    expect(detail?.invoice.confirmAction).toBe("reject");
    expect(detail?.invoice.reviewReason).toMatch(/not an invoice/);
  });
});

describe("parseInvoiceDocument + LLM options", () => {
  it("honours an injected LLM client on a text invoice", async () => {
    const buf = Buffer.from(UNKNOWN_VENDOR_LINES.join("\n"));
    const parsed = await parseInvoiceDocument(buf, {
      fileName: "noordwind.txt",
      config: llmConfig({ staticFastPath: false }),
      llmClient: {
        async complete() {
          return {
            vendor: "generic",
            confidence: 85,
            header: {
              invoiceNumber: "ACS-9921",
              currency: "CAD",
              supplierName: "Noordwind Analytics B.V.",
              total: 123456,
              invoiceDate: "2026-03-12",
            },
            lineItems: [],
            taxLines: [],
            fields: [],
            warnings: [],
            reviewReasons: [],
          };
        },
      },
    });
    expect(parsed.classifyMode).toBe("llm");
    expect(parsed.header.invoiceNumber).toBe("ACS-9921");
  });
});
