import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InvoiceClassifyConfig } from "@/lib/config";
import { getConfig, resolveInvoiceClassifyConfig, resolvePeopleDocsClassifyConfig } from "@/lib/config";
import { folderForPeopleDocStatus } from "@/lib/peopleDocs/fromParse";
import {
  ingestPeopleDocs,
  reprocessPeopleDoc,
  uploadPeopleDoc,
} from "@/lib/peopleDocs/ingest";
import {
  LocalJsonPeopleDocRepository,
  resetPeopleDocRepositoryCache,
} from "@/lib/peopleDocs/repository";
import { classifyPeopleDoc, parseYesNo } from "@/lib/parse/peopleDocs/classify";
import { mergeStaticAndLlmPeopleDoc } from "@/lib/parse/peopleDocs/merge";
import { classifyExtractedPeopleDoc } from "@/lib/parse/peopleDocs/strategy";
import { validatePeopleDocLlm } from "@/lib/parse/peopleDocs/schema";
import { parsePeopleDocument } from "@/lib/parse/peopleDocs";
import { LocalStorageProvider } from "@/lib/storage/local";

const FULL_LINES = [
  "ResMed Ltd",
  "Agreement ID: AGR-2026-0441",
  "Requestor: Jamie Chen",
  "Agreement type: Employment",
  "Agreement Sub type: Individual contractor",
  "Business Function: People",
  "ResMed Entity: ResMed Pty Ltd",
  "Agreement start date: 1 July 2026",
  "Agreement end date: 30 June 2027",
  "Auto renew: Yes",
  "Perpetual: No",
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

afterEach(() => {
  resetPeopleDocRepositoryCache();
  vi.unstubAllGlobals();
});

describe("people doc static classify", () => {
  it("extracts labelled HR agreement fields", () => {
    const parsed = classifyPeopleDoc({
      fileName: "resmed-employment-agreement.txt",
      lines: FULL_LINES,
      fullText: FULL_LINES.join("\n"),
      pageCount: 1,
    });
    expect(parsed.header.agreementId).toBe("AGR-2026-0441");
    expect(parsed.header.requestor).toMatch(/Jamie Chen/);
    expect(parsed.header.agreementType).toBe("Employment");
    expect(parsed.header.agreementSubType).toMatch(/contractor/i);
    expect(parsed.header.businessFunction).toBe("People");
    expect(parsed.header.resmedEntity).toMatch(/ResMed Pty Ltd/);
    expect(parsed.header.startDate).toBe("2026-07-01");
    expect(parsed.header.endDate).toBe("2027-06-30");
    expect(parsed.header.autoRenew).toBe(true);
    expect(parsed.header.perpetual).toBe(false);
    expect(parsed.status).toBe("parsed");
    expect(parsed.fields).toHaveLength(10);
    expect(parsed.fields.every((f) => f.value)).toBe(true);
  });

  it("sends a partial policy to anomaly / needs confirm", () => {
    const parsed = classifyPeopleDoc({
      fileName: "policy.txt",
      lines: ["Requestor: Alex Kim", "Agreement type: Policy", "ResMed Entity: ResMed Inc"],
      fullText: "Requestor: Alex Kim\nAgreement type: Policy\nResMed Entity: ResMed Inc\n",
      pageCount: 1,
    });
    expect(parsed.header.agreementId).toBeUndefined();
    expect(parsed.needsConfirm).toBe(true);
    expect(folderForPeopleDocStatus(parsed.status, { needsConfirm: parsed.needsConfirm })).toBe(
      "anomaly",
    );
  });

  it("parses yes/no flags", () => {
    expect(parseYesNo("Yes")).toBe(true);
    expect(parseYesNo("N")).toBe(false);
    expect(parseYesNo("maybe")).toBeUndefined();
  });

  it("does not treat ordinary words as an agreement ID", () => {
    const parsed = classifyPeopleDoc({
      fileName: "NDA Mutual General - Global.docx",
      lines: [
        "Non-Disclosure Agreement – Mutual - General",
        "Effective Date: July 1, 2026",
        "Parties:",
        "ResMed Pty Ltd, 1 Elizabeth Macarthur Drive",
      ],
      fullText:
        "Non-Disclosure Agreement – Mutual - General\nEffective Date: July 1, 2026\nParties:\nResMed Pty Ltd, 1 Elizabeth Macarthur Drive, Bella Vista\nThis agreement. Either party may be a discloser of confidential information. The agency of the parties is not an ID.\n",
      pageCount: 1,
    });
    expect(parsed.header.agreementId).toBeUndefined();
    expect(parsed.header.agreementType).toBe("NDA");
    expect(parsed.header.resmedEntity).toMatch(/ResMed Pty Ltd/);
    expect(parsed.header.startDate).toBe("2026-07-01");
  });

  it("treats a perpetual agreement as complete without an end date", () => {
    const parsed = classifyPeopleDoc({
      fileName: "offer-letter.txt",
      lines: [
        "Agreement ID: AGR-P-1",
        "Requestor: Pat Lee",
        "Agreement type: Offer Letter",
        "ResMed Entity: ResMed Inc",
        "Agreement start date: 1 January 2026",
        "Perpetual: Yes",
      ],
      fullText:
        "Agreement ID: AGR-P-1\nRequestor: Pat Lee\nAgreement type: Offer Letter\nResMed Entity: ResMed Inc\nAgreement start date: 1 January 2026\nPerpetual: Yes\n",
      pageCount: 1,
    });
    expect(parsed.header.perpetual).toBe(true);
    expect(parsed.header.endDate).toBeUndefined();
    expect(parsed.reviewReasons.some((r) => /end date/i.test(r))).toBe(false);
  });
});

describe("people doc LLM schema and overlay", () => {
  it("accepts a complete payload and coerces booleans", () => {
    const result = validatePeopleDocLlm({
      confidence: 88,
      header: {
        agreementId: "AGR-9",
        requestor: "Pat Lee",
        autoRenew: "yes",
        perpetual: false,
      },
      warnings: [],
      reviewReasons: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.header.autoRenew).toBe(true);
      expect(result.value.header.perpetual).toBe(false);
    }
  });

  it("rejects non-objects", () => {
    expect(validatePeopleDocLlm(null).ok).toBe(false);
    expect(validatePeopleDocLlm("nope").ok).toBe(false);
    expect(validatePeopleDocLlm({ confidence: 1, header: "x", warnings: [], reviewReasons: [] }).ok).toBe(
      false,
    );
  });

  it("fills agreement ID that static misses and keeps scripted type", async () => {
    const extracted = {
      kind: "text" as const,
      fileName: "nda.txt",
      mimeType: "text/plain",
      pageCount: 1,
      lines: ["NDA AGR-HIDDEN-22", "ResMed Ltd", "Requestor: Sam Ortiz"],
      fullText: "NDA AGR-HIDDEN-22\nResMed Ltd\nRequestor: Sam Ortiz\nAgreement type: NDA\n",
      warnings: [],
    };
    const parsed = await classifyExtractedPeopleDoc(extracted, {
      config: llmConfig(),
      llmClient: {
        async complete() {
          return {
            confidence: 90,
            header: {
              agreementId: "AGR-HIDDEN-22",
              requestor: "Wrong Name",
              agreementType: "Policy",
              resmedEntity: "ResMed Ltd",
            },
            warnings: [],
            reviewReasons: [],
          };
        },
      },
    });
    expect(parsed.classifyMode).toBe("llm");
    expect(parsed.header.agreementId).toBe("AGR-HIDDEN-22");
    expect(parsed.header.requestor).toMatch(/Sam Ortiz/);
    expect(parsed.header.agreementType).toBe("NDA");
  });

  it("falls back to static when the LLM throws", async () => {
    const parsed = await classifyExtractedPeopleDoc(
      {
        kind: "text",
        fileName: "x.txt",
        mimeType: "text/plain",
        pageCount: 1,
        lines: FULL_LINES,
        fullText: FULL_LINES.join("\n"),
        warnings: [],
      },
      {
        config: llmConfig(),
        llmClient: {
          async complete() {
            throw new Error("network down");
          },
        },
      },
    );
    expect(parsed.classifyMode).toBe("static-fallback");
    expect(parsed.header.agreementId).toBe("AGR-2026-0441");
  });

  it("does not call the LLM for empty extracts", async () => {
    const complete = vi.fn();
    const parsed = await classifyExtractedPeopleDoc(
      {
        kind: "pdf",
        fileName: "scan.pdf",
        mimeType: "application/pdf",
        pageCount: 1,
        lines: [],
        fullText: "",
        warnings: ["image-only"],
      },
      { config: llmConfig(), llmClient: { complete } },
    );
    expect(complete).not.toHaveBeenCalled();
    expect(parsed.status).toBe("anomaly");
  });

  it("falls back when LLM output fails schema validation", async () => {
    const parsed = await classifyExtractedPeopleDoc(
      {
        kind: "text",
        fileName: "x.txt",
        mimeType: "text/plain",
        pageCount: 1,
        lines: FULL_LINES,
        fullText: FULL_LINES.join("\n"),
        warnings: [],
      },
      {
        config: llmConfig(),
        llmClient: {
          async complete() {
            return { confidence: "high" };
          },
        },
      },
    );
    expect(parsed.classifyMode).toBe("static-fallback");
    expect(parsed.header.agreementId).toBe("AGR-2026-0441");
  });

  it("fills dates and flags the static parser missed when the extract supports them", () => {
    const staticResult = classifyPeopleDoc({
      fileName: "gap.txt",
      lines: ["Requestor: Sam Ortiz", "Agreement type: NDA", "ResMed Entity: ResMed Ltd"],
      fullText:
        "Requestor: Sam Ortiz\nAgreement type: NDA\nResMed Entity: ResMed Ltd\nThe term begins 15 March 2026 and expires 15 March 2027.\nThe agreement does not renew automatically and is not perpetual.\n",
      pageCount: 1,
    });
    expect(staticResult.header.startDate).toBeUndefined();
    expect(staticResult.header.autoRenew).toBeUndefined();
    const merged = mergeStaticAndLlmPeopleDoc(
      staticResult,
      {
        startDate: "2026-03-15",
        endDate: "15 March 2027",
        autoRenew: false,
        perpetual: false,
        agreementId: "NOT-IN-TEXT",
      },
      91,
      [],
      [],
      staticResult.extractedText,
    );
    expect(merged.header.agreementId).toBeUndefined();
    expect(merged.header.startDate).toBe("2026-03-15");
    expect(merged.header.endDate).toBe("2027-03-15");
    expect(merged.header.autoRenew).toBe(false);
    expect(merged.header.perpetual).toBe(false);
    expect(merged.classifyMode).toBe("llm");
  });
});

describe("people doc ingest", () => {
  const tmp = () => path.join(os.tmpdir(), `aggc-pd-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  it("seeds samples, parses them, and is idempotent", async () => {
    const root = tmp();
    const storage = new LocalStorageProvider(root);
    const repo = new LocalJsonPeopleDocRepository(path.join(root, "people-docs.json"));
    const first = await ingestPeopleDocs({
      storage,
      repo,
      prefix: "aggcenter/peopleDocs/",
      sampleDir: path.join(process.cwd(), "data/sample/people-docs/landing"),
      seedSamples: true,
    });
    expect(first.usedSampleFallback).toBe(true);
    expect(first.ingested.length).toBeGreaterThanOrEqual(2);
    expect(first.ingested.some((r) => r.folder === "processed")).toBe(true);
    expect(first.ingested.some((r) => r.folder === "anomaly")).toBe(true);

    const second = await ingestPeopleDocs({
      storage,
      repo,
      prefix: "aggcenter/peopleDocs/",
      sampleDir: path.join(process.cwd(), "data/sample/people-docs/landing"),
      seedSamples: true,
    });
    expect(second.ingested).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThan(0);

    const docs = await repo.list();
    const employment = docs.find((d) => d.fileName.includes("employment"));
    expect(employment?.agreementId).toBe("AGR-2026-0441");
    expect((await repo.summary()).total).toBe(docs.length);
  });

  it("uploads a text agreement and reprocesses it", async () => {
    const root = tmp();
    const storage = new LocalStorageProvider(root);
    const repo = new LocalJsonPeopleDocRepository(path.join(root, "people-docs.json"));
    const doc = await uploadPeopleDoc({
      fileName: "full.txt",
      content: Buffer.from(FULL_LINES.join("\n")),
      storage,
      repo,
    });
    expect(doc.folder).toBe("processed");
    expect(doc.agreementId).toBe("AGR-2026-0441");
    const again = await reprocessPeopleDoc(doc.id, { storage, repo });
    expect(again?.id).toBe(doc.id);
    expect(again?.agreementId).toBe("AGR-2026-0441");
  });

  it("resolves people-docs LLM independently of invoice classify", () => {
    expect(getConfig().peopleDocsPrefix).toBe("aggcenter/peopleDocs/");
    expect(getConfig().peopleDocsSeedSamples).toBe(false);

    const unset = resolvePeopleDocsClassifyConfig({});
    expect(unset.llmReady).toBe(false);
    expect(unset.warning).toMatch(/PEOPLE_DOCS_LLM_API_KEY/i);

    const invoiceOnPeopleOff = {
      INVOICE_LLM_API_KEY: "sk-inv",
      PEOPLE_DOCS_LLM_CLASSIFY: "false",
    };
    expect(resolveInvoiceClassifyConfig(invoiceOnPeopleOff).llmReady).toBe(true);
    expect(resolveInvoiceClassifyConfig(invoiceOnPeopleOff).apiKey).toBe("sk-inv");
    const peopleOff = resolvePeopleDocsClassifyConfig(invoiceOnPeopleOff);
    expect(peopleOff.llmReady).toBe(false);
    expect(peopleOff.llmEnabled).toBe(false);
    expect(peopleOff.warning).toMatch(/PEOPLE_DOCS_LLM_CLASSIFY=false/i);

    const dedicated = resolvePeopleDocsClassifyConfig({
      INVOICE_LLM_API_KEY: "sk-inv",
      PEOPLE_DOCS_LLM_API_KEY: "sk-hr",
      PEOPLE_DOCS_LLM_MODEL: "hr-model",
      PEOPLE_DOCS_LLM_API_BASE: "https://llm.hr.test/v1",
      PEOPLE_DOCS_LLM_TIMEOUT_MS: "12000",
    });
    expect(dedicated.llmReady).toBe(true);
    expect(dedicated.apiKey).toBe("sk-hr");
    expect(dedicated.model).toBe("hr-model");
    expect(dedicated.apiBase).toBe("https://llm.hr.test/v1");
    expect(dedicated.timeoutMs).toBe(12_000);
    expect(resolveInvoiceClassifyConfig({
      INVOICE_LLM_API_KEY: "sk-inv",
      PEOPLE_DOCS_LLM_API_KEY: "sk-hr",
    }).apiKey).toBe("sk-inv");

    const fallback = resolvePeopleDocsClassifyConfig({
      INVOICE_LLM_API_KEY: "sk-inv",
    });
    expect(fallback.llmReady).toBe(true);
    expect(fallback.apiKey).toBe("sk-inv");

    const invoiceClassifyOff = {
      INVOICE_LLM_API_KEY: "sk-inv",
      INVOICE_LLM_CLASSIFY: "false",
    };
    expect(resolveInvoiceClassifyConfig(invoiceClassifyOff).llmReady).toBe(false);
    expect(resolvePeopleDocsClassifyConfig(invoiceClassifyOff).llmReady).toBe(true);
    expect(resolvePeopleDocsClassifyConfig(invoiceClassifyOff).apiKey).toBe("sk-inv");

    const peopleOnly = {
      PEOPLE_DOCS_LLM_API_KEY: "sk-hr-only",
    };
    expect(resolveInvoiceClassifyConfig(peopleOnly).llmReady).toBe(false);
    expect(resolvePeopleDocsClassifyConfig(peopleOnly).llmReady).toBe(true);
    expect(resolvePeopleDocsClassifyConfig(peopleOnly).apiKey).toBe("sk-hr-only");
  });
});

describe("parsePeopleDocument", () => {
  it("posts chat/completions without logging document text", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"confidence":80,"header":{},"warnings":[],"reviewReasons":[]}' } }],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { createOpenAiPeopleDocLlmClient, truncatePeopleDocText } = await import(
      "@/lib/parse/peopleDocs/llm"
    );
    const client = createOpenAiPeopleDocLlmClient(llmConfig());
    const out = await client.complete({ fileName: "hr.txt", text: "CONFIDENTIAL HR", model: "m" });
    expect(out).toMatchObject({ confidence: 80 });
    expect(fetchMock).toHaveBeenCalled();
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit && "body" in requestInit ? requestInit.body : "")) as {
      messages: { content: string }[];
    };
    expect(body.messages[1].content).toContain("CONFIDENTIAL HR");
    expect(truncatePeopleDocText("x".repeat(30_000)).length).toBeLessThan(30_000);
  });

  it("parses fenced JSON, rejects a missing key, and throws metadata-only HTTP errors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n{"confidence":11,"header":{},"warnings":[],"reviewReasons":[]}\n```' } }],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { createOpenAiPeopleDocLlmClient } = await import("@/lib/parse/peopleDocs/llm");
    const client = createOpenAiPeopleDocLlmClient(llmConfig());
    const out = await client.complete({ fileName: "a.txt", text: "x", model: "m" });
    expect(out).toMatchObject({ confidence: 11 });

    const locked = createOpenAiPeopleDocLlmClient(llmConfig({ apiKey: undefined }));
    await expect(locked.complete({ fileName: "a.txt", text: "secret-hr", model: "m" })).rejects.toThrow(
      /PEOPLE_DOCS_LLM_API_KEY/,
    );

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429 })));
    const failing = createOpenAiPeopleDocLlmClient(llmConfig());
    await expect(
      failing.complete({ fileName: "a.txt", text: "secret-hr-should-not-be-in-error", model: "m" }),
    ).rejects.toThrow(/429/);
  });

  it("parses a text buffer", async () => {
    const parsed = await parsePeopleDocument(Buffer.from(FULL_LINES.join("\n")), {
      fileName: "full.txt",
      config: llmConfig({ llmReady: false, llmEnabled: false, warning: "off" }),
    });
    expect(parsed.header.agreementId).toBe("AGR-2026-0441");
    expect(parsed.classifyMode).toBe("static");
  });
});
