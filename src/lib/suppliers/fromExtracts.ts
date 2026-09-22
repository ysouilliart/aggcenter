import type { SiteOperatingUnit, Supplier, SupplierSite, SupplierStatus } from "./types";

const SOURCE = "oci-supplier";

function blank(value: string | undefined): string {
  return (value ?? "").trim();
}

/** Oracle extracts emit integer ids as `167497.00000000`. Compare the integer form. */
function idKey(value: string | undefined): string {
  const s = blank(value);
  const match = /^(\d+)\.0+$/.exec(s);
  return match ? match[1] : s;
}

function yn(value: string | undefined): boolean {
  return /^y|yes|true|1$/i.test(blank(value));
}

function statusFrom(inactiveDate: string | undefined): SupplierStatus {
  return blank(inactiveDate) ? "inactive" : "active";
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base || "site";
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function slug(value: string): string {
  const s = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, 40) || "site";
}

function siteKey(supplierNumber: string, siteCode: string): string {
  return `${blank(supplierNumber)}|${blank(siteCode).slice(0, 15).toUpperCase()}`;
}

function vidSidKey(vid: string, sid: string): string {
  return `${blank(vid)}|${blank(sid)}`;
}

function collectVat(rows: Record<string, string>[]): {
  supplierVat: string;
  siteVat: string;
  operatingUnits: SiteOperatingUnit[];
} {
  let supplierVat = "";
  let siteVat = "";
  const operatingUnits: SiteOperatingUnit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!supplierVat && blank(row.supplier_vat)) supplierVat = blank(row.supplier_vat);
    if (!siteVat && blank(row.site_vat)) siteVat = blank(row.site_vat);
    const name = blank(row.operating_unit);
    const orgId = idKey(row.org_id);
    if (!name && !orgId) continue;
    const key = `${name}|${orgId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    operatingUnits.push({ name, orgId });
  }
  return { supplierVat, siteVat, operatingUnits };
}

export interface SupplierExtracts {
  profiles: Record<string, string>[];
  sites: Record<string, string>[];
  addresses: Record<string, string>[];
  vat: Record<string, string>[];
}

export function mapSupplierExtracts(input: SupplierExtracts): {
  suppliers: Supplier[];
  sites: SupplierSite[];
} {
  // Record baseline is the site extract (one row per supplier site).
  // VAT rows overlay supplier/site VAT and the site's operating units.
  // Prefer VID + SID (vendor id and vendor site id). Fall back to supplier
  // number + site code only for VAT rows that do not carry those ids.
  const now = new Date().toISOString();
  const profiles = input.profiles;
  const sites = input.sites;
  const addresses = input.addresses;
  const vatRows = input.vat;

  const profileByVid = new Map<string, Record<string, string>>();
  for (const row of profiles) {
    const vid = idKey(row.vid);
    if (vid) profileByVid.set(vid, row);
  }

  const addressByVidName = new Map<string, Record<string, string>>();
  const addressByVid = new Map<string, Record<string, string>[]>();
  for (const row of addresses) {
    const vid = idKey(row.vid);
    const name = blank(row.address_name).toUpperCase();
    if (vid && name) addressByVidName.set(`${vid}|${name}`, row);
    if (vid) {
      const list = addressByVid.get(vid) ?? [];
      list.push(row);
      addressByVid.set(vid, list);
    }
  }

  const vatByVidSid = new Map<string, Record<string, string>[]>();
  const vatByCode = new Map<string, Record<string, string>[]>();
  const vatByNumber = new Map<string, Record<string, string>[]>();
  const vatByVid = new Map<string, Record<string, string>[]>();
  for (const row of vatRows) {
    const num = blank(row.supplier_number);
    const vid = idKey(row.vid);
    const sid = idKey(row.sid);
    if (num) {
      const listN = vatByNumber.get(num) ?? [];
      listN.push(row);
      vatByNumber.set(num, listN);
    }
    if (vid) {
      const listV = vatByVid.get(vid) ?? [];
      listV.push(row);
      vatByVid.set(vid, listV);
    }
    if (vid && sid) {
      const key = vidSidKey(vid, sid);
      const list = vatByVidSid.get(key) ?? [];
      list.push(row);
      vatByVidSid.set(key, list);
      continue;
    }
    const site = blank(row.vendor_site_code);
    if (num && site) {
      const key = siteKey(num, site);
      const list = vatByCode.get(key) ?? [];
      list.push(row);
      vatByCode.set(key, list);
    }
  }

  const suppliers = new Map<string, Supplier>();
  const outSites: SupplierSite[] = [];
  const usedSiteIds = new Set<string>();

  function upsertSupplier(partial: Omit<Supplier, "version" | "updatedAt"> & { version?: number }): Supplier {
    const existing = suppliers.get(partial.id);
    if (!existing) {
      const created: Supplier = { ...partial, version: 1, updatedAt: now };
      suppliers.set(created.id, created);
      return created;
    }
    const merged: Supplier = {
      ...existing,
      name: existing.name || partial.name,
      supplierNumber: existing.supplierNumber || partial.supplierNumber,
      type: existing.type || partial.type,
      supplierVat: existing.supplierVat || partial.supplierVat,
      taxRegistrationNumber: existing.taxRegistrationNumber || partial.taxRegistrationNumber,
      taxpayerId: existing.taxpayerId || partial.taxpayerId,
      source: existing.source.includes(partial.source)
        ? existing.source
        : `${existing.source},${partial.source}`,
    };
    suppliers.set(merged.id, merged);
    return merged;
  }

  for (const row of sites) {
    const vid = idKey(row.vid);
    const sid = uniqueId(
      idKey(row.sid) || `${vid}-${slug(blank(row.supplier_site))}`,
      usedSiteIds,
    );
    const profile = profileByVid.get(vid);
    const supplierNumber = blank(profile?.supplier_number);
    const address =
      addressByVidName.get(`${vid}|${blank(row.address_name).toUpperCase()}`) ??
      addressByVid.get(vid)?.[0];
    const byIds = vatByVidSid.get(vidSidKey(vid, idKey(row.sid))) ?? [];
    const vatHits = byIds.length
      ? byIds
      : (vatByCode.get(siteKey(supplierNumber, blank(row.supplier_site))) ?? []);
    const vat = collectVat(vatHits);
    const primaryOu = vat.operatingUnits[0];

    const supplier = upsertSupplier({
      id: vid || `N-${supplierNumber}`,
      supplierNumber,
      name: blank(profile?.supplier_name) || blank(row.supplier_name),
      type: blank(profile?.tax_organization_type),
      status: statusFrom(profile?.inactive_date),
      supplierVat:
        vat.supplierVat ||
        blank(profile?.tax_registration_number) ||
        blank(profile?.taxpayer_id),
      taxRegistrationNumber: blank(profile?.tax_registration_number),
      taxpayerId: blank(profile?.taxpayer_id),
      oneTime: yn(profile?.one_time_supplier),
      inactiveDate: blank(profile?.inactive_date) || undefined,
      source: SOURCE,
    });

    outSites.push({
      id: sid,
      supplierId: supplier.id,
      siteCode: blank(row.supplier_site),
      addressName: blank(row.address_name) || blank(address?.address_name),
      procurementBu: blank(row.procurement_bu),
      operatingUnit: primaryOu?.name || undefined,
      orgId: primaryOu?.orgId || undefined,
      operatingUnits: vat.operatingUnits.length ? vat.operatingUnits : undefined,
      inactiveDate: blank(row.inactive_date) || undefined,
      paymentTerms: blank(row.payment_terms),
      payGroup: blank(row.pay_group),
      paymentMethod: blank(row.payment_method),
      invoiceCurrency: blank(row.invoice_currency),
      paymentCurrency: blank(row.payment_currency),
      country: blank(address?.country) || blank(row.country_of_origin),
      addressLine1: blank(address?.address_line_1),
      addressLine2: blank(address?.address_line_2) || undefined,
      city: blank(address?.city),
      state: blank(address?.state) || undefined,
      province: blank(address?.province) || undefined,
      county: blank(address?.county) || undefined,
      postalCode: blank(address?.postal_code),
      siteVat: vat.siteVat || vat.supplierVat,
      email: blank(row.email) || blank(address?.e_mail) || undefined,
      source: SOURCE,
      version: 1,
      updatedAt: now,
    });
  }

  for (const supplier of suppliers.values()) {
    if (supplier.supplierVat) continue;
    const vat = collectVat(
      vatByVid.get(supplier.id) ?? vatByNumber.get(supplier.supplierNumber) ?? [],
    );
    if (vat.supplierVat) supplier.supplierVat = vat.supplierVat;
  }

  return { suppliers: [...suppliers.values()], sites: outSites };
}
