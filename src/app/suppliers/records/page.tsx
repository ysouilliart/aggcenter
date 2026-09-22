"use client";

import TextField from "@mui/material/TextField";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { SupplierActionPanel } from "@/components/suppliers/SupplierActionPanel";
import type { GraphFocus } from "@/components/suppliers/SupplierSiteGraph";
import { Card, ErrorNote, IssueBadge, PageHeader, SegmentedToggle, SortTh, Spinner } from "@/components/ui";
import { groupSupplierRecords } from "@/lib/suppliers/group";
import type { SupplierIssueType, SupplierRecord } from "@/lib/suppliers/types";
import { useFetch } from "@/lib/useFetch";
import { useSort } from "@/lib/useSort";

const SupplierSiteGraph = dynamic(
  () => import("@/components/suppliers/SupplierSiteGraph").then((m) => m.SupplierSiteGraph),
  { ssr: false, loading: () => <p className="px-4 py-6 text-sm text-slate-400">Loading graph…</p> },
);

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

function groupSortValue(
  row: ReturnType<typeof groupSupplierRecords>[number],
  key: string,
): unknown {
  switch (key) {
    case "supplier":
      return row.supplier.name;
    case "sites":
      return row.siteCount;
    case "vat":
      return row.supplier.supplierVat;
    case "issues":
      return row.issues.length;
    default:
      return "";
  }
}

function dash(value: string | undefined): string {
  return value?.trim() ? value : "—";
}

export default function SupplierRecordsPage() {
  const [q, setQ] = useState("");
  const [issue, setIssue] = useState<"" | "any" | SupplierIssueType>("any");
  const [source, setSource] = useState("oci-supplier");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [focus, setFocus] = useState<GraphFocus>({ kind: "supplier" });

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (issue) params.set("issue", issue);
    if (source) params.set("source", source);
    params.set("limit", "500");
    return `/api/suppliers?${params.toString()}`;
  }, [q, issue, source]);

  const list = useFetch<ListResponse>(listUrl);
  const groups = useMemo(() => groupSupplierRecords(list.data?.records ?? []), [list.data?.records]);
  const sorted = useSort(groups, groupSortValue);
  const selectedGroup = groups.find((g) => g.id === selectedSupplierId) ?? null;
  const activeSupplierId = selectedGroup?.id ?? null;

  const sitesUrl = useMemo(() => {
    if (!activeSupplierId) return listUrl;
    const params = new URLSearchParams();
    params.set("supplierId", activeSupplierId);
    if (source) params.set("source", source);
    params.set("limit", "500");
    return `/api/suppliers?${params.toString()}`;
  }, [activeSupplierId, listUrl, source]);

  const sitesState = useFetch<ListResponse>(sitesUrl);
  const selectedSites = activeSupplierId
    ? (sitesState.data?.records ?? selectedGroup?.records ?? [])
    : [];

  function selectSupplier(id: string) {
    setSelectedSupplierId(id);
    setFocus({ kind: "supplier" });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0">
        <PageHeader
          className="mb-3"
          title="Supplier records"
          subtitle="Pick a unique supplier, inspect its sites and operating units in the graph, then correct supplier- or site-level data. Final review of updates is under Review."
        />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TextField
            size="small"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, number, VAT, city, OU…"
            sx={{ width: 256 }}
          />
          <SegmentedToggle
            value={source || "all"}
            onChange={(next) => setSource(next === "all" ? "" : next)}
            options={SOURCE_FILTERS.map((f) => ({ value: f.id || "all", label: f.label }))}
          />
          <SegmentedToggle
            value={issue || "all-issues"}
            onChange={(next) =>
              setIssue((next === "all-issues" ? "" : next) as "" | "any" | SupplierIssueType)
            }
            options={ISSUE_FILTERS.map((f) => ({
              value: f.id || "all-issues",
              label: f.label,
            }))}
          />
          <span className="ml-auto text-xs text-slate-500">
            {list.data
              ? `${groups.length} suppliers · ${list.data.records.length} listed sites`
              : ""}
          </span>
        </div>

        {list.loading && !list.data ? <Spinner /> : null}
        {list.error ? <ErrorNote message={list.error} /> : null}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden max-xl:grid-rows-[minmax(14rem,42vh)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.95fr)]">
        <div className="grid min-h-0 grid-rows-[minmax(10rem,1fr)_minmax(14rem,1fr)] gap-4 overflow-hidden">
          <Card className="flex min-h-0 flex-col overflow-hidden p-0">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-xs font-medium text-slate-500">
                    <SortTh
                      className="px-4 py-2 font-medium"
                      label="Supplier"
                      column="supplier"
                      sortKey={sorted.sortKey}
                      sortDir={sorted.sortDir}
                      onSort={sorted.toggle}
                    />
                    <SortTh
                      className="px-4 py-2 font-medium"
                      label="Sites"
                      column="sites"
                      sortKey={sorted.sortKey}
                      sortDir={sorted.sortDir}
                      onSort={sorted.toggle}
                    />
                    <SortTh
                      className="px-4 py-2 font-medium"
                      label="VAT"
                      column="vat"
                      sortKey={sorted.sortKey}
                      sortDir={sorted.sortDir}
                      onSort={sorted.toggle}
                    />
                    <SortTh
                      className="px-4 py-2 font-medium"
                      label="Issues"
                      column="issues"
                      sortKey={sorted.sortKey}
                      sortDir={sorted.sortDir}
                      onSort={sorted.toggle}
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.rows.map((g) => {
                    const types = [...new Set(g.issues.map((i) => i.type))];
                    return (
                      <tr
                        key={g.id}
                        className={`cursor-pointer ${
                          selectedSupplierId === g.id ? "bg-brand-soft" : "hover:bg-slate-50"
                        }`}
                        onClick={() => selectSupplier(g.id)}
                      >
                        <td className="px-4 py-1.5">
                          <div className="font-medium text-slate-900">{g.supplier.name}</div>
                          <div className="text-xs text-slate-500">
                            {g.supplier.supplierNumber} · {dash(g.supplier.type)}
                          </div>
                        </td>
                        <td className="px-4 py-1.5 tabular-nums text-slate-700">{g.siteCount}</td>
                        <td className="px-4 py-1.5 font-mono text-[11px] text-slate-700">
                          {dash(g.supplier.supplierVat)}
                        </td>
                        <td className="px-4 py-1.5">
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
              {groups.length === 0 && !list.loading ? (
                <p className="px-4 py-10 text-center text-sm text-slate-400">
                  No suppliers. Load supplier files from the Overview page.
                </p>
              ) : null}
            </div>
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden p-0">
            <div className="shrink-0 border-b border-slate-100 px-4 py-2 text-xs font-semibold text-slate-500">
              Supplier · sites
            </div>
            <div className="min-h-0 flex-1">
              <SupplierSiteGraph
                group={selectedGroup}
                sites={selectedSites}
                focus={focus}
                onFocus={setFocus}
              />
            </div>
          </Card>
        </div>

        <SupplierActionPanel
          group={selectedGroup}
          sites={selectedSites}
          focus={focus}
          onFocus={setFocus}
          onSaved={() => {
            list.reload();
            sitesState.reload();
          }}
        />
      </div>
    </div>
  );
}
