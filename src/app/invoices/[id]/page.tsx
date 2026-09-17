"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";

import { Card, ErrorNote, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import type { InvoiceDetail } from "@/lib/invoices/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { fromCents } from "@/lib/money";
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

function majorInput(cents?: number): string {
  return cents == null ? "" : fromCents(cents).toFixed(2);
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const state = useFetch<InvoiceDetail>(`/api/invoices/${encodeURIComponent(id)}`);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [actor, setActor] = useState("operator");
  const [rejectReason, setRejectReason] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editsFor, setEditsFor] = useState("");

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
  const needsReview =
    Boolean(invoice?.needsConfirm) ||
    invoice?.folder === "anomaly" ||
    invoice?.parseStatus === "partial" ||
    invoice?.parseStatus === "anomaly";

  const editKey = invoice ? `${invoice.id}:${invoice.confirmedAt ?? ""}` : "";
  if (invoice && editsFor !== editKey) {
    setEditsFor(editKey);
    setEdits({});
  }
  const form: Record<string, string> = invoice
    ? {
        invoiceNumber: invoice.invoiceNumber ?? "",
        invoiceDate: invoice.invoiceDate ?? "",
        dueDate: invoice.dueDate ?? "",
        supplierName: invoice.supplierName ?? "",
        currency: invoice.currency ?? "",
        totalMajor: majorInput(invoice.total),
        taxTotalMajor: majorInput(invoice.taxTotal),
        amountDueMajor: majorInput(invoice.amountDue),
        paymentTerms: invoice.paymentTerms ?? "",
        poNumber: invoice.poNumber ?? "",
        notes: invoice.notes ?? "",
        ...edits,
      }
    : {};

  function setField(key: string, value: string) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  async function handleConfirm(action: "confirm" | "reject") {
    setConfirming(true);
    setConfirmError(null);
    setConfirmMessage(null);
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          actor,
          reason: rejectReason || undefined,
          fields: action === "confirm" ? form : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Confirm failed");
      setConfirmMessage(action === "reject" ? "Invoice rejected and kept in Needs review." : "Confirmed and moved to processed.");
      setEdits({});
      state.reload();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={invoice?.invoiceNumber || invoice?.fileName || "Invoice"}
        subtitle={
          invoice
            ? `${invoice.fileName} · ${invoice.vendor ?? "generic"} · ${invoice.classifyMode ?? "static"} classify`
            : "Loading classified invoice"
        }
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
      {confirmError ? <ErrorNote message={confirmError} /> : null}
      {confirmMessage ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {confirmMessage}
        </div>
      ) : null}

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
                <StatusBadge status={invoice.classifyMode ?? "static"} />
                <span className="text-xs text-slate-500">confidence {invoice.confidence}%</span>
              </div>
              {invoice.classifierWarning ? (
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {invoice.classifierWarning}
                </p>
              ) : invoice.classifyMode === "llm" ? (
                <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
                  LLM overlay on the static parser. Scripted fields were kept; the model filled
                  gaps. Extracted text was sent to the configured provider.
                </p>
              ) : null}
              {invoice.reviewReason ? (
                <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {invoice.reviewReason}
                </p>
              ) : null}
              {invoice.confirmedAt ? (
                <p className="mb-4 text-sm text-slate-600">
                  {invoice.confirmAction === "reject" ? "Rejected" : "Confirmed"} by{" "}
                  {invoice.confirmedBy || "operator"} · {formatDate(invoice.confirmedAt)}
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

            {needsReview && invoice.folder !== "archived" && invoice.confirmAction !== "accept" ? (
              <Card>
                <h2 className="mb-1 font-semibold text-slate-900">Human confirm</h2>
                <p className="mb-4 text-sm text-slate-500">
                  Review or edit key fields, then accept to move this invoice to processed, or
                  reject to keep it in Needs review. Confirm is recorded in the audit trail.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["invoiceNumber", "Invoice number"],
                      ["invoiceDate", "Invoice date"],
                      ["dueDate", "Due date"],
                      ["supplierName", "Supplier"],
                      ["currency", "Currency"],
                      ["totalMajor", "Total (major units)"],
                      ["taxTotalMajor", "Tax (major units)"],
                      ["amountDueMajor", "Amount due (major units)"],
                      ["paymentTerms", "Payment terms"],
                      ["poNumber", "PO number"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block text-sm">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {label}
                      </span>
                      <input
                        value={form[key] ?? ""}
                        onChange={(e) => setField(key, e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                      />
                    </label>
                  ))}
                  <label className="block text-sm sm:col-span-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Notes
                    </span>
                    <input
                      value={form.notes ?? ""}
                      onChange={(e) => setField("notes", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Operator
                    </span>
                    <input
                      value={actor}
                      onChange={(e) => setActor(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Reject reason
                    </span>
                    <input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleConfirm("confirm")}
                    disabled={confirming}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {confirming ? "Saving…" : "Accept & process"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirm("reject")}
                    disabled={confirming}
                    className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </Card>
            ) : null}

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

          {detail.confirmEvents.length > 0 ? (
            <Card className="lg:col-span-2">
              <h2 className="mb-3 font-semibold text-slate-900">Confirm audit</h2>
              <ul className="space-y-2 text-sm">
                {detail.confirmEvents.map((ev) => (
                  <li key={ev.id} className="text-slate-700">
                    <span className="font-medium text-slate-500">{ev.action}</span>
                    {ev.field ? ` · ${ev.field} ${ev.oldValue || "—"} → ${ev.newValue || "—"}` : ""}
                    {" · "}
                    {ev.actor}
                    {ev.reason ? ` · ${ev.reason}` : ""}
                    {" · "}
                    {formatDate(ev.createdAt)}
                  </li>
                ))}
              </ul>
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
