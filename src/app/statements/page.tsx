"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Card, ErrorNote, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import type { BankAccount, Statement } from "@/lib/domain/types";
import { formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

export default function StatementsPage() {
  const statementsState = useFetch<{ statements: Statement[] }>("/api/statements");
  const accountsState = useFetch<{ accounts: BankAccount[] }>("/api/accounts");

  const accounts = accountsState.data?.accounts ?? [];
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/statements/ingest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      setSyncMessage(
        `Synced from ${json.provider} (${json.prefix}): ${json.ingested.length} ingested, ` +
          `${json.skipped.length} skipped, ${json.errors.length} error(s).`,
      );
      statementsState.reload();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  // Fall back to the first account until the user picks one explicitly.
  const accountId = selectedAccountId || accounts[0]?.id || "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setUploadError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadError("Please choose a CSV file to upload.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("accountId", accountId);
      const res = await fetch("/api/statements", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setMessage(
        `Imported ${json.statement.transactionCount} transactions from ${json.statement.fileName}.` +
          (json.errors?.length ? ` (${json.errors.length} row warnings)` : ""),
      );
      if (fileRef.current) fileRef.current.value = "";
      statementsState.reload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  const statements = (statementsState.data?.statements ?? []).slice().sort((a, b) => {
    const uploaded = (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? "");
    if (uploaded !== 0) return uploaded;
    return b.periodEnd.localeCompare(a.periodEnd);
  });
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <div>
      <PageHeader
        title="Statements"
        subtitle="Bank statements consumed by the reconciliation engine (stored via the active file provider)"
        actions={
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync from bucket"}
            </button>
            {syncMessage ? (
              <span className="max-w-xs text-right text-xs text-slate-500">
                {syncMessage}
              </span>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-4 font-semibold text-slate-900">
            Upload bank statement
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                Account
              </label>
              <select
                value={accountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                CSV file
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
              />
              <p className="mt-1 text-xs text-slate-400">
                Columns: date, description, reference, counterparty, amount,
                currency
              </p>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting ? "Importing…" : "Import statement"}
            </button>
            {message ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {message}
              </div>
            ) : null}
            {uploadError ? <ErrorNote message={uploadError} /> : null}
          </form>
        </Card>

        <Card className="p-0 lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Imported statements</h2>
          </div>
          {statementsState.loading ? (
            <div className="px-5">
              <Spinner />
            </div>
          ) : statementsState.error ? (
            <div className="p-5">
              <ErrorNote message={statementsState.error} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Statement</th>
                    <th className="px-5 py-3 font-medium">Account</th>
                    <th className="px-5 py-3 font-medium">Bank</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Source</th>
                    <th className="px-5 py-3 font-medium">Period</th>
                    <th className="px-5 py-3 text-right font-medium">Txns</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statements.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">
                        No statements yet. Sync from the bucket or upload a CSV.
                      </td>
                    </tr>
                  ) : (
                    statements.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">
                        <Link
                          href={`/statements/${encodeURIComponent(s.id)}`}
                          className="text-indigo-600 hover:text-indigo-500 hover:underline"
                        >
                          {s.fileName}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {accountName(s.accountId)}
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {s.bankCode || s.header?.bankName || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {s.parseStatus ? (
                          <StatusBadge status={s.parseStatus} />
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            s.source === "upload"
                              ? "bg-indigo-50 text-indigo-700"
                              : s.source === "oci"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {s.source}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {formatDate(s.periodStart)} – {formatDate(s.periodEnd)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {s.transactionCount}
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
