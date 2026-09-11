import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "positive" | "negative" | "indigo" | "amber";
}) {
  const toneClass = {
    default: "text-slate-900",
    positive: "text-emerald-600",
    negative: "text-rose-600",
    indigo: "text-indigo-600",
    amber: "text-amber-600",
  }[tone];
  return (
    <Card>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </Card>
  );
}

const STATUS_STYLES: Record<string, string> = {
  matched: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  parsed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  partial: "bg-amber-50 text-amber-700 ring-amber-600/20",
  unmatched: "bg-rose-50 text-rose-700 ring-rose-600/20",
  failed: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700 ring-slate-600/20";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${cls}`}
    >
      {status}
    </span>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-rose-50 text-rose-700 ring-rose-600/20",
  medium: "bg-amber-50 text-amber-700 ring-amber-600/20",
  low: "bg-sky-50 text-sky-700 ring-sky-600/20",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const cls = SEVERITY_STYLES[severity] ?? "bg-slate-100 text-slate-700 ring-slate-600/20";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${cls}`}
    >
      {severity}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      {label}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {message}
    </div>
  );
}

const ISSUE_STYLES: Record<string, string> = {
  missing_attribute: "bg-amber-50 text-amber-800 ring-amber-600/20",
  invalid_vat: "bg-rose-50 text-rose-700 ring-rose-600/20",
  invalid_address: "bg-rose-50 text-rose-700 ring-rose-600/20",
  rationalise: "bg-sky-50 text-sky-700 ring-sky-600/20",
};

const VAT_CHECK_STYLES: Record<string, string> = {
  valid: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  invalid: "bg-rose-50 text-rose-700 ring-rose-600/20",
  inconclusive: "bg-amber-50 text-amber-800 ring-amber-600/20",
  unsupported: "bg-slate-100 text-slate-700 ring-slate-600/20",
  pending: "bg-slate-100 text-slate-600 ring-slate-600/15",
};

export function VatCheckBadge({
  validity,
}: {
  validity?: string | null;
}) {
  const key = validity && VAT_CHECK_STYLES[validity] ? validity : "pending";
  const label =
    key === "valid"
      ? "VIES valid"
      : key === "invalid"
        ? "VIES invalid"
        : key === "inconclusive"
          ? "VIES inconclusive"
          : key === "unsupported"
            ? "Not in VIES"
            : "VAT not checked";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${VAT_CHECK_STYLES[key]}`}
    >
      {label}
    </span>
  );
}

export function IssueBadge({ type }: { type: string }) {
  const cls = ISSUE_STYLES[type] ?? "bg-slate-100 text-slate-700 ring-slate-600/20";
  const label =
    type === "missing_attribute"
      ? "Missing"
      : type === "invalid_vat"
        ? "VAT"
        : type === "invalid_address"
          ? "Address"
          : type === "rationalise"
            ? "Rationalise"
            : type;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  );
}

export function DistributionList({
  items,
  emptyLabel = "(blank)",
}: {
  items: { value: string; count: number }[];
  emptyLabel?: string;
}) {
  const max = Math.max(...items.map((i) => i.count), 1);
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">No data</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.value || emptyLabel}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{item.value || emptyLabel}</span>
            <span className="tabular-nums text-slate-500">{item.count}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-1.5 rounded-full bg-indigo-500"
              style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
