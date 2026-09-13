import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/parse/csv";
import { LocalStorageProvider } from "@/lib/storage/local";
import { loadSupplierExtractFiles } from "@/lib/suppliers/extractFiles";
import {
  FBDI_ZIP_NAME,
  buildSupplierFbdi,
  buildSupplierFbdiFrom,
  isFbdiDownloadKey,
  listSupplierFbdiPackages,
  parseFbdiCsv,
  saveSupplierFbdi,
} from "@/lib/suppliers/fbdi";
import { mapSupplierExtracts } from "@/lib/suppliers/fromExtracts";
import {
  LocalJsonSupplierRepository,
  resetSupplierRepositoryCache,
} from "@/lib/suppliers/repository";
import type { Supplier, SupplierAuditEvent, SupplierSite } from "@/lib/suppliers/types";
import { unzipStore } from "@/lib/zip";

const SAMPLE = path.join(process.cwd(), "data", "sample", "suppliers");

async function sampleExtracts() {
  const { promises: fs } = await import("fs");
  const [profiles, sites, addresses, vat] = await Promise.all([
    fs.readFile(path.join(SAMPLE, "Supplier_Profile_EBS_Extract.csv"), "utf8").then(parseCsv),
    fs.readFile(path.join(SAMPLE, "Supplier_Site_EBS_Extract.csv"), "utf8").then(parseCsv),
    fs.readFile(path.join(SAMPLE, "Supplier_Address_EBS_Extract.csv"), "utf8").then(parseCsv),
    fs.readFile(path.join(SAMPLE, "SupplierSiteVATID.csv"), "utf8").then(parseCsv),
  ]);
  return { profiles, sites, addresses, vat };
}

function byNumber(rows: Record<string, string>[], number: string) {
  return rows.find((r) => r["supplier number"] === number || r.supplier_number === number);
}

