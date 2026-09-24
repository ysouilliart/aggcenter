"use client";

import Button from "@mui/material/Button";
import { useState } from "react";

import { Card, ErrorNote, PageHeader, Spinner, SuccessNote, VatCheckBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { parseViesAddress } from "@/lib/suppliers/viesCompare";
import type {
  FieldChange,
  SupplierReviewItem,
  SupplierReviewSite,
  SupplierSite,
  SupplierVatCheck,
} from "@/lib/suppliers/types";
import { useFetch } from "@/lib/useFetch";

function dash(value: string | undefined): string {
  return value?.trim() ? value : "—";
}

function fieldLabel(field: string): string {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function siteHeading(site: SupplierSite, siblings: SupplierSite[]): string {
  const code = site.siteCode.trim() || site.city.trim() || site.addressLine1.trim() || "Site";
  const same = siblings.filter(
    (other) =>
      (other.siteCode.trim() || other.city.trim() || other.addressLine1.trim() || "Site") === code,
  );
  if (same.length <= 1) return code;
  const city = site.city.trim();
  if (city && same.filter((other) => other.city.trim() === city).length === 1) {
    return `${code} · ${city}`;
  }
  const terms = site.paymentTerms.trim();
  if (terms && same.filter((other) => other.paymentTerms.trim() === terms).length === 1) {
    return `${code} · ${terms}`;
  }
  return `${code} · ${site.id}`;
}

function changedSitesOf(item: SupplierReviewItem): SupplierReviewSite[] {
  return item.sites.filter((entry) => entry.changes.length > 0);
}

function changedFieldLabels(item: SupplierReviewItem): string {
  const fields = [
    ...item.changes.map((change) => change.field),
    ...item.sites.flatMap((entry) => entry.changes.map((change) => change.field)),
  ];
  return [...new Set(fields)].map(fieldLabel).join(", ");
}

function listSubtitle(item: SupplierReviewItem): string {
  const changed = changedSitesOf(item);
  if (changed.length > 1) return `${item.supplier.supplierNumber} · ${changed.length} sites`;
  if (changed.length === 1) {
    return `${item.supplier.supplierNumber} · ${dash(changed[0].site.siteCode)}`;
  }
  return item.supplier.supplierNumber;
}

function uniqueSiteVats(item: SupplierReviewItem): string[] {
  return [...new Set(item.sites.map((entry) => entry.site.siteVat.trim()).filter(Boolean))];
}

interface ReviewResponse {
  items: SupplierReviewItem[];
}

export default function SupplierReviewPage() {
  const state = useFetch<ReviewResponse>("/api/suppliers/review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const items = state.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  async function validateIds(ids: string[], scope?: "supplier" | "site") {
    const key = scope && ids.length === 1 ? `${scope}:${ids[0]}` : (scope ?? "batch");
    setChecking(key);
    setBatchError(null);
    setBatchMessage(null);
    try {
      const res = await fetch("/api/suppliers/review/vat-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, actor: "operator", scope }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "VAT check failed");
      const n = (json.checks as SupplierVatCheck[] | undefined)?.length ?? 0;
      const errors = (json.errors as { id: string; error: string }[] | undefined) ?? [];
      setBatchMessage(
        `Checked ${n} VAT ID${n === 1 ? "" : "s"}` +
          (errors.length ? ` · ${errors.length} failed` : "") +
          ".",
      );
      state.reload();
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "VAT check failed");
    } finally {
      setChecking(null);
    }
  }

  const listedSiteIds = items.flatMap((item) => item.sites.map((entry) => entry.site.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0">
        <PageHeader
          className="mb-3"
          title="Final review"
          subtitle="Records updated and streamlined — confirm what changed, then validate VAT IDs against the EU VIES registry"
          actions={
            <Button
              type="button"
              variant="contained"
              size="small"
              onClick={() => validateIds(listedSiteIds)}
              disabled={Boolean(checking) || listedSiteIds.length === 0}
            >
              {checking === "batch" ? "Checking VIES…" : "Validate VAT on listed records"}
            </Button>
          }
        />

        {state.loading ? <Spinner /> : null}
        {state.error ? <ErrorNote message={state.error} /> : null}
        {batchError ? <ErrorNote message={batchError} /> : null}
        {batchMessage ? <SuccessNote message={batchMessage} /> : null}
      </div>

      {items.length === 0 && !state.loading ? (
        <Card>
          <p className="text-sm text-slate-500">
            No updated records yet. Apply corrections on Records, then return here for a
            before/after review and VIES VAT validation.
          </p>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden max-xl:grid-rows-[minmax(12rem,40vh)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,1fr)]">
          <Card className="flex min-h-0 flex-col overflow-hidden p-0">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-xs font-medium text-slate-500">
                    <th className="px-4 py-3 font-medium">Supplier</th>
                    <th className="px-4 py-3 font-medium">Changed</th>
                    <th className="px-4 py-3 font-medium">VAT IDs</th>
                    <th className="px-4 py-3 font-medium">VAT registry</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const isSelected = (selected?.id ?? "") === item.id;
                    const changedCount = changedSitesOf(item).length;
                    const siteVats = uniqueSiteVats(item);
                    return (
                      <tr
                        key={item.id}
                        className={`cursor-pointer ${
                          isSelected ? "bg-brand-soft" : "hover:bg-slate-50"
                        }`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-900">{item.supplier.name}</div>
                          <div className="text-xs text-slate-500">{listSubtitle(item)}</div>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-600">
                          {changedFieldLabels(item)}
                          {changedCount > 1 ? (
                            <div className="mt-0.5 text-[11px] text-slate-400">
                              {changedCount} sites
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-700">
                          <div>Sup {dash(item.supplier.supplierVat)}</div>
                          {siteVats.length > 1 ? (
                            <div>{siteVats.length} site VATs</div>
                          ) : (
                            <div>Site {dash(siteVats[0])}</div>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <VatRegistrySummary sites={item.sites} />
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">
                          {formatDate(item.lastUpdatedAt)}
                          <div>{item.lastActor}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {selected ? (
            <ReviewDetail
              item={selected}
              checking={checking}
              onValidate={(scope, siteId) => validateIds([siteId], scope)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function VatRegistrySummary({ sites }: { sites: SupplierReviewSite[] }) {
  if (sites.length === 0) {
    return <span className="text-xs text-slate-400">No site</span>;
  }
  if (sites.length === 1) {
    const check = sites[0].vatCheck;
    return (
      <>
        <VatCheckBadge validity={check?.validity} />
        {check?.vatScope ? (
          <div className="mt-1 text-[10px] font-medium text-slate-500">{check.vatScope} VAT</div>
        ) : null}
      </>
    );
  }

  const counts = new Map<string, number>();
  for (const entry of sites) {
    const key = entry.vatCheck?.validity ?? "pending";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return (
    <div className="flex flex-col gap-1">
      {[...counts.entries()].map(([validity, count]) => (
        <div key={validity} className="flex items-center gap-1.5">
          <VatCheckBadge validity={validity === "pending" ? undefined : validity} />
          <span className="text-[10px] font-medium text-slate-500">{count}</span>
        </div>
      ))}
    </div>
  );
}

function changeMeta(count: number, reason: string | undefined, actor: string): string {
  return (
    `${count} field update${count === 1 ? "" : "s"}` +
    (reason ? ` · ${reason}` : "") +
    ` · ${actor}`
  );
}

function ReviewDetail({
  item,
  checking,
  onValidate,
}: {
  item: SupplierReviewItem;
  checking: string | null;
  onValidate: (scope: "supplier" | "site", siteId: string) => void;
}) {
  const changedSites = changedSitesOf(item);
  const grouped = item.changes.length > 0 || changedSites.length > 1;
  const siblings = item.sites.map((entry) => entry.site);
  const singleSite = changedSites.length === 1 ? changedSites[0] : item.sites.length === 1 ? item.sites[0] : null;

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden p-0">
      <div className="shrink-0 border-b border-slate-100 px-4 py-2">
        <h2 className="text-[13px] font-medium text-slate-800">{item.supplier.name}</h2>
        <p className="text-xs text-slate-500">
          {changedSites.length > 1
            ? `${item.supplier.supplierNumber} · ${changedSites.length} sites`
            : singleSite
              ? `${item.supplier.supplierNumber} · site ${dash(singleSite.site.siteCode)} · v${singleSite.site.version}`
              : item.supplier.supplierNumber}
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-slate-500">What changed</h3>
          {grouped ? (
            <div className="space-y-3">
              {item.changes.length > 0 ? (
                <ChangeGroup
                  title="Supplier"
                  subtitle={`${item.supplier.supplierNumber} · v${item.supplier.version}`}
                  changes={item.changes}
                  meta={changeMeta(
                    item.headerUpdateCount,
                    item.headerReason,
                    item.headerActor ?? item.lastActor,
                  )}
                />
              ) : null}
              {changedSites.map((entry) => (
                <ChangeGroup
                  key={entry.site.id}
                  title={`Site · ${siteHeading(entry.site, siblings)}`}
                  subtitle={`SID ${entry.site.id} · ${dash(entry.site.city)} ${dash(entry.site.country)} · VAT ${dash(entry.site.siteVat)} · v${entry.site.version}`}
                  changes={entry.changes}
                  meta={changeMeta(entry.updateCount, entry.lastReason, entry.lastActor)}
                />
              ))}
            </div>
          ) : (
            <ChangeList changes={changedSites[0]?.changes ?? item.changes} />
          )}
          <p className="mt-2 text-xs text-slate-400">
            {item.updateCount} field update{item.updateCount === 1 ? "" : "s"}
            {changedSites.length > 1 ? ` across ${changedSites.length} sites` : ""}
            {!grouped && item.lastReason ? ` · ${item.lastReason}` : ""}
            {` · ${item.lastActor}`}
          </p>
        </div>

        <VatSection item={item} checking={checking} onValidate={onValidate} />
      </div>
    </Card>
  );
}

function ChangeGroup({
  title,
  subtitle,
  changes,
  meta,
}: {
  title: string;
  subtitle: string;
  changes: FieldChange[];
  meta: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200">
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
        <div className="text-xs font-semibold text-slate-700">{title}</div>
        <div className="text-[11px] text-slate-500">{subtitle}</div>
      </div>
      <div className="space-y-2 p-3">
        <ChangeList changes={changes} />
        <p className="text-xs text-slate-400">{meta}</p>
      </div>
    </section>
  );
}

function ChangeList({ changes }: { changes: FieldChange[] }) {
  return (
    <ul className="space-y-2">
      {changes.map((change) => (
        <li key={change.field} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <div className="text-xs font-medium text-slate-500">{fieldLabel(change.field)}</div>
          <p className="mt-1 font-mono text-xs text-slate-700">
            <span className="text-rose-700">{change.from || "∅"}</span>
            <span className="mx-1 text-slate-400">→</span>
            <span className="text-emerald-700">{change.to || "∅"}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function VatSection({
  item,
  checking,
  onValidate,
}: {
  item: SupplierReviewItem;
  checking: string | null;
  onValidate: (scope: "supplier" | "site", siteId: string) => void;
}) {
  const siblings = item.sites.map((entry) => entry.site);
  const supplierVat = item.supplier.supplierVat.trim();

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <h3 className="mb-2 text-xs font-semibold text-slate-500">EU VIES VAT check</h3>
      {item.sites.length === 0 ? (
        <p className="text-sm text-slate-500">No site on file to validate.</p>
      ) : (
        <div className="space-y-3">
          {item.sites.map((entry, index) => (
            <SiteVatCheck
              key={entry.site.id}
              entry={entry}
              siblings={siblings}
              supplierVat={supplierVat}
              showSiteLabel={item.sites.length > 1}
              divided={index > 0}
              checking={checking}
              onValidate={onValidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SiteVatCheck({
  entry,
  siblings,
  supplierVat,
  showSiteLabel,
  divided,
  checking,
  onValidate,
}: {
  entry: SupplierReviewSite;
  siblings: SupplierSite[];
  supplierVat: string;
  showSiteLabel: boolean;
  divided: boolean;
  checking: string | null;
  onValidate: (scope: "supplier" | "site", siteId: string) => void;
}) {
  const check = entry.vatCheck;
  const parsed = check?.registeredAddress ? parseViesAddress(check.registeredAddress) : {};
  const siteVat = entry.site.siteVat.trim();
  const supplierKey = `supplier:${entry.site.id}`;
  const siteKey = `site:${entry.site.id}`;

  return (
    <div className={divided ? "border-t border-slate-200 pt-3" : undefined}>
      {showSiteLabel ? (
        <div className="mb-1 text-xs font-medium text-slate-700">
          Site · {siteHeading(entry.site, siblings)}
        </div>
      ) : null}
      <div className="mb-2 flex items-center gap-2">
        <VatCheckBadge validity={check?.validity} />
        {check?.vatScope ? (
          <span className="text-[10px] font-medium text-slate-500">{check.vatScope} VAT</span>
        ) : null}
      </div>
      <p className="font-mono text-xs text-slate-700">
        Supplier {dash(supplierVat)} · Site {dash(siteVat)}
      </p>
      {check ? (
        <div className="mt-2 space-y-1 text-sm text-slate-700">
          <p>
            <span className="text-xs font-medium text-slate-500">
              {check.vatScope ?? "VAT"} check ·{" "}
            </span>
            {check.message}
          </p>
          {check.registeredName ? (
            <p>
              <span className="text-xs font-medium text-slate-500">Registered name · </span>
              {check.registeredName}
              <MatchHint match={check.nameMatch} />
            </p>
          ) : null}
          {check.registeredAddress ? (
            <p>
              <span className="text-xs font-medium text-slate-500">Registered address · </span>
              {check.registeredAddress}
              <MatchHint match={check.addressMatch} />
            </p>
          ) : null}
          {parsed.city || parsed.postalCode ? (
            <p className="text-xs text-slate-500">
              Parsed: {dash(parsed.addressLine1)} · {dash(parsed.postalCode)} {dash(parsed.city)}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">
          Not checked yet. VIES is the official EU VAT registry and returns the name and address
          on file when the member state publishes them.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outlined"
          size="small"
          onClick={() => onValidate("supplier", entry.site.id)}
          disabled={Boolean(checking) || !supplierVat}
        >
          {checking === supplierKey ? "Checking…" : "Validate supplier VAT"}
        </Button>
        <Button
          type="button"
          variant="outlined"
          size="small"
          onClick={() => onValidate("site", entry.site.id)}
          disabled={Boolean(checking) || !siteVat}
        >
          {checking === siteKey ? "Checking…" : "Validate site VAT"}
        </Button>
      </div>
    </div>
  );
}

function MatchHint({ match }: { match: string }) {
  if (match === "match") {
    return <span className="ml-1 text-xs font-medium text-emerald-700">matches record</span>;
  }
  if (match === "mismatch") {
    return <span className="ml-1 text-xs font-medium text-rose-700">differs from record</span>;
  }
  return <span className="ml-1 text-xs text-slate-400">not compared</span>;
}
