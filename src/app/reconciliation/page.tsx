"use client";

import { useMemo, useState } from "react";

import { DonutChart } from "@/components/charts";
import {
  Card,
  ErrorNote,
  KpiCard,
  PageHeader,
  Spinner,
  StatusBadge,
} from "@/components/ui";
import type {
  MatchStatus,
  ReconciliationResult,
  SupportingDocRef,
} from "@/lib/domain/types";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import {
  MATCH_PATTERN_LABELS,
  MATCH_RULES,
  matchedToDocs,
} from "@/lib/recon/match-notes";
import { useFetch } from "@/lib/useFetch";

interface ReconResponse {
  results: ReconciliationResult[];
  summary: {
    total: number;
    matched: number;
    partial: number;
    unmatched: number;
    matchRate: number;
  };
}

const FILTERS: (MatchStatus | "all")[] = [
  "all",
  "matched",
  "partial",
  "unmatched",
];

export default function ReconciliationPage() {
  const { data, error, loading } = useFetch<ReconResponse>("/api/reconciliation");
  const [filter, setFilter] = useState<MatchStatus | "all">("all");
  const [currency, setCurrency] = useState<string>("GBP");

  const currencies = useMemo(() => {
    const found = [...new Set((data?.results ?? []).map((r) => r.currency))];
    found.sort();
    return found;
  }, [data]);

  const results = useMemo(
    () =>
      (data?.results ?? []).filter((r) => {
        if (filter !== "all" && r.status !== filter) return false;
        if (currency !== "all" && r.currency !== currency) return false;
        return true;
      }),
    [data, filter, currency],
  );

  const summary = data?.summary;

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        subtitle="Bank-statement baseline: each payment is identified with supporting SO, PO, and remittance files. Unmatched means that supporting file is not in the system."
      />

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-slate-900">Matching rules</h2>
        <p className="mt-1 text-xs text-slate-500">
          How a bank line becomes Matched, Partial, or Unmatched. Matched to
          always lists the remittance / PO / SO numbers used as evidence.
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {MATCH_RULES.map((rule) => (
            <div key={rule.title} className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                {rule.title}
              </dt>
              <dd className="mt-1 text-xs leading-relaxed text-slate-600">
                {rule.detail}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      {loading ? <Spinner /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {summary ? (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <h2 className="mb-4 font-semibold text-slate-900">Match status</h2>
              <DonutChart
                segments={[
                  { label: "Matched", value: summary.matched, color: "#10b981" },
                  { label: "Partial", value: summary.partial, color: "#f59e0b" },
                  {
                    label: "Unmatched",
                    value: summary.unmatched,
                    color: "#f43f5e",
                  },
                ]}
              />
            </Card>
            <div className="grid grid-cols-2 gap-4 lg:col-span-2">
              <KpiCard label="Transactions" value={String(summary.total)} />
              <KpiCard
                label="Match rate (by value)"
                value={formatPercent(summary.matchRate)}
                tone="indigo"
              />
              <KpiCard
                label="Matched"
                value={String(summary.matched)}
                tone="positive"
              />
              <KpiCard
                label="Needs review"
                value={String(summary.partial + summary.unmatched)}
                tone="negative"
                sub={`${summary.partial} partial · ${summary.unmatched} unmatched`}
              />
            </div>
          </div>

          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold text-slate-900">Transactions</h2>
              <div className="flex flex-wrap items-center gap-2">
                {currencies.length > 1 ? (
                  <div className="flex rounded-lg border border-slate-200 p-1 text-sm">
                    <button
                      onClick={() => setCurrency("all")}
                      className={`rounded-md px-3 py-1 font-medium ${
                        currency === "all"
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      All
                    </button>
                    {currencies.map((ccy) => (
                      <button
                        key={ccy}
                        onClick={() => setCurrency(ccy)}
                        className={`rounded-md px-3 py-1 font-medium ${
                          currency === ccy
                            ? "bg-slate-900 text-white"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {ccy}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="flex rounded-lg border border-slate-200 p-1 text-sm">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${
                      filter === f
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {f}
                  </button>
                ))}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Flow</th>
                    <th className="px-5 py-3 text-right font-medium">Amount</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Pattern</th>
                    <th className="px-5 py-3 font-medium">Matched to</th>
                    <th className="px-5 py-3 text-right font-medium">Conf.</th>
                    <th className="px-5 py-3 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((r) => (
                    <tr key={r.transactionId} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-3 text-slate-500">
                        {formatDate(r.date)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            r.flow === "O2C"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-indigo-50 text-indigo-700"
                          }`}
                        >
                          {r.flow}
                        </span>
                      </td>
                      <td
                        className={`px-5 py-3 text-right tabular-nums ${
                          r.amount >= 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {formatCurrency(r.amount, r.currency)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex max-w-[14rem] rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                          {r.matchPattern
                            ? MATCH_PATTERN_LABELS[r.matchPattern]
                            : "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <MatchedToCell result={r} />
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-500">
                        {r.confidence > 0
                          ? `${Math.round(r.confidence * 100)}%`
                          : "—"}
                      </td>
                      <td className="max-w-xl px-5 py-3">
                        <MatchNotes result={r} />
                      </td>
                    </tr>
                  ))}
                  {results.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                        No transactions for this filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function docNumbers(docs: SupportingDocRef[], kind: SupportingDocRef["kind"]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const doc of docs) {
    if (doc.kind !== kind) continue;
    const value = doc.number || doc.id;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function FoundChip({
  label,
  found,
  numbers,
}: {
  label: string;
  found: boolean;
  numbers?: string[];
}) {
  const shown = (numbers ?? []).slice(0, 3);
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
        found
          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
          : "bg-slate-50 text-slate-500 ring-slate-200"
      }`}
    >
      {label} {found ? "found" : "not found"}
      {found && shown.length ? ` · ${shown.join(", ")}` : ""}
    </span>
  );
}

function MatchedToCell({ result }: { result: ReconciliationResult }) {
  const docs = matchedToDocs(result);
  if (!docs.length) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <div className="flex max-w-xs flex-col gap-1">
      {docs.map((doc) => (
        <span
          key={`${doc.kind}:${doc.id}`}
          className="inline-flex w-fit rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-800"
        >
          {doc.label}
        </span>
      ))}
    </div>
  );
}

function MatchNotes({ result }: { result: ReconciliationResult }) {
  const lookup = result.lookup;
  if (!lookup) {
    return (
      <div className="text-xs text-slate-500">{result.reasons.join(" · ")}</div>
    );
  }

  const docs = lookup.supportingDocs ?? [];
  const showSo = result.flow === "O2C";
  const showPo = result.flow === "P2P";

  return (
    <div className="space-y-1 text-xs leading-relaxed text-slate-600">
      <div className="flex flex-wrap gap-1">
        {showSo ? (
          <FoundChip
            label="SO"
            found={lookup.soFound}
            numbers={docNumbers(docs, "SO")}
          />
        ) : null}
        {showPo ? (
          <FoundChip
            label="PO"
            found={lookup.poFound}
            numbers={docNumbers(docs, "PO")}
          />
        ) : null}
        <FoundChip
          label="Remittance"
          found={lookup.remittanceFound}
          numbers={docNumbers(docs, "remittance")}
        />
      </div>
      <div>
        <span className="font-medium text-slate-700">Source:</span> {lookup.source}
      </div>
      <div>
        <span className="font-medium text-slate-700">Target:</span> {lookup.target}
      </div>
      <div>
        <span className="font-medium text-slate-700">Lookup:</span> {lookup.approach}
      </div>
      {result.remediation ? (
        <div className="text-amber-800">
          <span className="font-medium">Next:</span> {result.remediation}
        </div>
      ) : null}
    </div>
  );
}
