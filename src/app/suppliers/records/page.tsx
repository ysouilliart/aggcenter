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
  VatScope,
} from "@/lib/suppliers/types";
import { isStandardPaymentTerms, STANDARD_PAYMENT_TERMS } from "@/lib/suppliers/rationalise";
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
                  <th className="px-4 py-3 font-medium">Supplier VAT</th>
                  <th className="px-4 py-3 font-medium">Site VAT</th>
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
                        {dash(r.supplier.supplierVat)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {dash(r.site.siteVat)}
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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
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
    inactiveDate: record.site.inactiveDate ?? "",
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
  const [checkingVat, setCheckingVat] = useState<VatScope | null>(null);
  const [supplierVatCheck, setSupplierVatCheck] = useState<SupplierVatCheck | null>(null);
  const [siteVatCheck, setSiteVatCheck] = useState<SupplierVatCheck | null>(null);
  const [makeInactive, setMakeInactive] = useState(Boolean(record?.site.inactiveDate));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!record) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/suppliers/${encodeURIComponent(record.id)}/vat-check`);
        const json = await res.json();
        if (cancelled) return;
        if (json.supplierVatCheck) setSupplierVatCheck(json.supplierVatCheck as SupplierVatCheck);
        if (json.siteVatCheck) setSiteVatCheck(json.siteVatCheck as SupplierVatCheck);
        const latest = json.vatCheck as SupplierVatCheck | undefined;
        if (latest?.vatScope === "supplier") setSupplierVatCheck(latest);
        if (latest?.vatScope === "site") setSiteVatCheck(latest);
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

  async function validateVat(scope: VatScope) {
    setCheckingVat(scope);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/suppliers/${encodeURIComponent(record!.id)}/vat-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor, scope }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "VAT check failed");
      const check = json.vatCheck as SupplierVatCheck;
      if (scope === "supplier") setSupplierVatCheck(check);
      else setSiteVatCheck(check);
      setMessage(check.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "VAT check failed");
    } finally {
      setCheckingVat(null);
    }
  }

  function applyRegisteredName() {
    const name = supplierVatCheck?.registeredName || siteVatCheck?.registeredName;
    if (!name) return;
    field("name", name);
    if (!reason) setReason("Apply VIES registered name");
  }

  function applyRegisteredAddress() {
    const address = siteVatCheck?.registeredAddress || supplierVatCheck?.registeredAddress;
    if (!address) return;
    const parsed = parseViesAddress(address);
    if (parsed.addressLine1) field("addressLine1", parsed.addressLine1);
    if (parsed.city) field("city", parsed.city);
    if (parsed.postalCode) field("postalCode", parsed.postalCode);
    if (!parsed.addressLine1 && !parsed.city) field("addressLine1", address);
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
      if (makeInactive) {
        fields.inactiveDate = draft.inactiveDate?.trim() || todayIsoDate();
      } else if (record!.site.inactiveDate) {
        fields.inactiveDate = "";
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
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            EU VIES
          </div>
          <div className="space-y-3">
            <ViesScopeBlock
              scope="supplier"
              vatId={record.supplier.supplierVat}
              check={supplierVatCheck}
              checking={checkingVat === "supplier"}
              onValidate={() => validateVat("supplier")}
              onApplyName={applyRegisteredName}
              onApplyAddress={applyRegisteredAddress}
            />
            <ViesScopeBlock
              scope="site"
              vatId={record.site.siteVat}
              check={siteVatCheck}
              checking={checkingVat === "site"}
              onValidate={() => validateVat("site")}
              onApplyName={applyRegisteredName}
              onApplyAddress={applyRegisteredAddress}
            />
          </div>
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
          <PaymentTermsField
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

        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={makeInactive}
            onChange={(e) => {
              const checked = e.target.checked;
              setMakeInactive(checked);
              field("inactiveDate", checked ? draft.inactiveDate || todayIsoDate() : "");
              if (checked && !reason) setReason("Make site inactive");
            }}
          />
          Make inactive
        </label>
        {makeInactive ? (
          <p className="text-xs text-slate-500">
            Inactive date on this site: {draft.inactiveDate || todayIsoDate()}
          </p>
        ) : null}

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

function ViesScopeBlock({
  scope,
  vatId,
  check,
  checking,
  onValidate,
  onApplyName,
  onApplyAddress,
}: {
  scope: VatScope;
  vatId: string;
  check: SupplierVatCheck | null;
  checking: boolean;
  onValidate: () => void;
  onApplyName: () => void;
  onApplyAddress: () => void;
}) {
  const label = scope === "supplier" ? "Supplier VAT" : "Site VAT";
  const hasVat = Boolean(vatId.trim());
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        {hasVat ? <VatCheckBadge validity={check?.validity} /> : null}
      </div>
      <p className="font-mono text-xs text-slate-700">{dash(vatId)}</p>
      {check && hasVat ? (
        <div className="mt-1 space-y-1 text-sm text-slate-700">
          <p>{check.message}</p>
          {check.registeredName ? (
            <p>
              Registered name: {check.registeredName}
              <button
                type="button"
                className="ml-2 text-xs font-medium text-indigo-700 hover:underline"
                onClick={onApplyName}
              >
                Apply name
              </button>
            </p>
          ) : null}
          {check.registeredAddress ? (
            <p>
              Registered address: {check.registeredAddress}
              <button
                type="button"
                className="ml-2 text-xs font-medium text-indigo-700 hover:underline"
                onClick={onApplyAddress}
              >
                Apply address
              </button>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-500">
          {hasVat
            ? `Validate the ${scope} VAT ID against EU VIES.`
            : `No ${scope} VAT ID on this record.`}
        </p>
      )}
      <button
        type="button"
        onClick={onValidate}
        disabled={checking || !hasVat}
        className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
      >
        {checking ? "Checking VIES…" : `Validate ${label}`}
      </button>
    </div>
  );
}

function PaymentTermsField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const standard = isStandardPaymentTerms(value);
  return (
    <label className="block text-xs">
      <span className="flex items-center gap-2 font-medium text-slate-500">
        Payment terms
        {!standard && value.trim() ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
            Non-standard
          </span>
        ) : null}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
      >
        {!standard ? <option value={value}>{value.trim() ? value : "Select…"}</option> : null}
        {STANDARD_PAYMENT_TERMS.map((term) => (
          <option key={term} value={term}>
            {term}
          </option>
        ))}
      </select>
    </label>
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
