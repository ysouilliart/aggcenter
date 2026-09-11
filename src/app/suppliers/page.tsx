"use client";

import { useState } from "react";

import {
  Card,
  DistributionList,
  ErrorNote,
  KpiCard,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { SupplierSummary } from "@/lib/suppliers/types";
import { formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

export default function SupplierOverviewPage() {
  const summary = useFetch<SupplierSummary>("/api/suppliers/summary");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/suppliers/ingest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      setSyncMessage(
        `Loaded ${json.suppliers} suppliers / ${json.sites} sites from ${json.provider}` +
          (json.usedSampleFallback ? " (sample fallback)" : "") +
          `. ${json.files.length} file(s).`,
      );
      summary.reload();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const data = summary.data;

  return (
    <div>
      <PageHeader
        title="Supplier workspace"
        subtitle="Master-data quality: missing attributes, VAT format, address checks, and rationalisation of terms / group / type"
        actions={
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {syncing ? "Loading…" : "Load from bucket"}
          </button>
        }
      />

      {summary.loading ? <Spinner /> : null}
      {summary.error ? <ErrorNote message={summary.error} /> : null}
      {syncMessage ? (
        <p className="mb-4 text-sm text-slate-600">{syncMessage}</p>
      ) : null}

      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Suppliers" value={String(data.supplierCount)} />
            <KpiCard label="Sites" value={String(data.siteCount)} />
            <KpiCard
              label="Records with issues"
              value={String(data.recordsWithIssues)}
              tone="amber"
            />
            <KpiCard
              label="Findings"
              value={String(data.issueCount)}
              tone="negative"
              sub={`${data.bySeverity.high} high · ${data.bySeverity.medium} medium · ${data.bySeverity.low} low`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-4">
            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Issue types</h2>
              <DistributionList
                items={[
                  { value: "Missing attribute", count: data.byType.missing_attribute },
                  { value: "VAT ID", count: data.byType.invalid_vat },
                  { value: "Address", count: data.byType.invalid_address },
                  { value: "Rationalise", count: data.byType.rationalise },
                ]}
              />
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Payment terms</h2>
              <DistributionList items={data.distributions.paymentTerms.slice(0, 8)} />
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Pay group</h2>
              <DistributionList items={data.distributions.payGroup.slice(0, 8)} />
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Supplier type</h2>
              <DistributionList items={data.distributions.type.slice(0, 8)} />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Country</h2>
              <DistributionList items={data.distributions.country.slice(0, 12)} />
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Payment method</h2>
              <DistributionList items={data.distributions.paymentMethod.slice(0, 8)} />
              <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Source files</h3>
                {data.files.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Nothing loaded yet. Click <strong>Load from bucket</strong> to
                    ingest <code>supplier/</code> extracts from OCI.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-600">
                    {data.files.map((f) => (
                      <li key={f.key} className="flex justify-between gap-3">
                        <span className="truncate font-mono text-xs">{f.key}</span>
                        <span className="tabular-nums text-slate-500">{f.rows} rows</span>
                      </li>
                    ))}
                  </ul>
                )}
                {data.ingestedAt ? (
                  <p className="mt-2 text-xs text-slate-400">
                    Last ingest {formatDate(data.ingestedAt)}
                  </p>
                ) : null}
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
