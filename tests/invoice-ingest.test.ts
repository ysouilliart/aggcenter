import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { ingestInvoices, uploadInvoice } from "@/lib/invoices/ingest";
import {
  LocalJsonInvoiceRepository,
  resetInvoiceRepositoryCache,
} from "@/lib/invoices/repository";
import { LocalStorageProvider } from "@/lib/storage/local";
import { getConfig } from "@/lib/config";

const tmp = () => path.join(os.tmpdir(), `aggc-inv-${Date.now()}-${Math.random().toString(16).slice(2)}`);

describe("invoice ingest pipeline", () => {
  afterEach(() => {
    resetInvoiceRepositoryCache();
  });

  it("seeds sample landing files, parses them, and is idempotent", async () => {
    const root = tmp();
    const storage = new LocalStorageProvider(root);
    const repo = new LocalJsonInvoiceRepository(path.join(root, "invoices.json"));
    const first = await ingestInvoices({
      storage,
      repo,
      prefix: "aggcenter/invoices/",
      sampleDir: path.join(process.cwd(), "data/sample/invoices/landing"),
      seedSamples: true,
    });
    expect(first.usedSampleFallback).toBe(true);
    expect(first.ingested.length).toBeGreaterThanOrEqual(5);
    expect(first.ingested.some((r) => r.folder === "anomaly")).toBe(true);
    expect(first.ingested.some((r) => r.folder === "processed")).toBe(true);

    const listed = await storage.list("aggcenter/invoices/");
    expect(listed.some((o) => o.key.includes("/landing/"))).toBe(true);
    expect(listed.some((o) => o.key.includes("/processed/"))).toBe(true);
    expect(listed.some((o) => o.key.includes("/anomaly/"))).toBe(true);

    const second = await ingestInvoices({
      storage,
      repo,
      prefix: "aggcenter/invoices/",
      sampleDir: path.join(process.cwd(), "data/sample/invoices/landing"),
      seedSamples: true,
    });
    expect(second.ingested).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThan(0);

    const invoices = await repo.list();
    const hotjar = invoices.find((i) => i.fileName.includes("Hotjar"));
    expect(hotjar?.invoiceNumber).toBe("737749");
    const detail = await repo.get(hotjar!.id);
    expect(detail?.lineItems.length).toBe(2);
    expect((await repo.summary()).total).toBe(invoices.length);
  });

  it("uploads a CSV invoice into processed", async () => {
    const root = tmp();
    const storage = new LocalStorageProvider(root);
    const repo = new LocalJsonInvoiceRepository(path.join(root, "invoices.json"));
    const csv = Buffer.from(
      "Invoice Number,Invoice Date,Supplier Name,Total,Currency\nINV-CSV,2026-04-01,Csv Corp,80.00,USD\n",
    );
    const invoice = await uploadInvoice({
      fileName: "csv-corp.csv",
      content: csv,
      storage,
      repo,
    });
    expect(invoice.invoiceNumber).toBe("INV-CSV");
    expect(invoice.folder).toBe("processed");
    const again = await uploadInvoice({
      fileName: "csv-corp.csv",
      content: csv,
      storage,
      repo,
    });
    expect(again.id).toBe(invoice.id);
  });

  it("does not seed sample landing files unless opted in", async () => {
    const root = tmp();
    const storage = new LocalStorageProvider(root);
    const repo = new LocalJsonInvoiceRepository(path.join(root, "invoices.json"));
    const result = await ingestInvoices({
      storage,
      repo,
      prefix: "aggcenter/invoices/",
      sampleDir: path.join(process.cwd(), "data/sample/invoices/landing"),
      seedSamples: false,
    });
    expect(result.usedSampleFallback).toBe(false);
    expect(result.ingested).toHaveLength(0);
    expect((await storage.list("aggcenter/invoices/")).some((o) => o.key.includes("/landing/"))).toBe(
      false,
    );
  });

  it("routes a partial parse to needs-review (anomaly) instead of processed", async () => {
    const root = tmp();
    const storage = new LocalStorageProvider(root);
    const repo = new LocalJsonInvoiceRepository(path.join(root, "invoices.json"));
    const invoice = await uploadInvoice({
      fileName: "weak-unknown.txt",
      content: Buffer.from("Random GmbH\nsomething 12.00\n"),
      storage,
      repo,
    });
    expect(invoice.folder).toBe("anomaly");
    expect(["partial", "anomaly"]).toContain(invoice.parseStatus);
    expect(invoice.needsConfirm).toBe(true);
  });

  it("defaults the invoice prefix and classify/seed flags", () => {
    const keys = [
      "INVOICE_PREFIX",
      "INVOICE_SEED_SAMPLES",
      "INVOICE_LLM_CLASSIFY",
      "INVOICE_LLM_API_KEY",
      "INVOICE_LLM_API_BASE",
      "INVOICE_LLM_MODEL",
      "OPENAI_API_KEY",
      "XAI_API_KEY",
    ];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) delete process.env[k];
      expect(getConfig().invoicePrefix).toBe("aggcenter/invoices/");
      expect(getConfig().invoiceSeedSamples).toBe(false);
      expect(getConfig().invoiceClassify.llmEnabled).toBe(false);
      expect(getConfig().invoiceClassify.llmReady).toBe(false);
      expect(getConfig().invoiceClassify.warning).toMatch(/LLM classify is off/i);
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
