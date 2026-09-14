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

  it("defaults the invoice prefix", () => {
    expect(getConfig().invoicePrefix).toBe("aggcenter/invoices/");
  });
});
