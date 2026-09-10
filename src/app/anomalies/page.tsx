"use client";

import { useMemo, useState } from "react";

import {
  Card,
  ErrorNote,
  KpiCard,
  PageHeader,
  SeverityBadge,
  Spinner,
} from "@/components/ui";
import type { Anomaly } from "@/lib/domain/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

const TYPE_LABELS: Record<string, string> = {
  duplicate: "Duplicate payment",
  amount_mismatch: "Amount mismatch",
  unmatched_large: "Large unmatched",
  missing_receipt: "Missing receipt",
  outlier: "Outlier",
  overdraft_risk: "Overdraft risk",
};

export default function AnomaliesPage() {
  const { data, error, loading } = useFetch<{ anomalies: Anomaly[] }>(
    "/api/anomalies",
  );
  const [currency, setCurrency] = useState("all");
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
        subtitle="Automated checks across bank data and reconciliation results"
      />

      {loading ? <Spinner /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Total findings" value={String(visible.length)} />
            <KpiCard label="High" value={String(counts.high)} tone="negative" />
            <KpiCard label="Medium" value={String(counts.medium)} />
            <KpiCard label="Low" value={String(counts.low)} tone="indigo" />
          </div>

          {currencies.length > 1 ? (
            <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-sm w-fit">
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

          <div className="space-y-3">
            {visible.map((a) => (
              <Card key={a.id} className="flex items-start gap-4">
                <div className="mt-0.5">
                  <SeverityBadge severity={a.severity} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{a.title}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                      {TYPE_LABELS[a.type] ?? a.type}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{a.description}</p>
                  <div className="mt-1 text-xs text-slate-400">
                    {a.relatedIds.join(" · ")}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {a.amount != null ? (
                    <div className="font-semibold tabular-nums text-slate-900">
                      {formatCurrency(a.amount, a.currency ?? "USD")}
                    </div>
                  ) : null}
                  {a.date ? (
                    <div className="text-xs text-slate-400">
                      {formatDate(a.date)}
                    </div>
                  ) : null}
                </div>
              </Card>
            ))}
            {visible.length === 0 ? (
              <Card>
                <p className="text-sm text-slate-500">
                  {anomalies.length === 0
                    ? "No anomalies detected. 🎉"
                    : "No anomalies for this currency."}
                </p>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
