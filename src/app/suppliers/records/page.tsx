"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Card,
  ErrorNote,
  IssueBadge,
  PageHeader,
  SeverityBadge,
  Spinner,
  VatCheckBadge,
} from "@/components/ui";
import type {
  SupplierIssueType,
  SupplierPatchField,
  SupplierRecord,
  SupplierVatCheck,
} from "@/lib/suppliers/types";
import { parseViesAddress } from "@/lib/suppliers/viesCompare";
import { useFetch } from "@/lib/useFetch";

const SOURCE_FILTERS: { id: string; label: string }[] = [
  { id: "oci-supplier", label: "Conversion" },
  { id: "", label: "All sources" },
];

const ISSUE_FILTERS: { id: "" | "any" | SupplierIssueType; label: string }[] = [
  { id: "", label: "All" },
  { id: "any", label: "Has issues" },
  { id: "missing_attribute", label: "Missing" },
  { id: "invalid_vat", label: "VAT" },
  { id: "invalid_address", label: "Address" },
  { id: "rationalise", label: "Rationalise" },
];

type ListResponse = { total: number; records: SupplierRecord[] };

function dash(value: string | undefined): string {
  return value?.trim() ? value : "—";
}

export default function SupplierRecordsPage() {
  const [q, setQ] = useState("");
  const [issue, setIssue] = useState<"" | "any" | SupplierIssueType>("any");
  const [source, setSource] = useState("oci-supplier");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (issue) params.set("issue", issue);
    if (source) params.set("source", source);
    params.set("limit", "200");
    return `/api/suppliers?${params.toString()}`;
  }, [q, issue, source]);

  const list = useFetch<ListResponse>(url);
  const records = list.data?.records ?? [];

  return (
    <div>
      <PageHeader
        title="Supplier records"
        subtitle="Inspect a site, apply a correction, and keep a versioned audit trail. Final review of updates is under Review."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, number, VAT, city…"
          className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <div className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.id || "all-sources"}
              type="button"
              onClick={() => setSource(f.id)}
              className={`rounded-md px-3 py-1 font-medium ${
                source === f.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {ISSUE_FILTERS.map((f) => (
            <button
              key={f.id || "all"}
              type="button"
              onClick={() => setIssue(f.id)}
              className={`rounded-md px-3 py-1 font-medium ${
                issue === f.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-500">
          {list.data ? `${list.data.total} records` : ""}
        </span>
      </div>

      {list.loading ? <Spinner /> : null}
      {list.error ? <ErrorNote message={list.error} /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,1fr)]">
        <Card className="p-0">
          <div className="max-h-[42rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Site</th>
                  <th className="px-4 py-3 font-medium">Terms / group</th>
                  <th className="px-4 py-3 font-medium">VAT</th>
                  <th className="px-4 py-3 font-medium">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r) => {
                  const types = [...new Set(r.issues.map((i) => i.type))];
                  return (
                    <tr
                      key={r.id}
                      className={`cursor-pointer ${
                        selectedId === r.id ? "bg-indigo-50" : "hover:bg-slate-50"
                      }`}
                      onClick={() => setSelectedId(r.id)}
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900">{r.supplier.name}</div>
                        <div className="text-xs text-slate-500">
                          {r.supplier.supplierNumber} · {dash(r.supplier.type)}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="text-slate-800">{dash(r.site.siteCode)}</div>
                        <div className="text-xs text-slate-500">
                          {dash(r.site.city)} {dash(r.site.country)}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-600">
                        <div>{dash(r.site.paymentTerms)}</div>
                        <div>{dash(r.site.payGroup)}</div>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {dash(r.supplier.supplierVat || r.site.siteVat)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {types.length === 0 ? (
                            <span className="text-xs text-slate-400">Clean</span>
                          ) : (
                            types.map((t) => <IssueBadge key={t} type={t} />)
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {records.length === 0 && !list.loading ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                No records. Load supplier files from the Overview page.
              </p>
            ) : null}
          </div>
        </Card>

        <RecordEditor
          key={selectedId ?? "none"}
          record={records.find((r) => r.id === selectedId) ?? null}
          onSaved={() => list.reload()}
        />
      </div>
    </div>
  );
}

function draftFrom(record: SupplierRecord): Record<string, string> {
  return {
    name: record.supplier.name,
    type: record.supplier.type,
    supplierVat: record.supplier.supplierVat,
    paymentTerms: record.site.paymentTerms,
    payGroup: record.site.payGroup,
    paymentMethod: record.site.paymentMethod,
    country: record.site.country,
    addressLine1: record.site.addressLine1,
    city: record.site.city,
    postalCode: record.site.postalCode,
    siteVat: record.site.siteVat,
  };
}

function RecordEditor({
  record,
  onSaved,
}: {
  record: SupplierRecord | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(
    record ? draftFrom(record) : {},
  );
  const [actor, setActor] = useState("operator");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkingVat, setCheckingVat] = useState(false);
  const [vatCheck, setVatCheck] = useState<SupplierVatCheck | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!record) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/suppliers/${encodeURIComponent(record.id)}/vat-check`);
        const json = await res.json();
        if (!cancelled && json.vatCheck) setVatCheck(json.vatCheck as SupplierVatCheck);
      } catch {
        /* keep empty until the user runs a check */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [record]);

  if (!record) {
    return (
      <Card>
        <p className="text-sm text-slate-400">
          Select a record to review issues and apply a correction. Each save writes a
          new version and an audit event.
        </p>
      </Card>
    );
  }

  function field(name: string, value: string) {
    setDraft((d) => ({ ...d, [name]: value }));
  }

  function applySuggestion(fieldName: string, value: string) {
    field(fieldName, value);
    if (!reason) setReason(`Apply suggested ${fieldName}`);
  }

  async function validateVat() {
    setCheckingVat(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/suppliers/${encodeURIComponent(record!.id)}/vat-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "VAT check failed");
      setVatCheck(json.vatCheck as SupplierVatCheck);
      setMessage((json.vatCheck as SupplierVatCheck).message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "VAT check failed");
    } finally {
      setCheckingVat(false);
    }
  }

  function applyRegisteredName() {
    if (!vatCheck?.registeredName) return;
    field("name", vatCheck.registeredName);
    if (!reason) setReason("Apply VIES registered name");
  }

  function applyRegisteredAddress() {
    if (!vatCheck?.registeredAddress) return;
    const parsed = parseViesAddress(vatCheck.registeredAddress);
    if (parsed.addressLine1) field("addressLine1", parsed.addressLine1);
    if (parsed.city) field("city", parsed.city);
    if (parsed.postalCode) field("postalCode", parsed.postalCode);
    if (!parsed.addressLine1 && !parsed.city) field("addressLine1", vatCheck.registeredAddress);
    if (!reason) setReason("Apply VIES registered address");
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const fields: Partial<Record<SupplierPatchField, string>> = {};
      for (const [k, v] of Object.entries(draft)) {
        fields[k as SupplierPatchField] = v;
      }
      const res = await fetch(`/api/suppliers/${encodeURIComponent(record!.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, actor, reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Update failed");
      setMessage(`Saved version ${json.record.site.version} (${json.audit.length} field change(s)).`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-0">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="font-semibold text-slate-900">{record.supplier.name}</h2>
        <p className="text-xs text-slate-500">
          {record.supplier.supplierNumber} · site {dash(record.site.siteCode)} · v
          {record.site.version}
        </p>
      </div>
      <div className="max-h-[42rem] space-y-4 overflow-auto p-5">
        {record.issues.length ? (
          <ul className="space-y-2">
            {record.issues.map((issue) => (
              <li
                key={issue.id}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              >
                <div className="mb-1 flex items-center gap-2">
                  <IssueBadge type={issue.type} />
                  <SeverityBadge severity={issue.severity} />
                  <span className="font-medium text-slate-800">{issue.title}</span>
                </div>
                <p className="text-xs text-slate-600">{issue.description}</p>
                {issue.suggestion ? (
                  <button
                    type="button"
                    className="mt-1 text-xs font-medium text-indigo-700 hover:underline"
                    onClick={() => applySuggestion(issue.field, issue.suggestion!)}
                  >
                    Apply “{issue.suggestion}”
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-emerald-700">No outstanding issues on this record.</p>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              EU VIES
            </span>
            <VatCheckBadge validity={vatCheck?.validity} />
          </div>
          {vatCheck ? (
            <div className="space-y-1 text-sm text-slate-700">
              <p>{vatCheck.message}</p>
              {vatCheck.registeredName ? (
                <p>
                  Registered name: {vatCheck.registeredName}
                  <button
                    type="button"
                    className="ml-2 text-xs font-medium text-indigo-700 hover:underline"
                    onClick={applyRegisteredName}
                  >
                    Apply name
                  </button>
                </p>
              ) : null}
              {vatCheck.registeredAddress ? (
                <p>
                  Registered address: {vatCheck.registeredAddress}
                  <button
                    type="button"
                    className="ml-2 text-xs font-medium text-indigo-700 hover:underline"
                    onClick={applyRegisteredAddress}
                  >
                    Apply address
                  </button>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Check this VAT ID against the official EU VIES registry (registered name and
              address when the member state publishes them).
            </p>
          )}
          <button
            type="button"
            onClick={validateVat}
            disabled={checkingVat}
            className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
          >
            {checkingVat ? "Checking VIES…" : "Validate VAT with VIES"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" value={draft.name ?? ""} onChange={(v) => field("name", v)} />
          <Field label="Type" value={draft.type ?? ""} onChange={(v) => field("type", v)} />
          <Field
            label="Supplier VAT"
            value={draft.supplierVat ?? ""}
            onChange={(v) => field("supplierVat", v)}
          />
          <Field
            label="Site VAT"
            value={draft.siteVat ?? ""}
            onChange={(v) => field("siteVat", v)}
          />
          <Field
            label="Payment terms"
            value={draft.paymentTerms ?? ""}
            onChange={(v) => field("paymentTerms", v)}
          />
          <Field
            label="Pay group"
            value={draft.payGroup ?? ""}
            onChange={(v) => field("payGroup", v)}
          />
          <Field
            label="Payment method"
            value={draft.paymentMethod ?? ""}
            onChange={(v) => field("paymentMethod", v)}
          />
          <Field
            label="Country"
            value={draft.country ?? ""}
            onChange={(v) => field("country", v)}
          />
          <Field
            label="Address line 1"
            value={draft.addressLine1 ?? ""}
            onChange={(v) => field("addressLine1", v)}
            className="col-span-2"
          />
          <Field label="City" value={draft.city ?? ""} onChange={(v) => field("city", v)} />
          <Field
            label="Postal code"
            value={draft.postalCode ?? ""}
            onChange={(v) => field("postalCode", v)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Actor" value={actor} onChange={setActor} />
          <Field
            label="Reason"
            value={reason}
            onChange={setReason}
            placeholder="Why this change?"
          />
        </div>

        {error ? <ErrorNote message={error} /> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save new version"}
        </button>
      </div>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  className = "",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <label className={`block text-xs ${className}`}>
      <span className="font-medium text-slate-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
      />
    </label>
  );
}