describe("supplier FBDI builder", () => {
  it("overlays corrections onto source extracts and keeps extra EBS columns", async () => {
    const extracts = await sampleExtracts();
    extracts.profiles[0].duns_number = "123456789";
    const mapped = mapSupplierExtracts(extracts);
    const prompt = mapped.suppliers.find((s) => s.supplierNumber === "102002")!;
    const promptSite = mapped.sites.find((s) => s.supplierId === prompt.id)!;
    prompt.type = "CORPORATION";
    promptSite.paymentTerms = "Immediate";
    promptSite.paymentMethod = "CHECK";
    promptSite.city = "Berlin";
    promptSite.postalCode = "10178";

    const built = buildSupplierFbdiFrom(
      { suppliers: mapped.suppliers, sites: mapped.sites, extracts },
      { batchId: "AGGC-TEST", now: new Date("2026-09-13T00:17:00Z") },
    );

    expect(built.counts.suppliers).toBe(5);
    expect(built.counts.sites).toBe(5);
    expect(built.counts.overlayed).toBeGreaterThan(0);

    const suppliers = parseFbdiCsv(built.files.find((f) => f.name === "POZ_SUPPLIERS_INT.csv")!.csv);
    const sites = parseFbdiCsv(built.files.find((f) => f.name === "POZ_SUPPLIER_SITES_INT.csv")!.csv);
    const addresses = parseFbdiCsv(built.files.find((f) => f.name === "POZ_SUP_ADDRESSES_INT.csv")!.csv);
    const assignments = parseFbdiCsv(
      built.files.find((f) => f.name === "POZ_SITE_ASSIGNMENTS_INT.csv")!.csv,
    );

    const promptHeader = byNumber(suppliers, "102002")!;
    expect(promptHeader["import action"]).toBe("CREATE");
    expect(promptHeader["batch id"]).toBe("AGGC-TEST");
    expect(promptHeader["business relationship"]).toBe("SPEND_AUTHORIZED");
    expect(promptHeader["tax organization type"]).toBe("CORPORATION");
    expect(promptHeader["taxpayer country"]).toBe("DE");
    expect(promptHeader["one time supplier flag"]).toBe("N");

    const cms = byNumber(suppliers, "101774")!;
    expect(cms["duns number"]).toBe("123456789");
    expect(cms["tax registration number"]).toBe("NL814016479B01");
    expect(cms["business relationship"]).toBe("SPEND_AUTHORIZED");

    const promptSiteRow = sites.find((r) => r["supplier site"] === "BERLIN")!;
    expect(promptSiteRow["payment terms"]).toBe("Immediate");
    expect(promptSiteRow["pay group"]).toBe(promptSite.payGroup);
    expect(promptSiteRow["purchasing"]).toBe("Y");

    const promptAddr = addresses.find((r) => r["address name"] === "BERLIN")!;
    expect(promptAddr["address line 1"]).toBe("Alexanderplatz 1");
    expect(promptAddr.city).toBe("Berlin");
    expect(promptAddr["postal code"]).toBe("10178");
    expect(promptAddr.country).toBe("DE");

    const promptAssign = assignments.find((r) => r["supplier site"] === "BERLIN")!;
    expect(promptAssign["client bu"]).toBe("ResMed EPN");
    expect(promptAssign["bill-to bu"]).toBe("ResMed EPN");

    expect(
      built.overlays.some((o) => o.field === "payment_terms" && o.to === "Immediate"),
    ).toBe(true);
    expect(
      built.overlays.some(
        (o) => o.field === "tax_organization_type" && o.to === "CORPORATION",
      ),
    ).toBe(true);
    expect(built.overlays.some((o) => o.field === "city" && o.to === "Berlin")).toBe(true);
  });

  it("keeps source-only site columns while overlaying edited fields", () => {
    const extracts = {
      profiles: [
        {
          vid: "1",
          supplier_name: "Acme",
          supplier_number: "10",
          tax_organization_type: "Corp.",
          taxpayer_id: "NL814016479B01",
          tax_registration_number: "NL814016479B01",
          one_time_supplier: "N",
          duns_number: "111222333",
          pay_each_document_alone: "N",
        },
      ],
      sites: [
        {
          vid: "1",
          sid: "2",
          supplier_name: "Acme",
          address_name: "HQ",
          supplier_site: "HQ",
          procurement_bu: "ResMed EPN",
          payment_terms: "Sofort",
          pay_group: "EUR Prompt",
          payment_method: "eft",
          invoice_currency: "EUR",
          payment_currency: "EUR",
          purchasing: "Y",
          pay: "Y",
          primary_pay: "Y",
          invoice_match_option: "P",
          payment_priority: "99",
          terms_date_basis: "Invoice",
        },
      ],
      addresses: [
        {
          vid: "1",
          sid: "1",
          supplier_name: "Acme",
          address_name: "HQ",
          country: "NL",
          address_line_1: "Street 1",
          city: "",
          postal_code: "3584 BH",
          rfq_or_bidding: "N",
          ordering: "Y",
          pay: "Y",
        },
      ],
      vat: [
        {
          supplier_number: "10",
          supplier_vat: "NL814016479B01",
          vendor_site_code: "HQ",
          site_vat: "NL814016479B01",
        },
      ],
    };
    const mapped = mapSupplierExtracts(extracts);
    mapped.suppliers[0].type = "CORPORATION";
    mapped.sites[0].paymentTerms = "Immediate";
    mapped.sites[0].paymentMethod = "EFT";
    mapped.sites[0].city = "Utrecht";

    const built = buildSupplierFbdiFrom(
      { suppliers: mapped.suppliers, sites: mapped.sites, extracts },
      { batchId: "AGGC-SRC" },
    );
    const suppliers = parseFbdiCsv(built.files.find((f) => f.name === "POZ_SUPPLIERS_INT.csv")!.csv);
    const sites = parseFbdiCsv(built.files.find((f) => f.name === "POZ_SUPPLIER_SITES_INT.csv")!.csv);
    const addresses = parseFbdiCsv(built.files.find((f) => f.name === "POZ_SUP_ADDRESSES_INT.csv")!.csv);

    expect(suppliers[0]["duns number"]).toBe("111222333");
    expect(suppliers[0]["pay each document alone"]).toBe("N");
    expect(suppliers[0]["tax organization type"]).toBe("CORPORATION");
    expect(sites[0]["payment terms"]).toBe("Immediate");
    expect(sites[0]["pay group"]).toBe("EUR Prompt");
    expect(sites[0]["purchasing"]).toBe("Y");
    expect(sites[0]["invoice match option"]).toBe("P");
    expect(sites[0]["payment priority"]).toBe("99");
    expect(sites[0]["terms date basis"]).toBe("Invoice");
    expect(addresses[0].city).toBe("Utrecht");
    expect(addresses[0]["rfq or bidding"]).toBe("N");
    expect(addresses[0].ordering).toBe("Y");
  });

  it("synthesizes Fusion rows for working-copy records with no source extract", async () => {
    const extracts = await sampleExtracts();
    const mapped = mapSupplierExtracts(extracts);
    const newbie: Supplier = {
      id: "N-999001",
      supplierNumber: "999001",
      name: "New Co Ltd",
      type: "CORPORATION",
      status: "active",
      supplierVat: "GB798912755",
      taxRegistrationNumber: "GB798912755",
      taxpayerId: "GB798912755",
      oneTime: false,
      source: "manual",
      version: 1,
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    const newbieSite: SupplierSite = {
      id: "SITE-999001",
      supplierId: newbie.id,
      siteCode: "LONDON",
      addressName: "LONDON",
      procurementBu: "ResMed UK",
      paymentTerms: "30 Days",
      payGroup: "GBP Prompt",
      paymentMethod: "BACS",
      invoiceCurrency: "GBP",
      paymentCurrency: "GBP",
      country: "GB",
      addressLine1: "1 New Street",
      city: "London",
      postalCode: "EC1A 1BB",
      siteVat: "GB798912755",
      source: "manual",
      version: 1,
      updatedAt: "2026-09-13T00:00:00.000Z",
    };

    const built = buildSupplierFbdiFrom(
      {
        suppliers: [...mapped.suppliers, newbie],
        sites: [...mapped.sites, newbieSite],
        extracts,
      },
      { scope: "new", batchId: "AGGC-NEW" },
    );

    expect(built.counts.suppliers).toBe(1);
    expect(built.counts.synthesized).toBeGreaterThan(0);
    const suppliers = parseFbdiCsv(built.files.find((f) => f.name === "POZ_SUPPLIERS_INT.csv")!.csv);
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0]["supplier name"]).toBe("New Co Ltd");
    expect(suppliers[0]["tax registration number"]).toBe("GB798912755");
    expect(suppliers[0]["taxpayer country"]).toBe("GB");
    const sites = parseFbdiCsv(built.files.find((f) => f.name === "POZ_SUPPLIER_SITES_INT.csv")!.csv);
    expect(sites[0]["supplier site"]).toBe("LONDON");
    expect(sites[0]["payment method"]).toBe("BACS");
    expect(sites[0]["tax registration number"]).toBe("GB798912755");
  });

  it("limits changed scope to suppliers with update audits (plus new)", async () => {
    const extracts = await sampleExtracts();
    const mapped = mapSupplierExtracts(extracts);
    const cms = mapped.suppliers.find((s) => s.supplierNumber === "101774")!;
    const cmsSite = mapped.sites.find((s) => s.supplierId === cms.id)!;
    cmsSite.paymentTerms = "14 Days";
    const audit: SupplierAuditEvent[] = [
      {
        id: "a1",
        recordType: "site",
        recordId: cmsSite.id,
        action: "update",
        field: "paymentTerms",
        oldValue: "30 Days",
        newValue: "14 Days",
        actor: "op",
        createdAt: "2026-09-13T00:00:00.000Z",
        version: 2,
      },
    ];

    const built = buildSupplierFbdiFrom(
      { suppliers: mapped.suppliers, sites: mapped.sites, audit, extracts },
      { scope: "changed", batchId: "AGGC-CHG" },
    );
    const suppliers = parseFbdiCsv(built.files.find((f) => f.name === "POZ_SUPPLIERS_INT.csv")!.csv);
    expect(suppliers.map((r) => r["supplier number"])).toEqual(["101774"]);
    const sites = parseFbdiCsv(built.files.find((f) => f.name === "POZ_SUPPLIER_SITES_INT.csv")!.csv);
    expect(sites[0]["payment terms"]).toBe("14 Days");
  });

  it("packages Fusion worksheets into a STORE zip", async () => {
    const extracts = await sampleExtracts();
    const mapped = mapSupplierExtracts(extracts);
    const built = buildSupplierFbdiFrom(
      { suppliers: mapped.suppliers, sites: mapped.sites, extracts },
      { batchId: "AGGC-ZIP" },
    );
    const entries = unzipStore(built.zip);
    expect(entries.map((e) => e.name).sort()).toEqual(
      [
        "POZ_SITE_ASSIGNMENTS_INT.csv",
        "POZ_SUPPLIERS_INT.csv",
        "POZ_SUPPLIER_SITES_INT.csv",
        "POZ_SUP_ADDRESSES_INT.csv",
      ].sort(),
    );
    const header = entries.find((e) => e.name === "POZ_SUPPLIERS_INT.csv")!.data.toString("utf8");
    expect(header.startsWith("Import Action,Batch ID,Supplier Name")).toBe(true);
  });
});

