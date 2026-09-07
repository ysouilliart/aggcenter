"use client";

import { useMemo, useState } from "react";

import { AreaLineChart, GroupedBarChart } from "@/components/charts";
import {
  Card,
  ErrorNote,
  KpiCard,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { CashPosition } from "@/lib/domain/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

export default function DashboardPage() {
  const { data, error, loading } = useFetch<{ positions: CashPosition[] }>(
    "/api/cash-position",
  );
  const [currency, setCurrency] = useState<string | null>(null);

  const positions = useMemo(() => data?.positions ?? [], [data]);
  const active = useMemo(() => {
    if (positions.length === 0) return null;
    return positions.find((p) => p.currency === currency) ?? positions[0];
  }, [positions, currency]);

  return (
    <div>
      <PageHeader
        title="Cash Position"
        subtitle="Order-to-Cash & Procure-to-Pay — consolidated from reconciled bank statements"
        actions={
          positions.length > 1 ? (
            <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
              {positions.map((p) => (
                <button
                  key={p.currency}
                  onClick={() => setCurrency(p.currency)}
                  className={`rounded-md px-3 py-1 font-medium transition-colors ${
                    active?.currency === p.currency
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {p.currency}
                </button>
              ))}
            </div>
          ) : null
        }
      />

      {loading ? <Spinner /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {active ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label="Opening balance"
              value={formatCurrency(active.openingBalance, active.currency)}
            />
            <KpiCard
              label="Inflows (O2C)"
              value={formatCurrency(active.totalInflows, active.currency)}
              tone="positive"
            />
            <KpiCard
              label="Outflows (P2P)"
              value={formatCurrency(active.totalOutflows, active.currency)}
              tone="negative"
            />
            <KpiCard
              label="Closing balance"
              value={formatCurrency(active.closingBalance, active.currency)}
              tone="indigo"
              sub={`Net ${formatCurrency(active.netCashFlow, active.currency)}`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">
                  Running balance
                </h2>
                <span className="text-xs text-slate-500">{active.currency}</span>
              </div>
              <AreaLineChart
                currency={active.currency}
                points={active.series.map((s) => ({
                  label: s.date,
                  value: s.runningBalance,
                }))}
              />
              <div className="mt-2 flex justify-between text-xs text-slate-400">
                <span>{active.series[0] ? formatDate(active.series[0].date) : ""}</span>
                <span>
                  {active.series.length
                    ? formatDate(active.series[active.series.length - 1].date)
                    : ""}
                </span>
              </div>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">
                Daily inflow vs outflow
              </h2>
              <GroupedBarChart
                currency={active.currency}
                data={active.series.map((s) => ({
                  label: s.date,
                  inflow: s.inflow,
                  outflow: s.outflow,
                }))}
              />
              <div className="mt-3 flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Inflow
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> Outflow
                </span>
              </div>
            </Card>
          </div>

          <Card className="p-0">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">Accounts</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Account</th>
                    <th className="px-5 py-3 font-medium">Bank</th>
                    <th className="px-5 py-3 text-right font-medium">Opening</th>
                    <th className="px-5 py-3 text-right font-medium">Inflows</th>
                    <th className="px-5 py-3 text-right font-medium">Outflows</th>
                    <th className="px-5 py-3 text-right font-medium">Closing</th>
                    <th className="px-5 py-3 text-right font-medium">Txns</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {active.accounts.map((a) => (
                    <tr key={a.accountId} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">
                        {a.accountName}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{a.bank}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatCurrency(a.openingBalance, a.currency)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-emerald-600">
                        {formatCurrency(a.inflows, a.currency)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-rose-600">
                        {formatCurrency(a.outflows, a.currency)}
                      </td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums">
                        {formatCurrency(a.closingBalance, a.currency)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-500">
                        {a.transactionCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
