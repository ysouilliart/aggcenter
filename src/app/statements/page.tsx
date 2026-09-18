"use client";

import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Link from "next/link";
import { useRef, useState } from "react";

import { Card, ErrorNote, PageHeader, SortTh, Spinner, StatusBadge, SuccessNote } from "@/components/ui";
import type { BankAccount, Statement } from "@/lib/domain/types";
import { formatDate } from "@/lib/format";
import { invalidateCashFetchCache, useFetch } from "@/lib/useFetch";
import { useSort } from "@/lib/useSort";

function statementSortValue(row: Statement, key: string): unknown {
  switch (key) {
    case "file":
      return row.fileName;
    case "account":
      return row.accountId;
    case "bank":
      return row.bankCode || row.header?.bankName || "";
    case "status":
      return row.parseStatus ?? "";
    case "source":
      return row.source;
    case "period":
      return row.periodEnd;
    case "txns":
      return row.transactionCount;
    default:
      return "";
  }
}

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
        `Replaced previous parses from ${json.provider} (${json.prefix}): ${json.ingested.length} ingested, ` +
          `${json.skipped.length} skipped, ${json.errors.length} error(s).`,
      );
      invalidateCashFetchCache();
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
      invalidateCashFetchCache();
      statementsState.reload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  const statements = (statementsState.data?.statements ?? []).slice();
  const sorted = useSort(statements, statementSortValue, "period", "desc");
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <div>
      <PageHeader
        title="Statements"
        subtitle="Bank-statement baseline consumed by reconciliation. Sync from bucket replaces the previous parse so each file is loaded once."
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button variant="outlined" size="small" onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync from bucket"}
            </Button>
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
            <TextField
              select
              label="Account"
              size="small"
              fullWidth
              value={accountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </MenuItem>
              ))}
            </TextField>
            <div>
              <Button variant="outlined" component="label" fullWidth>
                Choose CSV
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept=".csv,text/csv"
                />
              </Button>
              <p className="mt-1 text-xs text-slate-400">
                Columns: date, description, reference, counterparty, amount,
                currency
              </p>
            </div>
            <Button type="submit" variant="contained" disabled={submitting} fullWidth>
              {submitting ? "Importing…" : "Import statement"}
            </Button>
            {message ? <SuccessNote message={message} /> : null}
            {uploadError ? <ErrorNote message={uploadError} /> : null}
          </form>
        </Card>

        <Card className="p-0 lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Imported statements</h2>
          </div>
          {statementsState.loading && !statementsState.data ? (
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
                    <SortTh label="Statement" column="file" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Account" column="account" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Bank" column="bank" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Status" column="status" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Source" column="source" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Period" column="period" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Txns" column="txns" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">
                        No statements yet. Sync from the bucket or upload a CSV.
                      </td>
                    </tr>
                  ) : (
                    sorted.rows.map((s) => (
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
