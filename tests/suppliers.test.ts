import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { getConfig } from "@/lib/config";
import { assessAddress } from "@/lib/suppliers/address";
import { analyseSuppliers } from "@/lib/suppliers/analyse";
import { mapSupplierExtracts } from "@/lib/suppliers/fromExtracts";
import { ingestSuppliers } from "@/lib/suppliers/ingest";
import { assessRationalisation, canonicalPaymentTerms } from "@/lib/suppliers/rationalise";
import {
  LocalJsonSupplierRepository,
  applyUpdate,
  resetSupplierRepositoryCache,
} from "@/lib/suppliers/repository";
import { LocalStorageProvider } from "@/lib/storage/local";
import { assessVat, normalizeVat, splitVatNumber } from "@/lib/suppliers/vat";
import {
  checkVatWithVies,
  compareTraderDetails,
  parseViesAddress,
  viesEndpoint,
} from "@/lib/suppliers/vies";
import { buildReviewItems, netFieldChanges } from "@/lib/suppliers/review";
import type { Supplier, SupplierAuditEvent, SupplierSite } from "@/lib/suppliers/types";

describe("VAT assessment", () => {
  it("accepts a valid NL number", () => {
    const a = assessVat("NL814016479B01", "NL");
    expect(a.status).toBe("ok");
    expect(a.vatCountry).toBe("NL");
  });

  it("flags missing values", () => {
    expect(assessVat("", "NL").status).toBe("missing");
  });

  it("normalises spacing and suggests the compact form", () => {
    const a = assessVat("FR 92 429 771 363", "FR");
    expect(a.normalized).toBe("FR92429771363");
    expect(a.status).toBe("ok");
    expect(a.suggestion).toBe("FR92429771363");
  });

  it("suggests a country prefix when the body matches", () => {
    const a = assessVat("04024680961", "IT");
    expect(a.status).toBe("missing_prefix");
    expect(a.suggestion).toBe("IT04024680961");
  });

  it("rejects an unrecognisable VAT", () => {
    expect(assessVat("NOT-A-VAT", "DE").status).toBe("invalid_format");
  });

  it("detects prefix vs address country mismatch", () => {
    const a = assessVat("NL814016479B01", "IT");
    expect(a.status).toBe("country_mismatch");
  });

  it("accepts a known GB number", () => {
    expect(assessVat("GB798912755", "GB").status).toBe("ok");
  });

  it("strips punctuation in normalizeVat", () => {
    expect(normalizeVat("PT 503-218.111")).toBe("PT503218111");
  });

  it("splits a prefixed VAT for the VIES request body", () => {
    expect(splitVatNumber("NL814016479B01")).toEqual({
      countryCode: "NL",
      vatNumber: "814016479B01",
    });
  });
});

describe("address assessment", () => {
  it("flags a country-prefixed Italian postcode", () => {
    const issues = assessAddress({
      country: "IT",
      addressLine1: "Viale Vaticano 79",
      city: "Roma",
      postalCode: "IT 00165",
    });
    expect(issues.some((i) => i.kind === "postal_has_country_prefix")).toBe(true);
    expect(issues.find((i) => i.kind === "postal_has_country_prefix")?.suggestion).toBe("00165");
  });

  it("pulls a postcode out of the city field", () => {
    const issues = assessAddress({
      country: "NL",
      addressLine1: "Postbus 29718",
      city: "Den Haag 2502 LS",
      postalCode: "",
    });
    expect(issues.some((i) => i.kind === "city_contains_postal")).toBe(true);
    expect(issues.some((i) => i.kind === "missing_postal" && i.suggestion)).toBe(true);
  });

  it("requires line, city and postal", () => {
    const issues = assessAddress({ country: "DE", addressLine1: "Alexanderplatz 1" });
    expect(issues.map((i) => i.kind)).toEqual(
      expect.arrayContaining(["missing_city", "missing_postal"]),
    );
  });
});

