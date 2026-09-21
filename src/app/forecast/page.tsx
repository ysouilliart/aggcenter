"use client";

import { useMemo, useState } from "react";

import {
  Card,
  ErrorNote,
  KpiCard,
  PageHeader,
  SegmentedToggle,
  SortTh,
  Spinner,
} from "@/components/ui";
import type { CashForecast, CashForecastLine, ForecastDirection } from "@/lib/domain/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";
import { useSort } from "@/lib/useSort";

const DIRECTIONS: (ForecastDirection | "all")[] = ["all", "in", "out"];

function forecastSortValue(row: CashForecastLine, key: string): unknown {
  switch (key) {
    case "date":
      return row.date;
    case "direction":
      return row.direction;
    case "name":
      return row.name;
    case "reference":
      return row.reference;
    case "remittance":
      return row.remittanceNumber ?? row.id;
    case "amount":
      return row.direction === "in" ? row.amount : -row.amount;
    default:
      return "";
  }
}

export default function ForecastPage() {
  const { data, error, loading } = useFetch<{ forecasts: CashForecast[] }>(
    "/api/cash-forecast",
  );
  const [currency, setCurrency] = useState<string | null>(null);
  const [direction, setDirection] = useState<ForecastDirection | "all">("all");

  const forecasts = useMemo(() => data?.forecasts ?? [], [data]);
  const active = useMemo(() => {
    if (forecasts.length === 0) return null;
    if (currency) {
      return forecasts.find((f) => f.currency === currency) ?? forecasts[0];
    }
    return (
      [...forecasts].sort((a, b) => b.statementClosing - a.statementClosing)[0] ??
      forecasts[0]
    );
  }, [forecasts, currency]);

  const lines = useMemo(() => {
    if (!active) return [];
    if (direction === "all") return active.lines;
    return active.lines.filter((line) => line.direction === direction);
  }, [active, direction]);
  const sorted = useSort(lines, forecastSortValue);

  return (
    <div>
      <PageHeader
        title="Cash Forecast"
        subtitle="Remittances that have not yet identified a bank-statement payment — predicted in (customer) and predicted out (vendor). Not anomalies."
        actions={
          forecasts.length > 1 ? (
            <SegmentedToggle
              value={active?.currency ?? forecasts[0].currency}
              onChange={setCurrency}
              options={forecasts.map((f) => ({ value: f.currency, label: f.currency }))}
            />
          ) : null
        }
      />

      {loading && !data ? <Spinner /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {active ? (
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 items-start gap-3 lg:grid-cols-4">
            <KpiCard
              label="Predicted in"
              value={formatCurrency(active.predictedInflows, active.currency)}
              tone="primary"
              sub={`${active.inflowCount} customer remittances`}
            />
            <KpiCard
              label="Predicted out"
              value={formatCurrency(active.predictedOutflows, active.currency)}
              tone="amber"
              sub={`${active.outflowCount} vendor remittances`}
            />
            <KpiCard
              label="Statement close"
              value={formatCurrency(active.statementClosing, active.currency)}
            />
            <KpiCard
              label="Projected close"
              value={formatCurrency(active.projectedClosing, active.currency)}
              tone="primary"
              sub={`Net ${formatCurrency(active.netPredicted, active.currency)} still to land`}
            />
          </div>

          <Card className="min-w-0 overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
              <h2 className="text-[13px] font-medium text-slate-800">
                Remittances not on the statement
              </h2>
              <SegmentedToggle
                value={direction}
                onChange={setDirection}
                options={DIRECTIONS.map((d) => ({
                  value: d,
                  label: d === "all" ? "All" : d === "in" ? "In" : "Out",
                }))}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500">
                    <SortTh label="Date" column="date" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Direction" column="direction" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Counterparty" column="name" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Reference" column="reference" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Remittance" column="remittance" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Amount" column="amount" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.rows.map((line) => (
                    <tr key={line.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                        {formatDate(line.date)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            line.direction === "in"
                              ? "bg-brand-soft text-brand-dark"
                              : "bg-brand-orange-soft text-brand-orange"
                          }`}
                        >
                          {line.direction === "in" ? "In" : "Out"}
                        </span>
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-2 font-medium text-slate-800">
                        {line.name}
                      </td>
                      <td className="max-w-[12rem] truncate px-4 py-2 text-slate-600">{line.reference}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {line.remittanceNumber ?? line.id}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${
                          line.direction === "in" ? "text-brand" : "text-brand-orange"
                        }`}
                      >
                        {formatCurrency(
                          line.direction === "in" ? line.amount : -line.amount,
                          line.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                  {sorted.rows.length === 0 ? (
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
