"use client";

import { useMemo, useState } from "react";

import {
  Card,
  ErrorNote,
  KpiCard,
  PageHeader,
  SegmentedToggle,
  SortTh,
  SeverityBadge,
  Spinner,
} from "@/components/ui";
import type { Anomaly } from "@/lib/domain/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";
import { useSort } from "@/lib/useSort";

const TYPE_LABELS: Record<string, string> = {
  duplicate: "Duplicate payment",
  amount_mismatch: "Amount mismatch",
  unmatched_large: "Large unidentified",
  outlier: "Outlier",
  overdraft_risk: "Overdraft risk",
};

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function anomalySortValue(row: Anomaly, key: string): unknown {
  switch (key) {
    case "severity":
      return SEVERITY_ORDER[row.severity] ?? 9;
    case "title":
      return row.title;
    case "type":
      return row.type;
    case "amount":
      return row.amount ?? 0;
    case "date":
      return row.date ?? "";
    default:
      return "";
  }
}

export default function AnomaliesPage() {
  const { data, error, loading } = useFetch<{ anomalies: Anomaly[] }>(
    "/api/anomalies",
  );
  const [currency, setCurrency] = useState("GBP");
  const anomalies = useMemo(() => data?.anomalies ?? [], [data]);
  const currencies = useMemo(() => {
    const found = [
      ...new Set(anomalies.map((a) => a.currency).filter((c): c is string => Boolean(c))),
    ];
    found.sort();
    return found;
  }, [anomalies]);
  const visible = useMemo(
    () =>
      currency === "all"
        ? anomalies
        : anomalies.filter((a) => a.currency === currency),
    [anomalies, currency],
  );
  const sorted = useSort(visible, anomalySortValue, "severity");

  const counts = useMemo(() => {
    const high = visible.filter((a) => a.severity === "high").length;
    const medium = visible.filter((a) => a.severity === "medium").length;
    const low = visible.filter((a) => a.severity === "low").length;
    return { high, medium, low };
  }, [visible]);

  return (
    <div>
      <PageHeader
        title="Anomalies"
        subtitle="Checks on the bank-statement baseline (duplicates, unidentified large payments, amount mismatches). Remittances still to land are on Forecast, not here."
      />

      {loading && !data ? <Spinner /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Total findings" value={String(visible.length)} />
            <KpiCard label="High" value={String(counts.high)} tone="negative" />
            <KpiCard label="Medium" value={String(counts.medium)} />
            <KpiCard label="Low" value={String(counts.low)} tone="primary" />
          </div>

          {currencies.length > 1 ? (
            <SegmentedToggle
              value={currency}
              onChange={setCurrency}
              options={[
                { value: "all", label: "All" },
                ...currencies.map((ccy) => ({ value: ccy, label: ccy })),
              ]}
            />
          ) : null}

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-500">
                    <SortTh label="Severity" column="severity" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Finding" column="title" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Type" column="type" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Date" column="date" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Amount" column="amount" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.rows.map((a) => (
                    <tr key={a.id} className="align-top hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <SeverityBadge severity={a.severity} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-semibold text-slate-900">{a.title}</div>
                        <p className="mt-1 text-sm text-slate-600">{a.description}</p>
                        <div className="mt-1 text-xs text-slate-400">
                          {a.relatedIds.join(" · ")}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                          {TYPE_LABELS[a.type] ?? a.type}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-500">
                        {a.date ? formatDate(a.date) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-900">
                        {a.amount != null
                          ? formatCurrency(a.amount, a.currency ?? "USD")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                  {sorted.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                        {anomalies.length === 0
                          ? "No anomalies detected. 🎉"
                          : "No anomalies for this currency."}
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
