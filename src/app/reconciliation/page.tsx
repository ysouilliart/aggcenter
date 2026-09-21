"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DonutChart } from "@/components/charts";
import { chartColors } from "@/components/theme";
import {
  Card,
  ErrorNote,
  KpiCard,
  PageHeader,
  SegmentedToggle,
  SortTh,
  Spinner,
  StatusBadge,
} from "@/components/ui";
import type {
  AnalysisStep,
  MatchStatus,
  ReconciliationResult,
  SupportingDocRef,
} from "@/lib/domain/types";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import {
  MATCH_PATTERN_LABELS,
  MATCH_RULES,
  matchedToDocs,
} from "@/lib/recon/match-notes";
import { useFetch } from "@/lib/useFetch";
import { useSort } from "@/lib/useSort";

interface ReconResponse {
  results: ReconciliationResult[];
  summary: {
    total: number;
    matched: number;
    partial: number;
    unmatched: number;
    matchRate: number;
  };
}

const FILTERS: (MatchStatus | "all")[] = [
  "all",
  "matched",
  "partial",
  "unmatched",
];

function reconSortValue(row: ReconciliationResult, key: string): unknown {
  switch (key) {
    case "date":
      return row.date;
    case "flow":
      return row.flow;
    case "amount":
      return row.amount;
    case "status":
      return row.status;
    case "pattern":
      return row.matchPattern ?? "";
    case "matched":
      return matchedToDocs(row)
        .map((doc) => doc.label)
        .join(" ");
    case "confidence":
      return row.confidence;
    default:
      return "";
  }
}

