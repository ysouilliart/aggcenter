"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { Card, ErrorNote, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import type {
  BankAccount,
  BankTransaction,
  ParseJob,
  ParseTraceEvent,
  Statement,
  StatementHeader,
} from "@/lib/domain/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

interface StatementDetailResponse {
  statement: Statement;
  transactions: BankTransaction[];
  job: ParseJob | null;
  account: BankAccount | null;
}

const TRACE_LEVEL: Record<string, string> = {
  info: "bg-slate-100 text-slate-700",
  warn: "bg-amber-50 text-amber-800",
  error: "bg-rose-50 text-rose-800",
};

function haystack(txn: BankTransaction): string {
  return [
    txn.date,
    txn.postDate,
    txn.valueDate,
    txn.trnType,
    txn.reference,
    txn.customerReference,
    txn.bankReference,
    txn.counterparty,
    txn.description,
    txn.narrative,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function HeaderGrid({ header }: { header: StatementHeader }) {
  const currency = header.currency ?? "GBP";
  const rows: { label: string; value: string }[] = [
    { label: "Account name", value: header.accountName ?? "—" },
    { label: "Account number", value: header.accountNumber ?? "—" },
    { label: "Sort code", value: header.sortCode ?? "—" },
    { label: "Bank", value: header.bankName ?? "—" },
    { label: "IBAN", value: header.iban ?? "—" },
    { label: "BIC", value: header.bic ?? "—" },
    { label: "Currency", value: header.currency ?? "—" },
    { label: "Type / status", value: [header.accountType, header.accountStatus].filter(Boolean).join(" · ") || "—" },
    { label: "Period", value: [header.periodStart, header.periodEnd].filter(Boolean).join(" → ") || "—" },
    { label: "Statement date", value: header.statementDate ?? "—" },
    {
      label: "Current ledger",
      value:
        header.currentLedgerBalance != null
          ? formatCurrency(header.currentLedgerBalance, currency)
          : "—",
    },
    {
      label: "Closing ledger BF",
      value:
        header.closingLedgerBroughtForward != null
          ? formatCurrency(header.closingLedgerBroughtForward, currency)
          : "—",
    },
    {
      label: "Current available",
      value:
        header.currentAvailableBalance != null
          ? formatCurrency(header.currentAvailableBalance, currency)
          : "—",
    },
    {
      label: "Closing available BF",
      value:
        header.closingAvailableBroughtForward != null
          ? formatCurrency(header.closingAvailableBroughtForward, currency)
          : "—",
    },
    { label: "As at", value: header.currentBalanceAsAt ?? "—" },
    { label: "Brought forward from", value: header.broughtForwardFrom ?? "—" },
    { label: "Pages", value: header.pageCount != null ? String(header.pageCount) : "—" },
    { label: "Location", value: header.location ?? "—" },
  ];

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {row.label}
          </dt>
          <dd className="mt-0.5 break-all text-sm text-slate-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TraceEvent({ event }: { event: ParseTraceEvent }) {
  const [open, setOpen] = useState(false);
  const hasDetail = event.detail && Object.keys(event.detail).length > 0;
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
          TRACE_LEVEL[event.level] ?? TRACE_LEVEL.info
        }`}
      >
        {event.level}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-800">
          <span className="font-medium text-slate-500">{event.stage}</span>
          {" · "}
          {event.message}
          {event.page != null ? (
            <span className="text-xs text-slate-400"> p{event.page}</span>
          ) : null}
        </div>
        {hasDetail ? (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
            >
              {open ? "Hide detail" : "Show detail"}
            </button>
            {open ? (
              <pre className="mt-1 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
                {JSON.stringify(event.detail, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function StatementDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const state = useFetch<StatementDetailResponse>(
    id ? `/api/statements/${encodeURIComponent(id)}` : "",
  );
  const [query, setQuery] = useState("");

  const statement = state.data?.statement;
  const job = state.data?.job;
  const account = state.data?.account;
  const currency = statement?.header?.currency || account?.currency || "USD";
  const showHsbcCols = Boolean(
    state.data?.transactions.some(
      (t) => t.narrative || t.trnType || t.debitAmount != null || t.creditAmount != null,
    ),
  );

  const filtered = useMemo(() => {
    const txns = state.data?.transactions ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return txns;
    return txns.filter((t) => haystack(t).includes(q));
  }, [state.data?.transactions, query]);

  return (
    <div>
      <PageHeader
        title={statement?.fileName ?? "Statement"}
        subtitle={
          statement
            ? `${statement.accountId}${account?.name ? ` · ${account.name}` : ""} · ${formatDate(statement.periodStart)} – ${formatDate(statement.periodEnd)}`
            : "Parsed header, transactions, and parse trace"
        }
        actions={
          <Link
            href="/statements"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Statements
          </Link>
        }
      />

      {state.loading ? <Spinner label="Loading statement…" /> : null}
      {state.error ? <ErrorNote message={state.error} /> : null}

      {statement ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            {statement.parseStatus ? <StatusBadge status={statement.parseStatus} /> : null}
            <StatusBadge status={statement.source} />
            {statement.bankCode ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {statement.bankCode}
              </span>
            ) : null}
            {statement.parserId ? (
              <span className="text-xs text-slate-500">
                {statement.parserId}
                {statement.parserVersion ? `@${statement.parserVersion}` : ""}
              </span>
            ) : null}
          </div>

          <Card>
            <h2 className="mb-3 font-semibold text-slate-900">Source</h2>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  File
                </dt>
                <dd className="mt-0.5 break-all text-sm text-slate-900">{statement.fileName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Storage key
                </dt>
                <dd className="mt-0.5 font-mono text-xs break-all text-slate-700">
                  {statement.storageKey ?? "— (bundled sample)"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Uploaded
                </dt>
                <dd className="mt-0.5 text-sm text-slate-900">
                  {statement.uploadedAt ? formatDate(statement.uploadedAt) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Raw file
                </dt>
                <dd className="mt-0.5 text-sm text-slate-700">
                  PDFs are not dumped here. Browse the object on the{" "}
                  <Link href="/files" className="font-medium text-indigo-600 hover:text-indigo-500">
                    Files
                  </Link>{" "}
                  page (binary preview only).
                </dd>
              </div>
            </dl>
          </Card>

          {statement.header ? (
            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Header</h2>
              <HeaderGrid header={statement.header} />
            </Card>
          ) : (
            <Card>
              <h2 className="mb-1 font-semibold text-slate-900">Header</h2>
              <p className="text-sm text-slate-500">
                No parsed header for this file (CSV / sample statements).
              </p>
            </Card>
          )}

          <Card>
            <h2 className="mb-3 font-semibold text-slate-900">Parse trace</h2>
            {job ? (
              <div>
                <p className="mb-3 text-sm text-slate-500">
                  {job.transactionCount} txn(s) · {job.warningCount} warning(s) · noise{" "}
                  {job.skippedNoise} · unparsed {job.skippedUnparsed} · {job.pageCount} page(s)
                </p>
                <ol className="space-y-3">
                  {job.events.map((event, index) => (
                    <TraceEvent key={`${event.stage}-${index}`} event={event} />
                  ))}
                </ol>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No parse job recorded. CSV uploads and bundled samples skip the PDF
                parse trace.
              </p>
            )}
          </Card>

          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">
                Transactions
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {filtered.length}
                  {query ? ` of ${state.data?.transactions.length ?? 0}` : ""}
                </span>
              </h2>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter narrative, refs, type…"
                className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-1.5 text-sm sm:w-72"
              />
            </div>
            {filtered.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-400">
                {query ? "No transactions match that filter." : "No transactions on this statement."}
              </p>
            ) : (
              <div className="max-h-[36rem] overflow-auto">
                <table className="w-full min-w-[56rem] text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      {showHsbcCols ? (
                        <th className="px-4 py-2 font-medium">Line</th>
                      ) : null}
                      <th className="px-4 py-2 font-medium">Date</th>
                      {showHsbcCols ? (
                        <th className="px-4 py-2 font-medium">Type</th>
                      ) : null}
                      <th className="px-4 py-2 font-medium">Reference</th>
                      <th className="px-4 py-2 font-medium">Counterparty</th>
                      {showHsbcCols ? (
                        <>
                          <th className="px-4 py-2 text-right font-medium">Debit</th>
                          <th className="px-4 py-2 text-right font-medium">Credit</th>
                        </>
                      ) : (
                        <th className="px-4 py-2 text-right font-medium">Amount</th>
                      )}
                      <th className="px-4 py-2 text-right font-medium">Balance</th>
                      <th className="px-4 py-2 font-medium">
                        {showHsbcCols ? "Narrative" : "Description"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((t) => (
                      <tr key={t.id} className="align-top hover:bg-slate-50">
                        {showHsbcCols ? (
                          <td className="px-4 py-2 font-mono text-xs text-slate-500">
                            L{t.lineNumber ?? "?"}
                            {t.page != null ? ` p${t.page}` : ""}
                          </td>
                        ) : null}
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                          {formatDate(t.postDate || t.date)}
                        </td>
                        {showHsbcCols ? (
                          <td className="px-4 py-2 text-slate-700">{t.trnType ?? "—"}</td>
                        ) : null}
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">
                          {t.customerReference || t.reference || "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-600">
                          {t.bankReference || t.counterparty || "—"}
                        </td>
                        {showHsbcCols ? (
                          <>
                            <td className="px-4 py-2 text-right tabular-nums text-rose-700">
                              {t.debitAmount
                                ? formatCurrency(t.debitAmount, t.currency || currency)
                                : ""}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                              {t.creditAmount
                                ? formatCurrency(t.creditAmount, t.currency || currency)
                                : ""}
                            </td>
                          </>
                        ) : (
                          <td
                            className={`px-4 py-2 text-right tabular-nums ${
                              t.amount < 0 ? "text-rose-700" : "text-emerald-700"
                            }`}
                          >
                            {formatCurrency(t.amount, t.currency || currency)}
                          </td>
                        )}
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                          {t.balanceAfter != null
                            ? formatCurrency(t.balanceAfter, t.currency || currency)
                            : "—"}
                        </td>
                        <td className="max-w-md px-4 py-2 text-xs leading-relaxed break-words text-slate-700">
                          {t.narrative || t.description || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
