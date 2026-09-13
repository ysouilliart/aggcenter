"use client";

import { useMemo, useState } from "react";

import { Card, ErrorNote, KpiCard, PageHeader, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { FbdiImportAction, FbdiSavedPackage, FbdiScope } from "@/lib/suppliers/fbdi";
import { useFetch } from "@/lib/useFetch";

interface PreviewPayload {
  batchId: string;
  createdAt: string;
  actor: string;
  scope: FbdiScope;
  importAction: FbdiImportAction;
  businessRelationship: string;
  prefix: string;
  provider: string;
  usedSampleFallback: boolean;
  sourceFiles: { key: string; rows: number }[];
  sourceErrors: { key: string; error: string }[];
  counts: {
    suppliers: number;
    addresses: number;
    sites: number;
    assignments: number;
    overlayed: number;
    synthesized: number;
  };
  overlayCount: number;
  overlays: {
    sheet: string;
    key: string;
    field: string;
    from: string;
    to: string;
  }[];
  files: { name: string; rows: number }[];
  zip: string;
  preview: {
    suppliers: Record<string, string>[];
    sites: Record<string, string>[];
    addresses: Record<string, string>[];
  };
}

interface FbdiResponse {
  preview: PreviewPayload;
  provider: string;
  prefix: string;
  packages: FbdiSavedPackage[];
}

const SCOPES: { id: FbdiScope; label: string }[] = [
  { id: "all", label: "All records" },
  { id: "changed", label: "Changed + new" },
  { id: "new", label: "New only" },
];

const ACTIONS: { id: FbdiImportAction; label: string }[] = [
  { id: "UPDATE", label: "UPDATE" },
  { id: "CREATE", label: "CREATE" },
];

function suggestedImportAction(scope: FbdiScope): FbdiImportAction {
  return scope === "new" ? "CREATE" : "UPDATE";
}

function dash(value: string | undefined): string {
  return value?.trim() ? value : "—";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SupplierFbdiPage() {
  const [scope, setScope] = useState<FbdiScope>("all");
  const [importAction, setImportAction] = useState<FbdiImportAction>("UPDATE");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams({ scope, importAction });
    return `/api/suppliers/fbdi?${params.toString()}`;
  }, [scope, importAction]);

  const state = useFetch<FbdiResponse>(url);
  const preview = state.data?.preview;
  const packages = state.data?.packages ?? [];

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/suppliers/fbdi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, importAction, actor: "operator" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      const zip = (json.saved as { name: string; key: string }[] | undefined)?.find((f) =>
        f.name.endsWith(".zip"),
      );
      setMessage(
        `Saved ${json.counts?.suppliers ?? 0} suppliers / ${json.counts?.sites ?? 0} sites to ${json.prefix}${json.batchId}/` +
          (zip ? ` (${zip.name})` : ""),
      );
      state.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Supplier FBDI"
        subtitle="Build Oracle Fusion Import Suppliers templates from the EBS extracts plus rationalised corrections. UPDATE is the normal action for cutover and cleanup (suppliers already in Fusion); save under aggcenter/FBDI/supplier/ for upload."
        actions={
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !preview}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Build and save to bucket"}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setScope(s.id);
                setImportAction(suggestedImportAction(s.id));
              }}
              className={`rounded-md px-3 py-1 font-medium ${
                scope === s.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setImportAction(a.id)}
              className={`rounded-md px-3 py-1 font-medium ${
                importAction === a.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-500">
          {state.data ? `provider: ${state.data.provider}` : ""}
        </span>
      </div>

      {importAction === "CREATE" ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          CREATE is only for suppliers that do not already exist in Fusion. Import
          Suppliers will reject the row if the supplier number is already loaded.
          UPDATE is the normal path for cutover and cleanup.
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-600">
          UPDATE is the normal import action for suppliers already in Fusion. Rows
          with no extract match (new / synthesized) are still written as CREATE.
        </p>
      )}

      {state.loading ? <Spinner /> : null}
      {state.error ? <ErrorNote message={state.error} /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {message ? <p className="mb-4 text-sm text-emerald-700">{message}</p> : null}

      {preview ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Suppliers" value={String(preview.counts.suppliers)} />
            <KpiCard label="Sites" value={String(preview.counts.sites)} />
            <KpiCard
              label="Overlays"
              value={String(preview.counts.overlayed)}
              tone="indigo"
              sub={`${preview.overlayCount} field change(s) from source`}
            />
            <KpiCard
              label="New records"
              value={String(preview.counts.synthesized)}
              tone="amber"
              sub="Working-copy rows with no source extract"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Package</h2>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm text-slate-700">
                <dt className="text-slate-500">Output prefix</dt>
                <dd className="font-mono text-xs">{preview.prefix}</dd>
                <dt className="text-slate-500">Batch ID</dt>
                <dd className="font-mono text-xs">{preview.batchId}</dd>
                <dt className="text-slate-500">Import action</dt>
                <dd>{preview.importAction}</dd>
                <dt className="text-slate-500">Relationship</dt>
                <dd>{preview.businessRelationship}</dd>
                <dt className="text-slate-500">ZIP</dt>
                <dd className="font-mono text-xs">{preview.zip}</dd>
              </dl>
              <ul className="mt-4 space-y-1 text-sm text-slate-600">
                {preview.files.map((f) => (
                  <li key={f.name} className="flex justify-between gap-3">
                    <span className="truncate font-mono text-xs">{f.name}</span>
                    <span className="tabular-nums text-slate-500">{f.rows} rows</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Source extracts</h2>
              {preview.usedSampleFallback ? (
                <p className="mb-2 text-xs text-amber-700">
                  Bucket prefix was empty — using bundled sample extracts.
                </p>
              ) : null}
              {preview.sourceFiles.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No source files. Load <code>supplier/</code> extracts from Overview first.
                </p>
              ) : (
                <ul className="space-y-1 text-sm text-slate-600">
                  {preview.sourceFiles.map((f) => (
                    <li key={f.key} className="flex justify-between gap-3">
                      <span className="truncate font-mono text-xs">{f.key}</span>
                      <span className="tabular-nums text-slate-500">{f.rows} rows</span>
                    </li>
                  ))}
                </ul>
              )}
              {preview.sourceErrors.length ? (
                <ul className="mt-3 space-y-1 text-xs text-rose-700">
                  {preview.sourceErrors.map((e) => (
                    <li key={e.key}>
                      {e.key}: {e.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          </div>

          <Card className="p-0">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold text-slate-900">Preview — suppliers</h2>
              <p className="text-xs text-slate-500">
                Source columns plus corrections. Extra EBS fields (DUNS, payment instructions, …)
                stay on the row when the extract has them.
              </p>
            </div>
            <div className="max-h-[22rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-medium">Number</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">VAT</th>
                    <th className="px-4 py-3 font-medium">Country</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.preview.suppliers.map((row, i) => (
                    <tr key={`${row["Supplier Number"]}-${i}`}>
                      <td className="px-4 py-2 font-mono text-xs">{dash(row["Supplier Number"])}</td>
                      <td className="px-4 py-2">{dash(row["Supplier Name"])}</td>
                      <td className="px-4 py-2 text-xs text-slate-600">
                        {dash(row["Tax Organization Type"])}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {dash(row["Tax Registration Number"])}
                      </td>
                      <td className="px-4 py-2">{dash(row["Taxpayer Country"])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-0">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold text-slate-900">Field overlays</h2>
              <p className="text-xs text-slate-500">
                Working-copy corrections applied back onto the source extract before mapping to
                Fusion.
              </p>
            </div>
            {preview.overlays.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-400">
                No field differences versus the source extracts for this scope.
              </p>
            ) : (
              <div className="max-h-[18rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 font-medium">Sheet</th>
                      <th className="px-4 py-3 font-medium">Key</th>
                      <th className="px-4 py-3 font-medium">Field</th>
                      <th className="px-4 py-3 font-medium">From</th>
                      <th className="px-4 py-3 font-medium">To</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.overlays.map((o, i) => (
                      <tr key={`${o.sheet}-${o.key}-${o.field}-${i}`}>
                        <td className="px-4 py-2 text-xs text-slate-500">{o.sheet}</td>
                        <td className="px-4 py-2 font-mono text-xs">{o.key}</td>
                        <td className="px-4 py-2">{o.field}</td>
                        <td className="px-4 py-2 text-slate-500">{dash(o.from)}</td>
                        <td className="px-4 py-2 font-medium text-slate-900">{dash(o.to)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-0">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold text-slate-900">Saved packages</h2>
              <p className="text-xs text-slate-500">
                Written to <code>{state.data?.prefix}</code>. Upload the ZIP with Load Interface
                File for Import, then run Import Suppliers.
              </p>
            </div>
            {packages.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-400">
                Nothing saved yet. Build a package to create a batch folder in the bucket.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {packages.map((pkg) => {
                  const zip = pkg.files.find((f) => f.name.endsWith(".zip"));
                  return (
                    <li key={pkg.batchId} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <div className="font-medium text-slate-900">{pkg.batchId}</div>
                          <div className="text-xs text-slate-500">
                            {formatDate(pkg.createdAt)}
                            {pkg.scope ? ` · ${pkg.scope}` : ""}
                            {pkg.importAction ? ` · ${pkg.importAction}` : ""}
                            {pkg.counts
                              ? ` · ${pkg.counts.suppliers} suppliers / ${pkg.counts.sites} sites`
                              : ""}
                          </div>
                        </div>
                        {zip ? (
                          <a
                            href={`/api/suppliers/fbdi/download?key=${encodeURIComponent(zip.key)}`}
                            className="text-sm font-medium text-indigo-700 hover:underline"
                          >
                            Download ZIP ({formatBytes(zip.size)})
                          </a>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        {pkg.files
                          .filter((f) => f.name.endsWith(".csv") || f.name.endsWith(".json"))
                          .map((f) => (
                            <a
                              key={f.key}
                              href={`/api/suppliers/fbdi/download?key=${encodeURIComponent(f.key)}`}
                              className="font-mono hover:underline"
                            >
                              {f.name}
                            </a>
                          ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