export default function ReconciliationPage() {
  const { data, error, loading } = useFetch<ReconResponse>("/api/reconciliation");
  const [filter, setFilter] = useState<MatchStatus | "all">("all");
  const [currency, setCurrency] = useState<string>("GBP");

  const currencies = useMemo(() => {
    const found = [...new Set((data?.results ?? []).map((r) => r.currency))];
    found.sort();
    return found;
  }, [data]);

  const results = useMemo(
    () =>
      (data?.results ?? []).filter((r) => {
        if (filter !== "all" && r.status !== filter) return false;
        if (currency !== "all" && r.currency !== currency) return false;
        return true;
      }),
    [data, filter, currency],
  );
  const sorted = useSort(results, reconSortValue);
  const summary = data?.summary;

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        subtitle="Bank-statement baseline: each payment is identified with supporting SO, PO, and remittance files. Unmatched means that supporting file is not in the system."
      />

      <Card className="mb-6">
        <h2 className="text-[13px] font-medium text-slate-800">Matching rules</h2>
        <p className="mt-1 text-xs text-slate-500">
          How a bank line becomes Matched, Partial, or Unmatched. Amount
          matching uses 0 tolerance (exact cents); date is not a constraint.
          Lookup order lives here, not on each row. Matched to lists the
          remittance / PO / SO numbers used as evidence.
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MATCH_RULES.map((rule) => (
            <div key={rule.title} className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold text-slate-700">
                {rule.title}
              </dt>
              <dd className="mt-1 text-xs leading-relaxed text-slate-600">
                {rule.detail}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      {loading && !data ? <Spinner /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {summary ? (
        <div className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <h2 className="mb-2 text-[13px] font-medium text-slate-800">Match status</h2>
              <DonutChart
                segments={[
                  { label: "Matched", value: summary.matched, color: chartColors.primary },
                  { label: "Partial", value: summary.partial, color: chartColors.warning },
                  {
                    label: "Unmatched",
                    value: summary.unmatched,
                    color: chartColors.error,
                  },
                ]}
              />
            </Card>
            <div className="grid grid-cols-2 gap-4 lg:col-span-2">
              <KpiCard label="Transactions" value={String(summary.total)} />
              <KpiCard
                label="Match rate (by value)"
                value={formatPercent(summary.matchRate)}
                tone="primary"
              />
              <KpiCard
                label="Matched"
                value={String(summary.matched)}
                tone="positive"
              />
              <KpiCard
                label="Needs review"
                value={String(summary.partial + summary.unmatched)}
                tone="negative"
                sub={`${summary.partial} partial · ${summary.unmatched} unmatched`}
              />
            </div>
          </div>

          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
              <h2 className="text-[13px] font-medium text-slate-800">Transactions</h2>
              <div className="flex flex-wrap items-center gap-2">
                {currencies.length > 1 ? (
                  <SegmentedToggle
                    value={currency}
                    onChange={setCurrency}
                    options={[
                      { value: "all", label: "All" },
                      ...currencies.map((ccy) => ({ value: ccy, label: ccy })),
                    ]}
                  />
                ) : null}
                <SegmentedToggle
                  value={filter}
                  onChange={setFilter}
                  options={FILTERS.map((f) => ({
                    value: f,
                    label: f === "all" ? "All" : f,
                  }))}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500">
                    <SortTh label="Date" column="date" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Flow" column="flow" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Amount" column="amount" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} align="right" />
                    <SortTh label="Status" column="status" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Pattern" column="pattern" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Matched to" column="matched" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh label="Conf." column="confidence" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} align="right" />
                    <th className="px-4 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.rows.map((r) => (
                    <tr key={r.transactionId} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                        {formatDate(r.date)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            r.flow === "O2C"
                              ? "bg-brand-soft text-brand-dark"
                              : "bg-brand-orange-soft text-brand-orange"
                          }`}
                        >
                          {r.flow}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${
                          r.amount >= 0 ? "text-brand" : "text-brand-orange"
                        }`}
                      >
                        {formatCurrency(r.amount, r.currency)}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-2">
                        <span className="inline-flex max-w-[14rem] rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                          {r.matchPattern
                            ? MATCH_PATTERN_LABELS[r.matchPattern]
                            : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <MatchedToCell result={r} />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                        {r.confidence > 0
                          ? `${Math.round(r.confidence * 100)}%`
                          : "—"}
                      </td>
                      <td className="max-w-xl px-4 py-2">
                        <MatchNotes result={r} />
                      </td>
                    </tr>
                  ))}
                  {sorted.rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                        No transactions for this filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function docNumbers(docs: SupportingDocRef[], kind: SupportingDocRef["kind"]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const doc of docs) {
    if (doc.kind !== kind) continue;
    const value = doc.number || doc.id;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function FoundChip({
  label,
  found,
  numbers,
}: {
  label: string;
  found: boolean;
  numbers?: string[];
}) {
  const shown = (numbers ?? []).slice(0, 3);
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
        found
          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
          : "bg-slate-50 text-slate-500 ring-slate-200"
      }`}
    >
      {label} {found ? "found" : "not found"}
      {found && shown.length ? ` · ${shown.join(", ")}` : ""}
    </span>
  );
}

function MatchedToCell({ result }: { result: ReconciliationResult }) {
  const docs = matchedToDocs(result);
  if (!docs.length) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <div className="flex max-w-xs flex-col gap-1">
      {docs.map((doc) => (
        <span
          key={`${doc.kind}:${doc.id}`}
          className="inline-flex w-fit rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-800"
        >
          {doc.label}
        </span>
      ))}
    </div>
  );
}

function MatchNotes({ result }: { result: ReconciliationResult }) {
  const lookup = result.lookup;
  const triggerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeFrame = useRef<number | null>(null);
  const pathId = useId();
  const [present, setPresent] = useState(false);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 360, flip: false });

  const clearTimers = () => {
    if (hideTimer.current != null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (unmountTimer.current != null) {
      clearTimeout(unmountTimer.current);
      unmountTimer.current = null;
    }
    if (fadeFrame.current != null) {
      cancelAnimationFrame(fadeFrame.current);
      fadeFrame.current = null;
    }
  };

  const placePopup = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(440, window.innerWidth - 16);
    let left = r.right - width;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    const below = r.bottom + 6;
    const estimatedH = 280;
    const flip = below + estimatedH > window.innerHeight - 8;
    setPos({
      top: flip ? Math.max(8, r.top - 6) : below,
      left,
      width,
      flip,
    });
  };

  const show = () => {
    clearTimers();
    placePopup();
    setPresent(true);
    fadeFrame.current = requestAnimationFrame(() => {
      fadeFrame.current = requestAnimationFrame(() => setShown(true));
    });
  };

  const hideSoon = () => {
    if (fadeFrame.current != null) {
      cancelAnimationFrame(fadeFrame.current);
      fadeFrame.current = null;
    }
    if (hideTimer.current != null) clearTimeout(hideTimer.current);
    if (unmountTimer.current != null) {
      clearTimeout(unmountTimer.current);
      unmountTimer.current = null;
    }
    hideTimer.current = setTimeout(() => {
      setShown(false);
      unmountTimer.current = setTimeout(() => {
        setPresent(false);
        unmountTimer.current = null;
      }, 80);
      hideTimer.current = null;
    }, 50);
  };

  useEffect(() => {
    return () => {
      if (hideTimer.current != null) clearTimeout(hideTimer.current);
      if (unmountTimer.current != null) clearTimeout(unmountTimer.current);
      if (fadeFrame.current != null) cancelAnimationFrame(fadeFrame.current);
    };
  }, []);

  useEffect(() => {
    if (!present) return;
    const close = () => {
      if (hideTimer.current != null) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      if (fadeFrame.current != null) {
        cancelAnimationFrame(fadeFrame.current);
        fadeFrame.current = null;
      }
      setShown(false);
      if (unmountTimer.current != null) clearTimeout(unmountTimer.current);
      unmountTimer.current = setTimeout(() => {
        setPresent(false);
        unmountTimer.current = null;
      }, 80);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [present]);

  if (!lookup) {
    return (
      <div className="text-xs text-slate-500">{result.reasons.join(" · ")}</div>
    );
  }

  const docs = lookup.supportingDocs ?? [];
  const showSo = result.flow === "O2C";
  const showPo = result.flow === "P2P";
  const steps = lookup.analysisPlan ?? [];
  const hasPath = steps.length > 0;

  return (
    <div className="text-xs leading-relaxed text-slate-600">
      <div
        ref={triggerRef}
        tabIndex={hasPath ? 0 : undefined}
        aria-describedby={hasPath && shown ? pathId : undefined}
        onMouseEnter={hasPath ? show : undefined}
        onMouseLeave={hasPath ? hideSoon : undefined}
        onFocus={hasPath ? show : undefined}
        onBlur={hasPath ? hideSoon : undefined}
        className={`rounded-md ${
          hasPath
            ? "cursor-help outline-none ring-slate-300 focus-visible:ring-2"
            : ""
        }`}
      >
        <div className="flex flex-wrap gap-1">
          {showSo ? (
            <FoundChip
              label="SO"
              found={lookup.soFound}
              numbers={docNumbers(docs, "SO")}
            />
          ) : null}
          {showPo ? (
            <FoundChip
              label="PO"
              found={lookup.poFound}
              numbers={docNumbers(docs, "PO")}
            />
          ) : null}
          <FoundChip
            label="Remittance"
            found={lookup.remittanceFound}
            numbers={docNumbers(docs, "remittance")}
          />
        </div>
        <div className="mt-1 line-clamp-2 break-words">
          <span className="font-medium text-slate-700">Narrative:</span>{" "}
          {lookup.narrative?.trim() || "—"}
        </div>
      </div>
      {result.remediation ? (
        <div className="mt-1 line-clamp-2 text-amber-800">
          <span className="font-medium">Next:</span> {result.remediation}
        </div>
      ) : null}
      <PathPopup
        id={pathId}
        steps={steps}
        present={present}
        shown={shown}
        pos={pos}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
      />
    </div>
  );
}

function PathPopup({
  id,
  steps,
  present,
  shown,
  pos,
  onMouseEnter,
  onMouseLeave,
}: {
  id: string;
  steps: AnalysisStep[];
  present: boolean;
  shown: boolean;
  pos: { top: number; left: number; width: number; flip: boolean };
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  if (!steps.length || !present || typeof document === "undefined") return null;

  return createPortal(
    <div
      id={id}
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        transform: pos.flip ? "translateY(-100%)" : undefined,
      }}
      className={`fixed z-[80] max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-lg ring-1 ring-slate-200/80 transition-opacity ${
        shown
          ? "pointer-events-auto opacity-100 duration-200"
          : "pointer-events-none opacity-0 duration-75"
      }`}
    >
      <AnalysisPlan steps={steps} />
    </div>,
    document.body,
  );
}

function AnalysisPlan({ steps }: { steps: AnalysisStep[] }) {
  if (!steps.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500">
        Path
      </div>
      <ol className="mt-1 space-y-0.5 text-[11px] leading-snug text-slate-600">
        {steps.map((step) => (
          <li key={step.step} className="break-words">
            <span className="font-medium text-slate-700">
              {step.step}. {step.label}
            </span>
            {step.fileName ? (
              <span className="ml-1 font-mono text-slate-800">
                {step.fileName}
                {step.row != null ? ` row ${step.row}` : ""}
                {step.page != null ? ` page ${step.page}` : ""}
              </span>
            ) : null}
            <span className="text-slate-500"> — {step.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