describe("rationalisation", () => {
  it("maps French and German term variants", () => {
    expect(canonicalPaymentTerms("30 jours FM")).toBe("30 Days EOM");
    expect(canonicalPaymentTerms("Sofort")).toBe("Immediate");
    expect(canonicalPaymentTerms("30 TN")).toBe("30 Days");
  });

  it("flags a rare pay group", () => {
    const hits = assessRationalisation({
      payGroup: "ZULIEFERER",
      groupCounts: new Map([
        ["ZULIEFERER", 1],
        ["EUR Prompt", 50],
        ["EUR 30 Days", 40],
      ]),
    });
    expect(hits.some((h) => h.field === "payGroup")).toBe(true);
  });
});

function site(partial: Partial<SupplierSite> & Pick<SupplierSite, "id" | "supplierId">): SupplierSite {
  return {
    siteCode: "SITE",
    addressName: "SITE",
    procurementBu: "BU",
    paymentTerms: "30 Days",
    payGroup: "EUR Prompt",
    paymentMethod: "EFT",
    invoiceCurrency: "EUR",
    paymentCurrency: "EUR",
    country: "NL",
    addressLine1: "Street 1",
    city: "Utrecht",
    postalCode: "3584 BH",
    siteVat: "NL814016479B01",
    source: "test",
    version: 1,
    updatedAt: "2026-09-11T00:00:00.000Z",
    ...partial,
  };
}

function supplier(partial: Partial<Supplier> & Pick<Supplier, "id">): Supplier {
  return {
    supplierNumber: "101774",
    name: "Acme",
    type: "CORPORATION",
    status: "active",
    supplierVat: "NL814016479B01",
    taxRegistrationNumber: "NL814016479B01",
    taxpayerId: "NL814016479B01",
    oneTime: false,
    source: "test",
    version: 1,
    updatedAt: "2026-09-11T00:00:00.000Z",
    ...partial,
  };
}

describe("analyseSuppliers", () => {
  it("scores a clean record with no issues", () => {
    const { records, summary } = analyseSuppliers({
      suppliers: [supplier({ id: "1" })],
      sites: [site({ id: "s1", supplierId: "1" })],
    });
    expect(records[0].issues).toEqual([]);
    expect(summary.recordsWithIssues).toBe(0);
  });

  it("detects missing terms and invalid VAT together", () => {
    const { records, summary } = analyseSuppliers({
      suppliers: [supplier({ id: "1", supplierVat: "NOPE", taxRegistrationNumber: "", taxpayerId: "" })],
      sites: [
        site({
          id: "s1",
          supplierId: "1",
          paymentTerms: "",
          payGroup: "",
          siteVat: "NOPE",
        }),
      ],
    });
    const types = records[0].issues.map((i) => i.type);
    expect(types).toContain("missing_attribute");
    expect(types).toContain("invalid_vat");
    expect(summary.issueCount).toBeGreaterThan(0);
    expect(summary.distributions.paymentTerms[0].value).toBe("");
  });
});

