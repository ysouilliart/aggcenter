import { formatCompact } from "@/lib/format";

/** Area + line chart for a single running series (e.g. running balance). */
export function AreaLineChart({
  points,
  currency = "USD",
  height = 240,
}: {
  points: { label: string; value: number }[];
  currency?: string;
  height?: number;
}) {
  const W = 800;
  const H = height;
  const padX = 12;
  const padY = 24;

  if (points.length === 0) {
    return <EmptyChart height={H} />;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (i: number) =>
    padX + (i * (W - padX * 2)) / Math.max(points.length - 1, 1);
  const y = (v: number) => padY + (1 - (v - min) / span) * (H - padY * 2);

  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area = `${padX},${H - padY} ${line} ${x(points.length - 1)},${H - padY}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      preserveAspectRatio="none"
      role="img"
    >
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#areaFill)" />
      <polyline
        points={line}
        fill="none"
        stroke="#4f46e5"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill="#4f46e5" />
      ))}
      <text x={padX} y={14} fontSize="12" fill="#64748b">
        {formatCompact(max, currency)}
      </text>
      <text x={padX} y={H - 6} fontSize="12" fill="#64748b">
        {formatCompact(min, currency)}
      </text>
    </svg>
  );
}

/** Grouped bars comparing inflow vs outflow per period. */
export function GroupedBarChart({
  data,
  currency = "USD",
  height = 240,
}: {
  data: { label: string; inflow: number; outflow: number }[];
  currency?: string;
  height?: number;
}) {
  const W = 800;
  const H = height;
  const padY = 24;
  const padX = 12;

  if (data.length === 0) return <EmptyChart height={H} />;

  const max = Math.max(...data.flatMap((d) => [d.inflow, d.outflow]), 1);
  const groupW = (W - padX * 2) / data.length;
  const barW = Math.min(groupW / 3, 16);
  const y = (v: number) => padY + (1 - v / max) * (H - padY * 2);
  const base = H - padY;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      <line x1={padX} y1={base} x2={W - padX} y2={base} stroke="#e2e8f0" />
      {data.map((d, i) => {
        const cx = padX + i * groupW + groupW / 2;
        return (
          <g key={i}>
            <rect
              x={cx - barW - 1}
              y={y(d.inflow)}
              width={barW}
              height={base - y(d.inflow)}
              rx="2"
              fill="#10b981"
            />
            <rect
              x={cx + 1}
              y={y(d.outflow)}
              width={barW}
              height={base - y(d.outflow)}
              rx="2"
              fill="#f43f5e"
            />
          </g>
        );
      })}
      <text x={padX} y={14} fontSize="12" fill="#64748b">
        {formatCompact(max, currency)}
      </text>
    </svg>
  );
}

/** Donut chart for categorical splits (e.g. reconciliation status). */
export function DonutChart({
  segments,
  size = 180,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const r = size / 2;
  const stroke = 22;
  const radius = r - stroke / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <g transform={`rotate(-90 ${r} ${r})`}>
          <circle
            cx={r}
            cy={r}
            r={radius}
            fill="none"
            stroke="#eef2f7"
            strokeWidth={stroke}
          />
          {total > 0 &&
            segments.map((seg, i) => {
              const fraction = seg.value / total;
              const dash = fraction * circumference;
              const el = (
                <circle
                  key={i}
                  cx={r}
                  cy={r}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return el;
            })}
        </g>
        <text
          x={r}
          y={r - 2}
          textAnchor="middle"
          fontSize="24"
          fontWeight="600"
          fill="#0f172a"
        >
          {total}
        </text>
        <text x={r} y={r + 18} textAnchor="middle" fontSize="12" fill="#64748b">
          total
        </text>
      </svg>
      <ul className="space-y-1 text-sm">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: seg.color }}
            />
            <span className="text-slate-600">{seg.label}</span>
            <span className="ml-auto font-medium tabular-nums text-slate-900">
              {seg.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyChart({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400"
      style={{ height }}
    >
      No data
    </div>
  );
}