describe("save + list FBDI packages", () => {
  afterEach(() => {
    resetSupplierRepositoryCache();
  });

  it("writes ZIP, CSVs and manifest under aggcenter/FBDI/supplier/<batch>/", async () => {
    const root = path.join(os.tmpdir(), `fbdi-store-${Date.now()}`);
    const storage = new LocalStorageProvider(root);
    const repo = new LocalJsonSupplierRepository(path.join(os.tmpdir(), `fbdi-repo-${Date.now()}.json`));
    const extracts = await sampleExtracts();
    const mapped = mapSupplierExtracts(extracts);
    await repo.replaceWorkingCopy({
      suppliers: mapped.suppliers,
      sites: mapped.sites,
      files: [{ key: "supplier/Supplier_Profile_EBS_Extract.csv", rows: extracts.profiles.length }],
    });
    await storage.put(
      "supplier/Supplier_Profile_EBS_Extract.csv",
      Buffer.from(
        "VID,SUPPLIER_NAME,SUPPLIER_NUMBER,TAX_ORGANIZATION_TYPE,TAXPAYER_ID,TAX_REGISTRATION_NUMBER,ONE_TIME_SUPPLIER,DUNS_NUMBER,PAY_EACH_DOCUMENT_ALONE\n1001,CMS,101774,CORPORATION,NL814016479B01,NL814016479B01,N,123456789,N\n",
      ),
    );
    await storage.put(
      "supplier/Supplier_Site_EBS_Extract.csv",
      Buffer.from(
        "VID,SID,SUPPLIER_NAME,ADDRESS_NAME,SUPPLIER_SITE,PROCUREMENT_BU,PAYMENT_TERMS,PAY_GROUP,PAYMENT_METHOD,INVOICE_CURRENCY,PAYMENT_CURRENCY,PURCHASING,PAY,PRIMARY_PAY\n1001,2001,CMS,UTRECHT,UTRECHT,ResMed EPN,30 Days,EUR Prompt,EFT,EUR,EUR,Y,Y,Y\n",
      ),
    );
    await storage.put(
      "supplier/Supplier_Address_EBS_Extract.csv",
      Buffer.from(
        "VID,SID,SUPPLIER_NAME,ADDRESS_NAME,COUNTRY,ADDRESS_LINE_1,CITY,POSTAL_CODE,RFQ_OR_BIDDING,ORDERING,PAY\n1001,1001,CMS,UTRECHT,NL,Newtonlaan 203,Utrecht,3584 BH,N,Y,Y\n",
      ),
    );

    const saved = await saveSupplierFbdi({
      storage,
      repo,
      sourcePrefix: "supplier/",
      outputPrefix: "aggcenter/FBDI/supplier/",
      batchId: "AGGC-20260913-001700",
      now: new Date("2026-09-13T00:17:00Z"),
      actor: "tester",
    });

    expect(saved.saved.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        "aggcenter/FBDI/supplier/AGGC-20260913-001700/PozSupplierImport.zip",
        "aggcenter/FBDI/supplier/AGGC-20260913-001700/POZ_SUPPLIERS_INT.csv",
        "aggcenter/FBDI/supplier/AGGC-20260913-001700/manifest.json",
        "aggcenter/FBDI/supplier/AGGC-20260913-001700/overlay-report.csv",
      ]),
    );
    const zip = await storage.get(
      "aggcenter/FBDI/supplier/AGGC-20260913-001700/PozSupplierImport.zip",
    );
    expect(unzipStore(zip).some((e) => e.name === "POZ_SUPPLIERS_INT.csv")).toBe(true);

    const listed = await listSupplierFbdiPackages({
      storage,
      prefix: "aggcenter/FBDI/supplier/",
    });
    expect(listed.packages).toHaveLength(1);
    expect(listed.packages[0].batchId).toBe("AGGC-20260913-001700");
    expect(listed.packages[0].actor).toBe("tester");
    expect(listed.packages[0].counts?.suppliers).toBeGreaterThan(0);
  });

  it("buildSupplierFbdi falls back to sample extracts when the prefix is empty", async () => {
    const storage = new LocalStorageProvider(path.join(os.tmpdir(), `fbdi-empty-${Date.now()}`));
    const repo = new LocalJsonSupplierRepository(
      path.join(os.tmpdir(), `fbdi-empty-repo-${Date.now()}.json`),
    );
    const built = await buildSupplierFbdi({
      storage,
      repo,
      sourcePrefix: "supplier/",
      outputPrefix: "aggcenter/FBDI/supplier/",
      batchId: "AGGC-SAMPLE",
    });
    expect(built.usedSampleFallback).toBe(true);
    expect(built.counts.suppliers).toBeGreaterThan(0);
    expect(built.sourceFiles.some((f) => f.key.includes("Supplier_Profile"))).toBe(true);
  });
});

describe("FBDI helpers", () => {
  it("only allows download keys under the FBDI prefix", () => {
    expect(isFbdiDownloadKey("aggcenter/FBDI/supplier/x/a.zip", "aggcenter/FBDI/supplier/")).toBe(
      true,
    );
    expect(isFbdiDownloadKey("supplier/profile.csv", "aggcenter/FBDI/supplier/")).toBe(false);
  });

  it("names the upload zip PozSupplierImport.zip", () => {
    expect(FBDI_ZIP_NAME).toBe("PozSupplierImport.zip");
  });
});

describe("loadSupplierExtractFiles", () => {
  it("is reused by ingest and FBDI", async () => {
    const root = path.join(os.tmpdir(), `extracts-${Date.now()}`);
    const storage = new LocalStorageProvider(root);
    await storage.put(
      "supplier/Supplier_Profile_EBS_Extract.csv",
      Buffer.from("VID,SUPPLIER_NAME,SUPPLIER_NUMBER\n1,Acme,10\n"),
    );
    const loaded = await loadSupplierExtractFiles({ storage, prefix: "supplier/" });
    expect(loaded.profiles).toHaveLength(1);
    expect(loaded.profiles[0].supplier_name).toBe("Acme");
  });
});
