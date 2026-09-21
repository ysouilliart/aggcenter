"use client";

import Button from "@mui/material/Button";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { Card, ErrorNote, InfoNote, KpiCard, PageHeader, SegmentedToggle, SortTh, Spinner, StatusBadge, SuccessNote, WarningNote } from "@/components/ui";
import type { InvoiceRecord, InvoiceSummary } from "@/lib/invoices/types";

type ClassifyStatus = {
  mode: "llm" | "static";
  llmReady: boolean;
  warning?: string;
  model?: string;
};
import { formatCurrency, formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";
import { useSort } from "@/lib/useSort";

const FOLDERS = ["", "landing", "received", "processed", "archived", "anomaly"] as const;

function invoiceSortValue(row: InvoiceRecord, key: string): unknown {
  switch (key) {
    case "invoice":
      return row.invoiceNumber || row.fileName;
    case "supplier":
      return row.supplierName || "";
    case "date":
      return row.invoiceDate || "";
    case "total":
      return row.total ?? 0;
    case "folder":
      return row.folder;
    case "status":
      return row.parseStatus;
    default:
      return "";
  }
}

export default function InvoicesPage() {
  const [folder, setFolder] = useState<string>("");
  const listUrl = useMemo(
    () => (folder ? `/api/invoices?folder=${encodeURIComponent(folder)}` : "/api/invoices"),
    [folder],
  );
  const list = useFetch<{ invoices: InvoiceRecord[] }>(listUrl);
  const summary = useFetch<InvoiceSummary & { classify?: ClassifyStatus }>("/api/invoices/summary");

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
  const sorted = useSort(invoices, invoiceSortValue);
  const counts = summary.data?.byFolder;

  return (
    <div>
      <PageHeader
        title="Invoice parser"
        subtitle="Extract text deterministically, classify with static vendor/regex as the floor (LLM fills gaps), then confirm uncertain results before they are treated as processed"
        actions={
          <Button type="button" variant="outlined" size="small" onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync landing folder"}
          </Button>
        }
      />

      {summary.data?.classify?.warning ? (
        <WarningNote message={summary.data.classify.warning} />
      ) : summary.data?.classify?.llmReady ? (
        <InfoNote message={`LLM classify is on (${summary.data.classify.model}). Static scripting stays the floor; the model only fills missing fields. Extracted invoice text is sent to the configured provider. Low-confidence or partial results stay in Needs review until an operator confirms.`} />
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
          <h2 className="mb-2 text-[13px] font-medium text-slate-800">Upload invoice</h2>
          <form onSubmit={handleUpload} className="space-y-4">
            <Button variant="outlined" component="label" fullWidth>
              Choose invoice
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".pdf,.docx,.xlsx,.xlsm,.csv,.txt,.doc,.xls,application/pdf"
              />
            </Button>
            <p className="text-xs text-slate-400">
              PDF, DOCX, XLSX or CSV. Files land in{" "}
              <code>aggcenter/invoices/landing/</code> then move to processed or anomaly.
            </p>
            <Button type="submit" variant="contained" disabled={submitting} fullWidth>
              {submitting ? "Parsing…" : "Parse invoice"}
            </Button>
            {message ? <SuccessNote message={message} /> : null}
            {error ? <ErrorNote message={error} /> : null}
          </form>
        </Card>

        <Card className="p-0 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <h2 className="text-[13px] font-medium text-slate-800">Pipeline</h2>
            <SegmentedToggle
              value={folder || "all"}
              onChange={(next) => setFolder(next === "all" ? "" : next)}
              options={FOLDERS.map((f) => ({ value: f || "all", label: f || "all" }))}
            />
          </div>
          {list.loading && !list.data ? (
            <div className="px-5">
              <Spinner />
            </div>
          ) : list.error ? (
            <div className="p-5">
              <ErrorNote message={list.error} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500">
                    <SortTh label="Invoice" column="invoice" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Supplier" column="supplier" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Date" column="date" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Total" column="total" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} align="right" />
                    <SortTh label="Folder" column="folder" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Status" column="status" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">
                        No invoices yet. Sync the landing folder or upload a file.
                      </td>
                    </tr>
                  ) : (
                    sorted.rows.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <Link
                            href={`/invoices/${encodeURIComponent(inv.id)}`}
                            className="font-medium text-brand hover:underline"
                          >
                            {inv.invoiceNumber || inv.fileName}
                          </Link>
                          <div className="text-xs text-slate-400">{inv.fileName}</div>
                        </td>
                        <td className="px-4 py-2 text-slate-600">{inv.supplierName || "—"}</td>
                        <td className="px-4 py-2 text-slate-500">
                          {inv.invoiceDate ? formatDate(inv.invoiceDate) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {inv.total != null
                            ? formatCurrency(inv.total, inv.currency || "AUD")
                            : "—"}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={inv.folder} />
                        </td>
                        <td className="px-4 py-2">
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
