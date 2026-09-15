"use client";

import { useMemo, useState } from "react";

import {
  Card,
  ErrorNote,
  KpiCard,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { CashForecast, ForecastDirection } from "@/lib/domain/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

const DIRECTIONS: (ForecastDirection | "all")[] = ["all", "in", "out"];

export default function ForecastPage() {
  const { data, error, loading } = useFetch<{ forecasts: CashForecast[] }>(
    "/api/cash-forecast",
  );
  const [currency, setCurrency] = useState<string | null>(null);
  const [direction, setDirection] = useState<ForecastDirection | "all">("all");

  const forecasts = useMemo(() => data?.forecasts ?? [], [data]);
  const active = useMemo(() => {
    if (forecasts.length === 0) return null;
    return forecasts.find((f) => f.currency === currency) ?? forecasts[0];
  }, [forecasts, currency]);

  const lines = useMemo(() => {
    if (!active) return [];
    if (direction === "all") return active.lines;
    return active.lines.filter((line) => line.direction === direction);
  }, [active, direction]);

  return (
    <div>
      <PageHeader
        title="Cash Forecast"
        subtitle="Remittances that have not yet identified a bank-statement payment — predicted in (customer) and predicted out (vendor). Not anomalies."
        actions={
          forecasts.length > 1 ? (
            <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
              {forecasts.map((f) => (
                <button
                  key={f.currency}
                  onClick={() => setCurrency(f.currency)}
                  className={`rounded-md px-3 py-1 font-medium transition-colors ${
                    active?.currency === f.currency
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {f.currency}
                </button>
              ))}
            </div>
          ) : null
        }
      />

      {loading ? <Spinner /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {active ? (
        <div className="min-w-0 space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label="Predicted in"
              value={formatCurrency(active.predictedInflows, active.currency)}
              tone="positive"
              sub={`${active.inflowCount} customer remittances`}
            />
            <KpiCard
              label="Predicted out"
              value={formatCurrency(active.predictedOutflows, active.currency)}
              tone="negative"
              sub={`${active.outflowCount} vendor remittances`}
            />
            <KpiCard
              label="Statement close"
              value={formatCurrency(active.statementClosing, active.currency)}
            />
            <KpiCard
              label="Projected close"
              value={formatCurrency(active.projectedClosing, active.currency)}
              tone="indigo"
              sub={`Net ${formatCurrency(active.netPredicted, active.currency)} still to land`}
            />
          </div>

          <Card className="min-w-0 overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold text-slate-900">
                Remittances not on the statement
              </h2>
              <div className="flex rounded-lg border border-slate-200 p-1 text-sm">
                {DIRECTIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDirection(d)}
                    className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${
                      direction === d
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {d === "all" ? "All" : d === "in" ? "In" : "Out"}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Direction</th>
                    <th className="px-5 py-3 font-medium">Counterparty</th>
                    <th className="px-5 py-3 font-medium">Reference</th>
                    <th className="px-5 py-3 font-medium">Remittance</th>
                    <th className="px-5 py-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line) => (
                    <tr key={line.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-3 text-slate-500">
                        {formatDate(line.date)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            line.direction === "in"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {line.direction === "in" ? "In" : "Out"}
                        </span>
                      </td>
                      <td className="max-w-[16rem] truncate px-5 py-3 font-medium text-slate-800">
                        {line.name}
                      </td>
                      <td className="max-w-[12rem] truncate px-5 py-3 text-slate-600">{line.reference}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {line.remittanceNumber ?? line.id}
                      </td>
                      <td
                        className={`px-5 py-3 text-right tabular-nums ${
                          line.direction === "in" ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {formatCurrency(
                          line.direction === "in" ? line.amount : -line.amount,
                          line.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                        {active.forecastCount === 0
                          ? "No remittances left to land — every supporting remittance already identifies a bank line."
                          : "No remittances for this direction."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : data && forecasts.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">
            No remittance forecast yet. Load supporting remittances after the
            bank-statement baseline.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
