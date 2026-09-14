"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { Card, ErrorNote, KpiCard, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import type { InvoiceRecord, InvoiceSummary } from "@/lib/invoices/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

const FOLDERS = ["", "landing", "received", "processed", "archived", "anomaly"] as const;

export default function InvoicesPage() {
  const [folder, setFolder] = useState<string>("");
  const listUrl = useMemo(
    () => (folder ? `/api/invoices?folder=${encodeURIComponent(folder)}` : "/api/invoices"),
    [folder],
  );
  const list = useFetch<{ invoices: InvoiceRecord[] }>(listUrl);
  const summary = useFetch<InvoiceSummary>("/api/invoices/summary");

  const fileRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reloadAll() {
    list.reload();
    summary.reload();
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF, Word, Excel or CSV invoice.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/invoices", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setMessage(`Parsed ${json.invoice.fileName} → ${json.invoice.folder} (${json.invoice.parseStatus}).`);
      if (fileRef.current) fileRef.current.value = "";
      await reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/invoices/ingest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      setMessage(
        `Synced ${json.prefix}: ${json.ingested.length} ingested, ${json.skipped.length} skipped, ${json.errors.length} error(s)` +
          (json.usedSampleFallback ? " · sample landing" : "") +
          `.`,
      );
      await reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const invoices = list.data?.invoices ?? [];
  const counts = summary.data?.byFolder;

  return (
    <div>
      <PageHeader
        title="Invoice parser"
        subtitle="Read PDF, Word and Excel invoices, classify supplier / bank / lines / tax / dates, and store them in the OCI pipeline folders"
        actions={
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync landing folder"}
          </button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Landing" value={String(counts?.landing ?? 0)} sub="Drop zone" />
        <KpiCard label="Received" value={String(counts?.received ?? 0)} sub="In flight" />
        <KpiCard
          label="Processed"
          value={String(counts?.processed ?? 0)}
          sub="Parsed"
          tone="positive"
        />
        <KpiCard
          label="Needs review"
          value={String(counts?.anomaly ?? 0)}
          sub="Anomaly folder"
          tone="amber"
        />
        <KpiCard label="Archived" value={String(counts?.archived ?? 0)} sub="Closed" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-4 font-semibold text-slate-900">Upload invoice</h2>
          <form onSubmit={handleUpload} className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.xlsm,.csv,.txt,.doc,.xls,application/pdf"
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
            />
            <p className="text-xs text-slate-400">
              PDF, DOCX, XLSX or CSV. Files land in{" "}
              <code>aggcenter/invoices/landing/</code> then move to processed or anomaly.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting ? "Parsing…" : "Parse invoice"}
            </button>
            {message ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {message}
              </div>
            ) : null}
            {error ? <ErrorNote message={error} /> : null}
          </form>
        </Card>

        <Card className="p-0 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Pipeline</h2>
            <div className="flex flex-wrap gap-1">
              {FOLDERS.map((f) => (
                <button
                  key={f || "all"}
                  type="button"
                  onClick={() => setFolder(f)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    folder === f
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f || "all"}
                </button>
              ))}
            </div>
          </div>
          {list.loading ? (
            <div className="px-5">
              <Spinner />
            </div>
          ) : list.error ? (
            <div className="p-5">
              <ErrorNote message={list.error} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Invoice</th>
                    <th className="px-5 py-3 font-medium">Supplier</th>
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 text-right font-medium">Total</th>
                    <th className="px-5 py-3 font-medium">Folder</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">
                        No invoices yet. Sync the landing folder or upload a file.
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <Link
                            href={`/invoices/${encodeURIComponent(inv.id)}`}
                            className="font-medium text-indigo-600 hover:underline"
                          >
                            {inv.invoiceNumber || inv.fileName}
                          </Link>
                          <div className="text-xs text-slate-400">{inv.fileName}</div>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{inv.supplierName || "—"}</td>
                        <td className="px-5 py-3 text-slate-500">
                          {inv.invoiceDate ? formatDate(inv.invoiceDate) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {inv.total != null
                            ? formatCurrency(inv.total, inv.currency || "AUD")
                            : "—"}
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge status={inv.folder} />
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge status={inv.parseStatus} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
