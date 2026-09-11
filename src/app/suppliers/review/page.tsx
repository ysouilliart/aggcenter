"use client";

import { useState } from "react";

import { Card, ErrorNote, PageHeader, Spinner, VatCheckBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { parseViesAddress } from "@/lib/suppliers/viesCompare";
import type { SupplierReviewItem, SupplierVatCheck } from "@/lib/suppliers/types";
import { useFetch } from "@/lib/useFetch";

function dash(value: string | undefined): string {
  return value?.trim() ? value : "—";
}

function fieldLabel(field: string): string {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

interface ReviewResponse {
  items: SupplierReviewItem[];
}

export default function SupplierReviewPage() {
  const state = useFetch<ReviewResponse>("/api/suppliers/review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const items = state.data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;

  async function validateIds(ids: string[], scope?: "supplier" | "site") {
    setChecking(scope ?? "batch");
    setBatchError(null);
    setBatchMessage(null);
    try {
      const res = await fetch("/api/suppliers/review/vat-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, actor: "operator", scope }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "VAT check failed");
      const n = (json.checks as SupplierVatCheck[] | undefined)?.length ?? 0;
      const errors = (json.errors as { id: string; error: string }[] | undefined) ?? [];
      setBatchMessage(
        `Checked ${n} VAT ID${n === 1 ? "" : "s"}` +
          (errors.length ? ` · ${errors.length} failed` : "") +
          ".",
      );
      state.reload();
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "VAT check failed");
    } finally {
      setChecking(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Final review"
        subtitle="Records updated and streamlined — confirm what changed, then validate VAT IDs against the EU VIES registry"
        actions={
          <button
            type="button"
            onClick={() => validateIds(items.map((i) => i.id))}
            disabled={Boolean(checking) || items.length === 0}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {checking === "batch" ? "Checking VIES…" : "Validate VAT on listed records"}
          </button>
        }
      />

      {state.loading ? <Spinner /> : null}
      {state.error ? <ErrorNote message={state.error} /> : null}
      {batchError ? <ErrorNote message={batchError} /> : null}
      {batchMessage ? <p className="mb-4 text-sm text-emerald-700">{batchMessage}</p> : null}

      {items.length === 0 && !state.loading ? (
        <Card>
          <p className="text-sm text-slate-500">
            No updated records yet. Apply corrections on Records, then return here for a
            before/after review and VIES VAT validation.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,1fr)]">
          <Card className="p-0">
            <div className="max-h-[42rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-medium">Supplier</th>
                    <th className="px-4 py-3 font-medium">Changed</th>
                    <th className="px-4 py-3 font-medium">VAT IDs</th>
                    <th className="px-4 py-3 font-medium">VAT registry</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const isSelected = (selected?.id ?? "") === item.id;
                    return (
                      <tr
                        key={item.id}
                        className={`cursor-pointer ${
                          isSelected ? "bg-indigo-50" : "hover:bg-slate-50"
                        }`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-900">{item.supplier.name}</div>
                          <div className="text-xs text-slate-500">
                            {item.supplier.supplierNumber} · {dash(item.site.siteCode)}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-600">
                          {item.changes.map((c) => fieldLabel(c.field)).join(", ")}
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-700">
                          <div>Sup {dash(item.supplier.supplierVat)}</div>
                          <div>Site {dash(item.site.siteVat)}</div>
                        </td>
                        <td className="px-4 py-2">
                          <VatCheckBadge validity={item.vatCheck?.validity} />
                          {item.vatCheck?.vatScope ? (
                            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                              {item.vatCheck.vatScope} VAT
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">
                          {formatDate(item.lastUpdatedAt)}
                          <div>{item.lastActor}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {selected ? (
            <ReviewDetail
              item={selected}
              checking={checking}
              onValidate={(scope) => validateIds([selected.id], scope)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function ReviewDetail({
  item,
  checking,
  onValidate,
}: {
  item: SupplierReviewItem;
  checking: string | null;
  onValidate: (scope: "supplier" | "site") => void;
}) {
  const check = item.vatCheck;
  const parsed = check?.registeredAddress ? parseViesAddress(check.registeredAddress) : {};
  const supplierVat = item.supplier.supplierVat.trim();
  const siteVat = item.site.siteVat.trim();

  return (
    <Card className="p-0">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="font-semibold text-slate-900">{item.supplier.name}</h2>
        <p className="text-xs text-slate-500">
          {item.supplier.supplierNumber} · site {dash(item.site.siteCode)} · v
          {item.site.version}
        </p>
      </div>
      <div className="max-h-[42rem] space-y-4 overflow-auto p-5">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            What changed
          </h3>
          <ul className="space-y-2">
            {item.changes.map((c) => (
              <li key={c.field} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <div className="text-xs font-medium text-slate-500">{fieldLabel(c.field)}</div>
                <p className="mt-1 font-mono text-xs text-slate-700">
                  <span className="text-rose-700">{c.from || "∅"}</span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span className="text-emerald-700">{c.to || "∅"}</span>
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            {item.updateCount} field update{item.updateCount === 1 ? "" : "s"}
            {item.lastReason ? ` · ${item.lastReason}` : ""} · {item.lastActor}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              EU VIES VAT check
            </h3>
            <VatCheckBadge validity={check?.validity} />
          </div>
          <p className="font-mono text-xs text-slate-700">
            Supplier {dash(supplierVat)} · Site {dash(siteVat)}
          </p>
          {check ? (
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              <p>
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {check.vatScope ?? "VAT"} check ·{" "}
                </span>
                {check.message}
              </p>
              {check.registeredName ? (
                <p>
                  <span className="text-xs font-medium text-slate-500">Registered name · </span>
                  {check.registeredName}
                  <MatchHint match={check.nameMatch} />
                </p>
              ) : null}
              {check.registeredAddress ? (
                <p>
                  <span className="text-xs font-medium text-slate-500">Registered address · </span>
                  {check.registeredAddress}
                  <MatchHint match={check.addressMatch} />
                </p>
              ) : null}
              {parsed.city || parsed.postalCode ? (
                <p className="text-xs text-slate-500">
                  Parsed: {dash(parsed.addressLine1)} · {dash(parsed.postalCode)}{" "}
                  {dash(parsed.city)}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              Not checked yet. VIES is the official EU VAT registry and returns the name and
              address on file when the member state publishes them.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onValidate("supplier")}
              disabled={Boolean(checking) || !supplierVat}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            >
              {checking === "supplier" ? "Checking…" : "Validate supplier VAT"}
            </button>
            <button
              type="button"
              onClick={() => onValidate("site")}
              disabled={Boolean(checking) || !siteVat}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            >
              {checking === "site" ? "Checking…" : "Validate site VAT"}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function MatchHint({ match }: { match: string }) {
  if (match === "match") {
    return <span className="ml-1 text-xs font-medium text-emerald-700">matches record</span>;
  }
  if (match === "mismatch") {
    return <span className="ml-1 text-xs font-medium text-rose-700">differs from record</span>;
  }
  return <span className="ml-1 text-xs text-slate-400">not compared</span>;
}