describe("mapSupplierExtracts", () => {
  it("joins profile, site, address and VAT overlay", () => {
    const mapped = mapSupplierExtracts({
      profiles: [
        {
          vid: "1001",
          supplier_name: "CMS",
          supplier_number: "101774",
          tax_organization_type: "CORPORATION",
          taxpayer_id: "",
          tax_registration_number: "",
          one_time_supplier: "N",
          inactive_date: "",
        },
      ],
      sites: [
        {
          vid: "1001",
          sid: "2001",
          supplier_name: "CMS",
          supplier_site: "UTRECHT",
          address_name: "UTRECHT",
          procurement_bu: "ResMed EPN",
          payment_terms: "30 jours FM",
          pay_group: "eur prompt",
          payment_method: "EFT",
          invoice_currency: "EUR",
          payment_currency: "EUR",
          country_of_origin: "NL",
          inactive_date: "",
          email: "",
        },
      ],
      addresses: [
        {
          vid: "1001",
          address_name: "UTRECHT",
          country: "NL",
          address_line_1: "Newtonlaan 203",
          city: "Utrecht",
          postal_code: "3584 BH",
        },
      ],
      vat: [
        {
          supplier_number: "101774",
          vendor_site_code: "UTRECHT",
          supplier_vat: "NL814016479B01",
          site_vat: "NL814016479B01",
          operating_unit: "OU: ResMed EPN",
          supplier_name: "CMS",
        },
      ],
    });
    expect(mapped.suppliers).toHaveLength(1);
    expect(mapped.sites).toHaveLength(1);
    expect(mapped.sites[0].country).toBe("NL");
    expect(mapped.sites[0].paymentTerms).toBe("30 jours FM");
    expect(mapped.suppliers[0].supplierVat).toBe("NL814016479B01");
  });

  it("keeps unmatched VAT-only suppliers", () => {
    const mapped = mapSupplierExtracts({
      profiles: [],
      sites: [],
      addresses: [],
      vat: [
        {
          supplier_number: "28888",
          vendor_site_code: "LONDON",
          supplier_name: "Orphan",
          supplier_vat: "GB798912755",
          site_vat: "GB798912755",
          operating_unit: "OU: ResMed EPN",
          supplier_status: "Active",
        },
      ],
    });
    expect(mapped.suppliers).toHaveLength(1);
    expect(mapped.sites[0].id).toContain("VAT-28888");
    expect(mapped.suppliers[0].supplierVat).toBe("GB798912755");
  });

  it("disambiguates VAT site ids that slug to the same value", () => {
    const mapped = mapSupplierExtracts({
      profiles: [],
      sites: [],
      addresses: [],
      vat: [
        {
          supplier_number: "32233",
          vendor_site_code: "Saint Priest",
          supplier_name: "Dup",
          supplier_vat: "FR92429771363",
          site_vat: "",
          operating_unit: "OU: ResMed EPN",
        },
        {
          supplier_number: "32233",
          vendor_site_code: "Saint-Priest",
          supplier_name: "Dup",
          supplier_vat: "FR92429771363",
          site_vat: "",
          operating_unit: "OU: ResMed EPN - Italy",
        },
      ],
    });
    const ids = mapped.sites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("applyUpdate + local repository", () => {
  const file = path.join(os.tmpdir(), `suppliers-${Date.now()}.json`);
  const repo = new LocalJsonSupplierRepository(file);

  afterEach(async () => {
    resetSupplierRepositoryCache();
  });

  it("snapshots the previous version and writes field audit", async () => {
    await repo.replaceWorkingCopy({
      suppliers: [supplier({ id: "1" })],
      sites: [site({ id: "s1", supplierId: "1" })],
      files: [{ key: "supplier/profile.csv", rows: 1 }],
    });
    const updated = await repo.updateRecord("s1", {
      fields: { paymentTerms: "30 Days EOM", city: "Amsterdam" },
      actor: "tester",
      reason: "standardise terms",
    });
    expect(updated.site.paymentTerms).toBe("30 Days EOM");
    expect(updated.site.version).toBe(2);
    expect(updated.audit).toHaveLength(2);
    const versions = await repo.listVersions("site", "s1");
    expect(versions[0].version).toBe(1);
    expect((versions[0].snapshot as SupplierSite).paymentTerms).toBe("30 Days");
    const audit = await repo.listAudit("s1");
    expect(audit.some((e) => e.field === "paymentTerms" && e.newValue === "30 Days EOM")).toBe(
      true,
    );
  });

  it("persists a VIES VAT check against a site", async () => {
    await repo.replaceWorkingCopy({
      suppliers: [supplier({ id: "1" })],
      sites: [site({ id: "s1", supplierId: "1" })],
      files: [],
    });
    await repo.saveVatCheck({
      id: "VATCHK-1",
      siteId: "s1",
      supplierId: "1",
      vatNumber: "NL814016479B01",
      countryCode: "NL",
      validity: "valid",
      registeredName: "CMS DERKS STAR BUSMANN N.V.",
      registeredAddress: "PARNASSUSWEG 00737 / 1077DG AMSTERDAM",
      nameMatch: "unknown",
      addressMatch: "mismatch",
      message: "VAT ID is registered in VIES as CMS DERKS STAR BUSMANN N.V.",
      actor: "tester",
      createdAt: "2026-09-11T12:00:00.000Z",
    });
    const checks = await repo.listVatChecks("s1");
    expect(checks).toHaveLength(1);
    expect(checks[0].registeredName).toMatch(/CMS DERKS/);
  });

  it("applyUpdate throws when nothing changed", () => {
    expect(() =>
      applyUpdate(supplier({ id: "1" }), site({ id: "s1", supplierId: "1" }), {
        fields: { paymentTerms: "30 Days" },
      }),
    ).toThrow(/No changes/);
  });
});

describe("ingestSuppliers", () => {
  it("reads CSVs from a storage prefix", async () => {
    const root = path.join(os.tmpdir(), `sup-store-${Date.now()}`);
    const storage = new LocalStorageProvider(root);
    const repo = new LocalJsonSupplierRepository(
      path.join(os.tmpdir(), `sup-repo-${Date.now()}.json`),
    );
    await storage.put(
      "supplier/Supplier_Profile_EBS_Extract.csv",
      Buffer.from(
        "VID,SUPPLIER_NAME,SUPPLIER_NUMBER,TAX_ORGANIZATION_TYPE,TAXPAYER_ID,TAX_REGISTRATION_NUMBER,ONE_TIME_SUPPLIER,INACTIVE_DATE\n1,Acme,10,CORPORATION,NL814016479B01,NL814016479B01,N,\n",
      ),
    );
    await storage.put(
      "supplier/Supplier_Site_EBS_Extract.csv",
      Buffer.from(
        "VID,SID,SUPPLIER_NAME,ADDRESS_NAME,SUPPLIER_SITE,PROCUREMENT_BU,PAYMENT_TERMS,PAY_GROUP,PAYMENT_METHOD,INVOICE_CURRENCY,PAYMENT_CURRENCY,COUNTRY_OF_ORIGIN,INACTIVE_DATE,EMAIL\n1,2,Acme,HQ,HQ,BU,30 Days,EUR Prompt,EFT,EUR,EUR,NL,,\n",
      ),
    );
    await storage.put(
      "supplier/Supplier_Address_EBS_Extract.csv",
      Buffer.from(
        "VID,SID,SUPPLIER_NAME,ADDRESS_NAME,COUNTRY,ADDRESS_LINE_1,CITY,POSTAL_CODE\n1,1,Acme,HQ,NL,Street 1,Utrecht,3584 BH\n",
      ),
    );
    await storage.put(
      "supplier/SupplierSiteVATID.csv",
      Buffer.from(
        "OPERATING_UNIT,SUPPLIER_NUMBER,SUPPLIER_NAME,SUPPLIER_VAT,VENDOR_SITE_CODE,SITE_VAT\nOU,10,Acme,NL814016479B01,HQ,NL814016479B01\n",
      ),
    );

    const result = await ingestSuppliers({ storage, repo, prefix: "supplier/" });
    expect(result.suppliers).toBe(1);
    expect(result.sites).toBe(1);
    expect(result.files).toHaveLength(4);
    const sites = await repo.listSites();
    expect(sites[0].city).toBe("Utrecht");
  });
});

describe("review grouping", () => {
  it("nets repeated edits on the same field to original → current", () => {
    const events: SupplierAuditEvent[] = [
      {
        id: "a1",
        recordType: "site",
        recordId: "s1",
        action: "update",
        field: "paymentTerms",
        oldValue: "30 jours FM",
        newValue: "30 Days",
        actor: "op",
        createdAt: "2026-09-11T10:00:00.000Z",
        version: 2,
      },
      {
        id: "a2",
        recordType: "site",
        recordId: "s1",
        action: "update",
        field: "paymentTerms",
        oldValue: "30 Days",
        newValue: "30 Days EOM",
        actor: "op",
        createdAt: "2026-09-11T11:00:00.000Z",
        version: 3,
      },
    ];
    expect(netFieldChanges(events)).toEqual([
      { field: "paymentTerms", from: "30 jours FM", to: "30 Days EOM" },
    ]);
  });

  it("builds one review row per updated site including header changes", () => {
    const items = buildReviewItems({
      suppliers: [supplier({ id: "1", name: "Acme NV", version: 2 })],
      sites: [
        site({ id: "s1", supplierId: "1", paymentTerms: "30 Days EOM", version: 2 }),
        site({ id: "s2", supplierId: "1", siteCode: "OTHER" }),
      ],
      audit: [
        {
          id: "a1",
          recordType: "site",
          recordId: "s1",
          action: "update",
          field: "paymentTerms",
          oldValue: "30 jours FM",
          newValue: "30 Days EOM",
          actor: "operator",
          reason: "standardise terms",
          createdAt: "2026-09-11T10:00:00.000Z",
          version: 2,
        },
        {
          id: "a2",
          recordType: "supplier",
          recordId: "1",
          action: "update",
          field: "name",
          oldValue: "Acme",
          newValue: "Acme NV",
          actor: "operator",
          createdAt: "2026-09-11T10:00:01.000Z",
          version: 2,
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("s1");
    expect(items[0].changes.map((c) => c.field).sort()).toEqual(["name", "paymentTerms"]);
  });
});

describe("VIES client", () => {
  it("compares registered name and address locally", () => {
    const match = compareTraderDetails(
      {
        name: "CMS Derks Star Busmann",
        street: "Newtonlaan 203",
        city: "Utrecht",
        postalCode: "3584 BH",
      },
      {
        name: "CMS DERKS STAR BUSMANN N.V.",
        address: "PARNASSUSWEG 00737 / 1077DG AMSTERDAM",
      },
    );
    expect(match.nameMatch).toBe("match");
    expect(match.addressMatch).toBe("mismatch");
  });

  it("parses a Dutch VIES address blob", () => {
    const parsed = parseViesAddress("PARNASSUSWEG 00737 / 1077DG AMSTERDAM");
    expect(parsed.postalCode?.replace(/\s+/g, "")).toBe("1077DG");
    expect(parsed.city).toMatch(/AMSTERDAM/i);
    expect(parsed.addressLine1).toMatch(/PARNASSUSWEG/i);
  });

  it("does not call VIES for GB numbers", async () => {
    let called = false;
    const result = await checkVatWithVies(
      { countryCode: "GB", vatNumber: "798912755" },
      {
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
      },
    );
    expect(called).toBe(false);
    expect(result.status).toBe("unsupported");
  });

  it("maps a valid VIES payload to registered name and address", async () => {
    const result = await checkVatWithVies(
      {
        countryCode: "NL",
        vatNumber: "814016479B01",
        traderName: "CMS Derks",
        traderStreet: "Newtonlaan 203",
        traderCity: "Utrecht",
        traderPostalCode: "3584 BH",
      },
      {
        fetchImpl: async (input, init) => {
          expect(String(input)).toBe(viesEndpoint("https://vies.test"));
          expect(init?.method).toBe("POST");
          const body = JSON.parse(String(init?.body));
          expect(body).toMatchObject({ countryCode: "NL", vatNumber: "814016479B01" });
          return new Response(
            JSON.stringify({
              valid: true,
              name: "CMS DERKS STAR BUSMANN N.V.",
              address: "PARNASSUSWEG 00737 / 1077DG AMSTERDAM",
              requestDate: "2026-09-11T12:00:00.000Z",
              traderNameMatch: "NOT_PROCESSED",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
        baseUrl: "https://vies.test",
      },
    );
    expect(result.status).toBe("valid");
    expect(result.registeredName).toBe("CMS DERKS STAR BUSMANN N.V.");
    expect(result.nameMatch).toBe("match");
    expect(result.addressMatch).toBe("mismatch");
  });

  it("treats member-state outages as inconclusive", async () => {
    const result = await checkVatWithVies(
      { countryCode: "FR", vatNumber: "92429771363" },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ actionSucceed: false, errorWrappers: [{ error: "MS_UNAVAILABLE" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        baseUrl: "https://vies.test",
      },
    );
    expect(result.status).toBe("inconclusive");
    expect(result.message).toMatch(/MS_UNAVAILABLE/);
  });
});

describe("config", () => {
  it("defaults supplier prefix to supplier/", () => {
    expect(getConfig().supplierPrefix).toBe("supplier/");
  });

  it("defaults VIES to the official EU REST API", () => {
    expect(getConfig().viesApiUrl).toBe("https://ec.europa.eu/taxation_customs/vies/rest-api");
  });
});
