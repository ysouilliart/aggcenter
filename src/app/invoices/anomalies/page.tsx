"use client";

import Link from "next/link";

import { Card, ErrorNote, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import type { InvoiceRecord } from "@/lib/invoices/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

export default function InvoiceAnomaliesPage() {
  const list = useFetch<{ invoices: InvoiceRecord[] }>("/api/invoices?folder=anomaly");

  const invoices = list.data?.invoices ?? [];

  return (
    <div>
      <PageHeader
        title="Needs review"
        subtitle="Invoices in the anomaly folder — scanned documents, unsupported types, or low-confidence parses"
      />
      <Card className="p-0">
        {list.loading ? (
          <div className="px-5">
            <Spinner />
          </div>
        ) : list.error ? (
          <div className="p-5">
            <ErrorNote message={list.error} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">File</th>
                  <th className="px-5 py-3 font-medium">Reason</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Uploaded</th>
                  <th className="px-5 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">
                      Nothing in the anomaly folder.
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/invoices/${encodeURIComponent(inv.id)}`}
                          className="font-medium text-indigo-600 hover:underline"
                        >
                          {inv.fileName}
                        </Link>
                      </td>
                      <td className="max-w-md px-5 py-3 text-slate-600">{inv.reviewReason || "—"}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={inv.parseStatus} />
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {inv.uploadedAt ? formatDate(inv.uploadedAt) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {inv.total != null
                          ? formatCurrency(inv.total, inv.currency || "AUD")
                          : "—"}
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
  );
}
