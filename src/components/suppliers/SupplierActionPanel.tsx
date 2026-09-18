"use client";

import { useEffect, useState } from "react";

import {
  Card,
  ErrorNote,
  IssueBadge,
  SeverityBadge,
  VatCheckBadge,
} from "@/components/ui";
import type { GraphFocus } from "@/components/suppliers/SupplierSiteGraph";
import type { SupplierGroup } from "@/lib/suppliers/group";
import { siteIssuesFor, siteLabel, supplierIssuesFor } from "@/lib/suppliers/group";
import { isStandardPaymentTerms, STANDARD_PAYMENT_TERMS } from "@/lib/suppliers/rationalise";
import type {
  SupplierIssue,
  SupplierPatchField,
  SupplierRecord,
  SupplierVatCheck,
  VatScope,
} from "@/lib/suppliers/types";
import { parseViesAddress } from "@/lib/suppliers/viesCompare";

function dash(value: string | undefined): string {
  return value?.trim() ? value : "—";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function supplierDraftFrom(record: SupplierRecord): Record<string, string> {
  return {
    name: record.supplier.name,
    type: record.supplier.type,
    supplierVat: record.supplier.supplierVat,
  };
}

function siteDraftFrom(record: SupplierRecord): Record<string, string> {
  return {
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

export function SupplierActionPanel({
  group,
  sites,
  focus,
  onFocus,
  onSaved,
}: {
  group: SupplierGroup | null;
  sites: SupplierRecord[];
  focus: GraphFocus;
  onFocus: (focus: GraphFocus) => void;
  onSaved: () => void;
}) {
  const siteRecord =
    focus.kind === "site"
      ? (sites.find((r) => r.site.id === focus.siteId) ?? null)
      : (sites[0] ?? group?.records[0] ?? null);
  const record = siteRecord;
  const scope: VatScope = focus.kind === "site" ? "site" : "supplier";
  const recordKey = `${record?.supplier.id ?? "none"}:${scope}:${record?.site.id ?? "none"}`;

  if (!group) {
    return (
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <p className="text-sm text-slate-400">
          Select a supplier, then a site in the graph, to review issues and apply a correction.
        </p>
      </Card>
    );
  }

  if (!record) {
    return (
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <p className="text-sm text-slate-400">This supplier has no sites in the working copy.</p>
      </Card>
    );
  }

  return (
    <ActionEditor
      key={recordKey}
      group={group}
      sites={sites}
      record={record}
      scope={scope}
      focus={focus}
      onFocus={onFocus}
      onSaved={onSaved}
    />
  );
}

function ActionEditor({
  group,
  sites,
  record,
  scope,
  focus,
  onFocus,
  onSaved,
}: {
  group: SupplierGroup;
  sites: SupplierRecord[];
  record: SupplierRecord;
  scope: VatScope;
  focus: GraphFocus;
  onFocus: (focus: GraphFocus) => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(
    scope === "supplier" ? supplierDraftFrom(record) : siteDraftFrom(record),
  );
  const [actor, setActor] = useState("operator");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkingVat, setCheckingVat] = useState(false);
  const [supplierVatCheck, setSupplierVatCheck] = useState<SupplierVatCheck | null>(null);
  const [siteVatCheck, setSiteVatCheck] = useState<SupplierVatCheck | null>(null);
  const [makeInactive, setMakeInactive] = useState(
    scope === "supplier"
      ? record.supplier.status === "inactive" || Boolean(record.supplier.inactiveDate)
      : Boolean(record.site.inactiveDate),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, [record.id]);

  const issues =
    scope === "supplier"
      ? supplierIssuesFor(sites.length ? sites : group.records)
      : siteIssuesFor(record);

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
      const res = await fetch(`/api/suppliers/${encodeURIComponent(record.id)}/vat-check`, {
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
      setCheckingVat(false);
    }
  }

  function applyRegisteredName() {
    const name = supplierVatCheck?.registeredName || siteVatCheck?.registeredName;
    if (!name) return;
    if (scope !== "supplier") return;
    field("name", name);
    if (!reason) setReason("Apply VIES registered name");
  }

  function applyRegisteredAddress() {
    const address = siteVatCheck?.registeredAddress || supplierVatCheck?.registeredAddress;
    if (!address || scope !== "site") return;
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
      if (scope === "supplier") {
        fields.name = draft.name ?? "";
        fields.type = draft.type ?? "";
        fields.supplierVat = draft.supplierVat ?? "";
        fields.status = makeInactive ? "inactive" : "active";
      } else {
        fields.paymentTerms = draft.paymentTerms ?? "";
        fields.payGroup = draft.payGroup ?? "";
        fields.paymentMethod = draft.paymentMethod ?? "";
        fields.country = draft.country ?? "";
        fields.addressLine1 = draft.addressLine1 ?? "";
        fields.city = draft.city ?? "";
        fields.postalCode = draft.postalCode ?? "";
        fields.siteVat = draft.siteVat ?? "";
        if (makeInactive) fields.inactiveDate = draft.inactiveDate?.trim() || todayIsoDate();
        else if (record.site.inactiveDate) fields.inactiveDate = "";
      }
      const res = await fetch(`/api/suppliers/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, actor, reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Update failed");
      const version =
        scope === "supplier" ? json.record.supplier.version : json.record.site.version;
      setMessage(`Saved ${scope} v${version} (${json.audit.length} change(s)).`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  const vatId = scope === "supplier" ? record.supplier.supplierVat : record.site.siteVat;
  const vatCheck = scope === "supplier" ? supplierVatCheck : siteVatCheck;
  const title = scope === "supplier" ? record.supplier.name : dash(record.site.siteCode);
  const subtitle =
    scope === "supplier"
      ? `${record.supplier.supplierNumber} · ${dash(record.supplier.type)} · v${record.supplier.version}`
      : `${dash(record.site.city)} ${dash(record.site.country)} · v${record.site.version}`;

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden p-0">
      <div className="shrink-0 border-b border-slate-100 px-4 py-2">
        <div className="mb-2 flex flex-wrap gap-1">
          <ScopeChip
            label="Supplier"
            active={scope === "supplier"}
            issueCount={supplierIssuesFor(sites.length ? sites : group.records).length}
            onClick={() => onFocus({ kind: "supplier" })}
          />
          {sites.map((r) => (
            <ScopeChip
              key={r.site.id}
              label={siteLabel(r, sites)}
              active={scope === "site" && focus.kind === "site" && focus.siteId === r.site.id}
              issueCount={siteIssuesFor(r).length}
              onClick={() => onFocus({ kind: "site", siteId: r.site.id })}
            />
          ))}
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {scope === "supplier" ? "Supplier" : "Site"}
            </div>
            <h2 className="truncate font-semibold text-slate-900">{title}</h2>
            <p className="truncate text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
      </div>

      <IssueStrip issues={issues} onApply={applySuggestion} />

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
        <VatRow
          scope={scope}
          vatId={vatId}
          check={vatCheck}
          checking={checkingVat}
          onValidate={validateVat}
          onApplyName={scope === "supplier" ? applyRegisteredName : undefined}
          onApplyAddress={scope === "site" ? applyRegisteredAddress : undefined}
          vatValue={scope === "supplier" ? (draft.supplierVat ?? "") : (draft.siteVat ?? "")}
          onVatChange={(v) => field(scope === "supplier" ? "supplierVat" : "siteVat", v)}
        />

        {scope === "supplier" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name" value={draft.name ?? ""} onChange={(v) => field("name", v)} />
            <Field label="Type" value={draft.type ?? ""} onChange={(v) => field("type", v)} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <PaymentTermsField
              value={draft.paymentTerms ?? ""}
              onChange={(v) => field("paymentTerms", v)}
            />
            <Field label="Pay group" value={draft.payGroup ?? ""} onChange={(v) => field("payGroup", v)} />
            <Field
              label="Payment method"
              value={draft.paymentMethod ?? ""}
              onChange={(v) => field("paymentMethod", v)}
            />
            <Field label="Country" value={draft.country ?? ""} onChange={(v) => field("country", v)} />
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
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
        {error ? <ErrorNote message={error} /> : null}
        {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Actor" value={actor} onChange={setActor} />
          <Field label="Reason" value={reason} onChange={setReason} placeholder="Why this change?" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={makeInactive}
              onChange={(e) => {
                const checked = e.target.checked;
                setMakeInactive(checked);
                if (scope === "site") {
                  field("inactiveDate", checked ? draft.inactiveDate || todayIsoDate() : "");
                }
                if (checked && !reason) {
                  setReason(scope === "supplier" ? "Make supplier inactive" : "Make site inactive");
                }
              }}
            />
            Make {scope} inactive
          </label>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : `Save ${scope}`}
          </button>
        </div>
      </div>
    </Card>
  );
}

function ScopeChip({
  label,
  active,
  issueCount,
  onClick,
}: {
  label: string;
  active: boolean;
  issueCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`max-w-[10rem] truncate rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
      {issueCount ? <span className="ml-1 opacity-80">{issueCount}</span> : null}
    </button>
  );
}

function IssueStrip({
  issues,
  onApply,
}: {
  issues: SupplierIssue[];
  onApply: (field: string, value: string) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="shrink-0 border-b border-emerald-100 bg-emerald-50 px-4 py-1.5 text-xs font-medium text-emerald-800">
        No outstanding issues
      </div>
    );
  }
  return (
    <div className="shrink-0 space-y-1 border-b border-amber-100 bg-amber-50 px-4 py-2">
      {issues.map((issue) => (
        <div key={issue.id} className="flex flex-wrap items-center gap-1.5 text-xs">
          <IssueBadge type={issue.type} />
          <SeverityBadge severity={issue.severity} />
          <span className="font-medium text-slate-800">{issue.title}</span>
          <span className="text-slate-600">{issue.description}</span>
          {issue.suggestion ? (
            <button
              type="button"
              className="font-medium text-indigo-700 hover:underline"
              onClick={() => onApply(issue.field, issue.suggestion!)}
            >
              Apply “{issue.suggestion}”
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function VatRow({
  scope,
  vatId,
  check,
  checking,
  onValidate,
  onApplyName,
  onApplyAddress,
  vatValue,
  onVatChange,
}: {
  scope: VatScope;
  vatId: string;
  check: SupplierVatCheck | null;
  checking: boolean;
  onValidate: () => void;
  onApplyName?: () => void;
  onApplyAddress?: () => void;
  vatValue: string;
  onVatChange: (value: string) => void;
}) {
  const hasVat = Boolean(vatId.trim());
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-700">
          {scope === "supplier" ? "Supplier VAT" : "Site VAT"}
        </span>
        {hasVat ? <VatCheckBadge validity={check?.validity} /> : null}
        <button
          type="button"
          onClick={onValidate}
          disabled={checking || !hasVat}
          className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
        >
          {checking ? "Checking…" : "Validate VIES"}
        </button>
      </div>
      <input
        value={vatValue}
        onChange={(e) => onVatChange(e.target.value)}
        className="mt-1.5 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs text-slate-900"
      />
      {check && hasVat ? (
        <div className="mt-1 space-y-0.5 text-[11px] text-slate-600">
          <p>{check.message}</p>
          {check.registeredName && onApplyName ? (
            <p>
              {check.registeredName}{" "}
              <button type="button" className="font-medium text-indigo-700 hover:underline" onClick={onApplyName}>
                Apply name
              </button>
            </p>
          ) : null}
          {check.registeredAddress && onApplyAddress ? (
            <p>
              {check.registeredAddress}{" "}
              <button
                type="button"
                className="font-medium text-indigo-700 hover:underline"
                onClick={onApplyAddress}
              >
                Apply address
              </button>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-slate-500">
          {hasVat ? `Validate the ${scope} VAT ID against EU VIES.` : `No ${scope} VAT ID on this record.`}
        </p>
      )}
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
    <label className="block text-[11px]">
      <span className="flex items-center gap-1.5 font-medium text-slate-500">
        Payment terms
        {!standard && value.trim() ? (
          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
            Non-standard
          </span>
        ) : null}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900"
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
    <label className={`block text-[11px] ${className}`}>
      <span className="font-medium text-slate-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900"
      />
    </label>
  );
}
