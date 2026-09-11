"use client";

import { useMemo, useState } from "react";

import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import type { SupplierAuditEvent, SupplierVersion } from "@/lib/suppliers/types";
import { formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

interface AuditResponse {
  audit: SupplierAuditEvent[];
  versions: SupplierVersion[];
}

export default function SupplierAuditPage() {
  const [recordId, setRecordId] = useState("");
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (recordId.trim()) params.set("recordId", recordId.trim());
    const qs = params.toString();
    return qs ? `/api/suppliers/audit?${qs}` : "/api/suppliers/audit";
  }, [recordId]);
  const state = useFetch<AuditResponse>(url);
  const audit = state.data?.audit ?? [];
  const versions = state.data?.versions ?? [];

  return (
    <div>
      <PageHeader
        title="Supplier audit"
        subtitle="Version snapshots and field-level history live here — separate from the working copy"
      />

      <div className="mb-4">
        <input
          value={recordId}
          onChange={(e) => setRecordId(e.target.value)}
          placeholder="Filter by record id…"
          className="w-72 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      {state.loading ? <Spinner /> : null}
      {state.error ? <ErrorNote message={state.error} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold text-slate-900">Audit events</h2>
          </div>
          {audit.length === 0 && !state.loading ? (
            <p className="px-5 py-8 text-sm text-slate-400">No audit events yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {audit.map((e) => (
                <li key={e.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-600">
                      {e.action}
                    </span>
                    <span className="font-medium text-slate-900">{e.field ?? "record"}</span>
                    <span className="text-xs text-slate-400">{e.recordType}:{e.recordId}</span>
                  </div>
                  {e.field ? (
                    <p className="mt-1 font-mono text-xs text-slate-600">
                      {e.oldValue || "∅"} → {e.newValue || "∅"}
                    </p>
                  ) : (
                    <p className="mt-1 font-mono text-xs text-slate-500">{e.newValue}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {e.actor}
                    {e.reason ? ` · ${e.reason}` : ""} · {formatDate(e.createdAt)} · v{e.version}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-0">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold text-slate-900">Record versions</h2>
          </div>
          {versions.length === 0 && !state.loading ? (
            <p className="px-5 py-8 text-sm text-slate-400">
              Versions appear when a record is updated.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {versions.map((v) => (
                <li key={v.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">
                      {v.recordType} {v.recordId}
                    </span>
                    <span className="text-xs text-slate-500">v{v.version}</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {v.actor}
                    {v.reason ? ` · ${v.reason}` : ""} · {formatDate(v.createdAt)}
                  </p>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
                    {JSON.stringify(v.snapshot, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
