"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";

import { Card, ErrorNote, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import type { InvoiceDetail } from "@/lib/invoices/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") {
    return (
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className="mt-0.5 text-sm text-slate-400">—</dd>
      </div>
    );
  }
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-all text-sm text-slate-900">{value}</dd>
    </div>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const state = useFetch<InvoiceDetail>(`/api/invoices/${encodeURIComponent(id)}`);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function handleArchive() {
    setArchiving(true);
    setArchiveError(null);
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Archive failed");
      state.reload();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setArchiving(false);
    }
  }

  const detail = state.data;
  const invoice = detail?.invoice;
  const isPdf = invoice?.fileName.toLowerCase().endsWith(".pdf") || invoice?.mimeType === "application/pdf";

  return (
    <div>
      <PageHeader
        title={invoice?.invoiceNumber || invoice?.fileName || "Invoice"}
        subtitle={invoice ? `${invoice.fileName} · ${invoice.vendor ?? "generic"} parser` : "Loading classified invoice"}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/invoices" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              ← Inbox
            </Link>
            {invoice && invoice.folder !== "archived" ? (
              <button
                type="button"
                onClick={handleArchive}
                disabled={archiving}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {archiving ? "Archiving…" : "Archive"}
              </button>
            ) : null}
          </div>
        }
      />

      {state.loading ? <Spinner /> : null}
      {state.error ? <ErrorNote message={state.error} /> : null}
      {archiveError ? <ErrorNote message={archiveError} /> : null}

      {invoice ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold text-slate-900">Document</h2>
              <a
                href={`/api/invoices/${encodeURIComponent(invoice.id)}/file`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-indigo-600 hover:underline"
              >
                Open original
              </a>
            </div>
            {isPdf ? (
              <iframe
                title="Invoice PDF"
                src={`/api/invoices/${encodeURIComponent(invoice.id)}/file`}
                className="h-[42rem] w-full bg-slate-100"
              />
            ) : (
              <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap p-5 text-xs leading-relaxed text-slate-700">
                {invoice.extractedText || "No extractable text."}
              </pre>
            )}
          </Card>

          <div className="space-y-6">
            <Card>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <StatusBadge status={invoice.folder} />
                <StatusBadge status={invoice.parseStatus} />
                <span className="text-xs text-slate-500">confidence {invoice.confidence}%</span>
              </div>
              {invoice.reviewReason ? (
                <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {invoice.reviewReason}
                </p>
              ) : null}
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field label="Invoice number" value={invoice.invoiceNumber} />
                <Field label="Invoice date" value={invoice.invoiceDate} />
                <Field label="Due date" value={invoice.dueDate} />
                <Field label="Payment terms" value={invoice.paymentTerms} />
                <Field
                  label="Total"
                  value={
                    invoice.total != null
                      ? formatCurrency(invoice.total, invoice.currency || "AUD")
                      : undefined
                  }
                />
                <Field
                  label="Tax"
                  value={
                    invoice.taxTotal != null
                      ? formatCurrency(invoice.taxTotal, invoice.currency || "AUD")
                      : undefined
                  }
                />
                <Field
                  label="Amount due"
                  value={
                    invoice.amountDue != null
                      ? formatCurrency(invoice.amountDue, invoice.currency || "AUD")
                      : undefined
                  }
                />
                <Field label="Currency" value={invoice.currency} />
                <Field label="Account" value={invoice.accountNumber} />
                <Field label="Reference" value={invoice.referenceNumber} />
                <Field label="PO number" value={invoice.poNumber} />
                <Field label="Customer #" value={invoice.customerNumber} />
              </dl>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Supplier (origin)</h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field label="Name" value={invoice.supplierName} />
                <Field label="Legal name" value={invoice.supplierLegalName} />
                <Field label="Tax ID / ABN" value={invoice.supplierTaxId} />
                <Field label="VAT" value={invoice.supplierVat} />
                <Field label="Address" value={invoice.supplierAddress} />
                <Field label="Country" value={invoice.supplierCountry} />
                <Field label="Phone" value={invoice.supplierPhone} />
                <Field label="Website" value={invoice.supplierWebsite} />
              </dl>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold text-slate-900">Customer</h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field label="Name" value={invoice.customerName} />
                <Field label="Address" value={invoice.customerAddress} />
                <Field label="Email" value={invoice.customerEmail} />
              </dl>
            </Card>

            {detail.bank ? (
              <Card>
                <h2 className="mb-3 font-semibold text-slate-900">Bank / payment</h2>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Field label="Method" value={detail.bank.paymentMethod} />
                  <Field label="Account name" value={detail.bank.accountName} />
                  <Field label="Account number" value={detail.bank.accountNumber} />
                  <Field label="BSB" value={detail.bank.bsb} />
                  <Field label="IBAN" value={detail.bank.iban} />
                  <Field label="BIC" value={detail.bank.bic} />
                  <Field label="BPAY biller" value={detail.bank.billerCode} />
                  <Field label="BPAY reference" value={detail.bank.bpayReference} />
                </dl>
              </Card>
            ) : null}
          </div>

          <Card className="p-0 lg:col-span-2">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold text-slate-900">Line items</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2 font-medium">#</th>
                    <th className="px-5 py-2 font-medium">Description</th>
                    <th className="px-5 py-2 text-right font-medium">Qty</th>
                    <th className="px-5 py-2 font-medium">Unit</th>
                    <th className="px-5 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.lineItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-slate-400">
                        No line items classified.
                      </td>
                    </tr>
                  ) : (
                    detail.lineItems.map((line) => (
                      <tr key={line.lineNumber}>
                        <td className="px-5 py-2 text-slate-500">{line.lineNumber}</td>
                        <td className="px-5 py-2 text-slate-800">{line.description}</td>
                        <td className="px-5 py-2 text-right tabular-nums">{line.quantity ?? "—"}</td>
                        <td className="px-5 py-2 text-slate-500">{line.unit ?? "—"}</td>
                        <td className="px-5 py-2 text-right tabular-nums">
                          {line.lineTotal != null
                            ? formatCurrency(line.lineTotal, invoice.currency || "AUD")
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {detail.fields.length > 0 ? (
            <Card className="lg:col-span-2">
              <h2 className="mb-3 font-semibold text-slate-900">Classified fields</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-4 font-medium">Category</th>
                      <th className="py-2 pr-4 font-medium">Field</th>
                      <th className="py-2 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.fields.map((f) => (
                      <tr key={`${f.category}-${f.key}-${f.value}`}>
                        <td className="py-2 pr-4 text-slate-500">{f.category}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{f.key}</td>
                        <td className="py-2 break-all text-slate-800">{f.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {invoice.notes ? (
            <Card className="lg:col-span-2">
              <h2 className="mb-2 font-semibold text-slate-900">Notes</h2>
              <p className="text-sm text-slate-700">{invoice.notes}</p>
            </Card>
          ) : null}

          {detail.job ? (
            <Card className="lg:col-span-2">
              <h2 className="mb-3 font-semibold text-slate-900">Parse trace</h2>
              <p className="mb-2 text-xs text-slate-500">
                {detail.job.parserId} {detail.job.parserVersion} · {formatDate(detail.job.finishedAt)}
              </p>
              <ul className="space-y-2 text-sm">
                {detail.job.events.map((ev) => (
                  <li key={ev.seq} className="text-slate-700">
                    <span className="font-medium text-slate-500">{ev.stage}</span>
                    {" · "}
                    {ev.message}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
