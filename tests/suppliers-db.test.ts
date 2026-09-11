import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { analyseSuppliers } from "@/lib/suppliers/analyse";
import { PostgresSupplierRepository } from "@/lib/suppliers/repository";
import type { Supplier, SupplierSite } from "@/lib/suppliers/types";

const run = describe.skipIf(!process.env.DATABASE_URL);

const supplier: Supplier = {
  id: "SUP-test-1",
  supplierNumber: "T-1",
  name: "Test Supplier",
  type: "CORPORATION",
  status: "active",
  supplierVat: "NL814016479B01",
  taxRegistrationNumber: "NL814016479B01",
  taxpayerId: "NL814016479B01",
  oneTime: false,
  source: "test",
  version: 1,
  updatedAt: "2026-09-11T00:00:00.000Z",
};

const site: SupplierSite = {
  id: "SITE-test-1",
  supplierId: "SUP-test-1",
  siteCode: "HQ",
  addressName: "HQ",
  procurementBu: "Test BU",
  paymentTerms: "30 jours FM",
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
};

async function cleanup() {
  const { getDb } = await import("@/lib/db/client");
  const { sql } = await import("drizzle-orm");
  await getDb().execute(
    sql.raw(`
      DELETE FROM "aggc-supplier"."supplier_audit_events"
        WHERE record_id IN ('SITE-test-1', 'SUP-test-1')
           OR actor IN ('tester-suppliers-db', 'ingest-suppliers-db');
      DELETE FROM "aggc-supplier"."supplier_record_versions"
        WHERE record_id IN ('SITE-test-1', 'SUP-test-1');
      DELETE FROM "aggc-supplier"."supplier_sites" WHERE id = 'SITE-test-1';
      DELETE FROM "aggc-supplier"."suppliers" WHERE id = 'SUP-test-1';
    `),
  );
}

run("PostgresSupplierRepository (aggc-supplier schema)", () => {
  const repo = new PostgresSupplierRepository();

  beforeEach(async () => {
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
  });

  it("persists versions and audit on update without wiping other rows", async () => {
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const db = getDb();
    await db.insert(schema.suppliers).values({
      id: supplier.id,
      supplierNumber: supplier.supplierNumber,
      name: supplier.name,
      type: supplier.type,
      status: supplier.status,
      supplierVat: supplier.supplierVat,
      taxRegistrationNumber: supplier.taxRegistrationNumber,
      taxpayerId: supplier.taxpayerId,
      oneTime: "N",
      source: supplier.source,
      version: supplier.version,
      updatedAt: supplier.updatedAt,
    });
    await db.insert(schema.supplierSites).values({
      id: site.id,
      supplierId: site.supplierId,
      siteCode: site.siteCode,
      addressName: site.addressName,
      procurementBu: site.procurementBu,
      paymentTerms: site.paymentTerms,
      payGroup: site.payGroup,
      paymentMethod: site.paymentMethod,
      invoiceCurrency: site.invoiceCurrency,
      paymentCurrency: site.paymentCurrency,
      country: site.country,
      addressLine1: site.addressLine1,
      city: site.city,
      postalCode: site.postalCode,
      siteVat: site.siteVat,
      source: site.source,
      version: site.version,
      updatedAt: site.updatedAt,
    });

    const listed = await repo.listSites();
    expect(listed.some((s) => s.id === "SITE-test-1")).toBe(true);

    const updated = await repo.updateRecord("SITE-test-1", {
      fields: { paymentTerms: "30 Days EOM" },
      actor: "tester-suppliers-db",
      reason: "standardise",
    });
    expect(updated.site.paymentTerms).toBe("30 Days EOM");
    expect(updated.site.version).toBe(2);

    const versions = await repo.listVersions("site", "SITE-test-1");
    expect(versions[0].version).toBe(1);
    const audit = await repo.listAudit("SITE-test-1");
    expect(audit[0].field).toBe("paymentTerms");

    const analysed = analyseSuppliers({
      suppliers: [updated.supplier],
      sites: [updated.site],
    });
    expect(analysed.records[0].issues.some((i) => i.field === "paymentTerms")).toBe(false);
  });
});
