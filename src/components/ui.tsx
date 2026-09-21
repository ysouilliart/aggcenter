"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import MuiCard from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import TableCell from "@mui/material/TableCell";
import TableSortLabel from "@mui/material/TableSortLabel";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import type { SortDir } from "@/lib/sort";

export function PageHeader({
  title,
  subtitle,
  actions,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      useFlexGap
      className={className || undefined}
      sx={{
        mb: className ? undefined : 3,
        flexWrap: "wrap",
        alignItems: "flex-end",
        justifyContent: "space-between",
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="h1">{title}</Typography>
        {subtitle ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {actions ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>{actions}</Box>
      ) : null}
    </Stack>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const flush = /(^|\s)p-0(\s|$)/.test(className);
  return (
    <MuiCard
      variant="outlined"
      className={className}
      sx={{
        display: className.includes("flex") ? "flex" : undefined,
        flexDirection: className.includes("flex-col") ? "column" : undefined,
      }}
    >
      {flush ? children : <CardContent sx={{ "&:last-child": { pb: 2.5 } }}>{children}</CardContent>}
    </MuiCard>
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
  tone?: "default" | "positive" | "negative" | "indigo" | "primary" | "amber";
}) {
  const color = {
    default: "text.primary",
    positive: "success.main",
    negative: "error.main",
    indigo: "primary.main",
    primary: "primary.main",
    amber: "warning.main",
  }[tone];
  return (
    <Card>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", color }}>
        {value}
      </Typography>
      {sub ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
          {sub}
        </Typography>
      ) : null}
    </Card>
  );
}

type ChipColor = "default" | "primary" | "success" | "warning" | "error" | "info";

const STATUS_COLORS: Record<string, ChipColor> = {
  matched: "success",
  parsed: "success",
  processed: "success",
  partial: "warning",
  unmatched: "error",
  failed: "error",
  anomaly: "error",
  archived: "default",
  received: "info",
  landing: "primary",
  llm: "info",
  static: "default",
  "static-fallback": "warning",
  pending: "warning",
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "default";
  return (
    <Chip
      label={status}
      color={color}
      variant={color === "default" ? "outlined" : "filled"}
      sx={{ textTransform: "capitalize" }}
    />
  );
}

export function ConfidencePill({ confidence, missing }: { confidence: number; missing?: boolean }) {
  const color: ChipColor = missing
    ? "default"
    : confidence >= 80
      ? "success"
      : confidence >= 50
        ? "warning"
        : "error";
  return (
    <Chip
      label={missing ? "missing" : `${confidence}%`}
      color={color}
      variant={color === "default" ? "outlined" : "filled"}
    />
  );
}

const SEVERITY_COLORS: Record<string, ChipColor> = {
  high: "error",
  medium: "warning",
  low: "info",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const color = SEVERITY_COLORS[severity] ?? "default";
  return (
    <Chip
      label={severity}
      color={color}
      variant={color === "default" ? "outlined" : "filled"}
      sx={{ textTransform: "capitalize" }}
    />
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ py: 5, alignItems: "center" }}>
      <CircularProgress size={18} />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <Alert severity="error" sx={{ mb: 1 }}>
      {message}
    </Alert>
  );
}

export function SuccessNote({ message }: { message: string }) {
  return (
    <Alert severity="success" sx={{ mb: 1 }}>
      {message}
    </Alert>
  );
}

export function InfoNote({ message }: { message: string }) {
  return (
    <Alert severity="info" sx={{ mb: 1 }}>
      {message}
    </Alert>
  );
}

export function WarningNote({ message }: { message: string }) {
  return (
    <Alert severity="warning" sx={{ mb: 1 }}>
      {message}
    </Alert>
  );
}

const ISSUE_COLORS: Record<string, ChipColor> = {
  missing_attribute: "warning",
  invalid_vat: "error",
  invalid_address: "error",
  rationalise: "info",
};

const VAT_CHECK_COLORS: Record<string, ChipColor> = {
  valid: "success",
  invalid: "error",
  inconclusive: "warning",
  unsupported: "default",
  pending: "default",
};

export function VatCheckBadge({
  validity,
}: {
  validity?: string | null;
}) {
  const key = validity && VAT_CHECK_COLORS[validity] ? validity : "pending";
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
  const color = VAT_CHECK_COLORS[key];
  return (
    <Chip
      label={label}
      color={color}
      variant={color === "default" || key === "pending" ? "outlined" : "filled"}
    />
  );
}

export function IssueBadge({ type }: { type: string }) {
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
  const color = ISSUE_COLORS[type] ?? "default";
  return (
    <Chip
      label={label}
      color={color}
      variant={color === "default" ? "outlined" : "filled"}
    />
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
    return (
      <Typography variant="body2" color="text.secondary">
        No data
      </Typography>
    );
  }
  return (
    <Stack spacing={1.5}>
      {items.map((item) => (
        <Box key={item.value || emptyLabel}>
          <Stack direction="row" spacing={1.5} sx={{ justifyContent: "space-between" }}>
            <Typography variant="body2" noWrap>
              {item.value || emptyLabel}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {item.count}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={Math.max(4, (item.count / max) * 100)}
            sx={{ mt: 0.5, height: 6, borderRadius: 999 }}
          />
        </Box>
      ))}
    </Stack>
  );
}

export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_, next: T | null) => {
        if (next != null) onChange(next);
      }}
      sx={{ gap: 0.5 }}
    >
      {options.map((opt) => (
        <ToggleButton key={opt.value} value={opt.value}>
          {opt.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export function SortTh({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  align = "left",
  className = "px-5 py-3",
}: {
  label: string;
  column: string;
  sortKey: string;
  sortDir: SortDir;
  onSort: (column: string) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sortKey === column;
  return (
    <TableCell
      component="th"
      align={align}
      sortDirection={active ? sortDir : false}
      className={className}
      sx={{ whiteSpace: "nowrap" }}
    >
      <TableSortLabel
        active={active}
        direction={active ? sortDir : "asc"}
        onClick={() => onSort(column)}
        sx={align === "right" ? { flexDirection: "row-reverse" } : undefined}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );
}
