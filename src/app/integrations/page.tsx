"use client";

import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { useState } from "react";

import { Card, ErrorNote, PageHeader, Spinner, SuccessNote } from "@/components/ui";
import { invalidateCashFetchCache, useFetch } from "@/lib/useFetch";

interface IntegrationStatus {
  storageProvider: string;
  dataSource: string;
  reportingCurrency: string;
  oci: {
    active: boolean;
    configured: boolean;
    authMode: string;
    bucket?: string;
    region?: string;
    namespace?: string;
    baseUrl?: string;
  };
  snowflake: {
    active: boolean;
    configured: boolean;
    account?: string;
    database?: string;
  };
  externalApi: { configured: boolean; baseUrl?: string };
  database: { configured: boolean; provider: string };
  cashFiles?: {
    orgRoot: string;
    inv: string;
    po: string;
    so: string;
    rem: string;
    bank: string;
    statementCsv: string;
    statementPdf: string;
  };
  invoiceClassify?: {
    mode: "llm" | "static";
    llmEnabled: boolean;
    llmReady: boolean;
    model: string;
    provider?: "openai" | "xai";
    staticFastPath: boolean;
    warning?: string;
    seedSamples: boolean;
  };
  peopleDocsClassify?: {
    mode: "llm" | "static";
    llmEnabled: boolean;
    llmReady: boolean;
    model: string;
    provider?: "openai" | "xai";
    warning?: string;
    seedSamples: boolean;
    prefix?: string;
  };
}

function folderName(prefix: string | undefined, fallback: string): string {
  if (!prefix) return fallback;
  const parts = prefix.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? fallback;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <Chip size="small" color={ok ? "success" : "default"} variant="outlined" label={label} />;
}

export default function IntegrationsPage() {
  const { data, error, loading } = useFetch<IntegrationStatus>("/api/integrations");
  const reference = useFetch<{
    salesOrders: number;
    purchaseOrders: number;
    apInvoices: number;
    remittances: number;
    provider: string;
  }>("/api/reference");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function handleReferenceSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/reference/ingest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      setSyncMessage(
        `Reset to the bank-statement baseline. Parsed ${json.statements?.ingested?.length ?? 0} statement(s). Supporting files: ${json.purchaseOrders} POs, ${json.apInvoices} UK AP invoices, ${json.salesOrders} SOs, ${json.remittances} remittances.`,
      );
      invalidateCashFetchCache();
      reference.reload();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="Connectivity for file storage, data warehouse and external APIs"
      />

      {loading && !data ? <Spinner /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {data ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-slate-800">
                OCI Object Storage
              </h2>
              <StatusPill
                ok={data.oci.active}
                label={data.oci.active ? "Active" : "Local fallback"}
              />
            </div>
            <p className="text-sm text-slate-600">
              File management for bank statements and documents. Currently using
              the{" "}
              <span className="font-medium text-slate-900">
                {data.storageProvider}
              </span>{" "}
              provider.
            </p>
            <dl className="mt-4 space-y-1 text-sm">
              <Row label="Configured" value={data.oci.configured ? "Yes" : "No"} />
              <Row label="Auth mode" value={data.oci.authMode} />
              <Row label="Bucket" value={data.oci.bucket ?? "—"} />
              <Row label="Namespace" value={data.oci.namespace ?? "—"} />
              <Row label="Region" value={data.oci.region ?? "—"} />
            </dl>
            <p className="mt-3 text-xs text-slate-400">
              Swift API. Set OCI_BUCKET, OCI_NAMESPACE, OCI_REGION,
              OCI_SWIFT_USER, OCI_SWIFT_PASSWORD and STORAGE_PROVIDER=oci to
              activate.
            </p>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-slate-800">Snowflake</h2>
              <StatusPill
                ok={data.snowflake.active}
                label={data.snowflake.active ? "Active" : "Sample data"}
              />
            </div>
            <p className="text-sm text-slate-600">
              Reference data (supporting sales orders, purchase orders, remittances).
              Currently using the{" "}
              <span className="font-medium text-slate-900">{data.dataSource}</span>{" "}
              source.
            </p>
            <dl className="mt-4 space-y-1 text-sm">
              <Row
                label="Configured"
                value={data.snowflake.configured ? "Yes" : "No"}
              />
              <Row label="Account" value={data.snowflake.account ?? "—"} />
              <Row label="Database" value={data.snowflake.database ?? "—"} />
            </dl>
            <p className="mt-3 text-xs text-slate-400">
              Set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_DATABASE and
              DATA_SOURCE=snowflake to activate.
            </p>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-slate-800">External API</h2>
              <StatusPill
                ok={data.externalApi.configured}
                label={data.externalApi.configured ? "Configured" : "Not set"}
              />
            </div>
            <p className="text-sm text-slate-600">
              Optional base URL for pulling additional reference data on demand.
            </p>
            <dl className="mt-4 space-y-1 text-sm">
              <Row label="Base URL" value={data.externalApi.baseUrl ?? "—"} />
            </dl>
            <p className="mt-3 text-xs text-slate-400">
              Set EXTERNAL_API_BASE_URL to enable.
            </p>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-slate-800">Database</h2>
              <StatusPill
                ok={data.database.configured}
                label={data.database.configured ? "Postgres" : "Local JSON"}
              />
            </div>
            <p className="text-sm text-slate-600">
              Persistence for uploaded statements, transactions (schema{" "}
              <span className="font-medium text-slate-900">aggc-cash</span>) and
              supplier records (schema{" "}
              <span className="font-medium text-slate-900">aggc-supplier</span>).
              Currently using the{" "}
              <span className="font-medium text-slate-900">
                {data.database.provider}
              </span>{" "}
              store.
            </p>
            <p className="mt-3 text-xs text-slate-400">
              Set DATABASE_URL (Neon or Postgres) and run{" "}
              <code>npm run db:migrate</code> to activate.
            </p>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-slate-800">
                Reference documents
              </h2>
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={handleReferenceSync}
                disabled={syncing}
              >
                {syncing ? "Loading…" : "Load from bucket"}
              </Button>
            </div>
            <p className="text-sm text-slate-600">
              The <strong>bank statement</strong> in{" "}
              <span className="font-medium text-slate-900">
                {folderName(data.cashFiles?.bank, "BANK_112")}
              </span>{" "}
              is the cash baseline for reconciliation. Supporting files from{" "}
              <span className="font-medium text-slate-900">
                {data.cashFiles?.orgRoot ?? "aggCenter/ORG_112 - UK"}
              </span>{" "}
              identify those payments:{" "}
              <span className="font-medium text-slate-900">
                {folderName(data.cashFiles?.inv, "INV_112")}
              </span>
              ,{" "}
              <span className="font-medium text-slate-900">
                {folderName(data.cashFiles?.po, "PO_112")}
              </span>
              ,{" "}
              <span className="font-medium text-slate-900">
                {folderName(data.cashFiles?.so, "SO_112")}
              </span>
              ,{" "}
              <span className="font-medium text-slate-900">
                {folderName(data.cashFiles?.rem, "REM_112")}
              </span>
              . Remittances that have not landed on the statement feed the cash
              forecast (predicted in / out), not anomalies.{" "}
              <strong>Load from bucket</strong> clears cash tables, parses the
              bank file once, then reloads supporting CSVs. AP rows keep
              taxation country GB; remittances keep OU ResMed UK.
            </p>
            <dl className="mt-4 space-y-1 text-sm">
              <Row
                label="UK remittances"
                value={String(reference.data?.remittances ?? "—")}
              />
              <Row
                label="Purchase orders"
                value={String(reference.data?.purchaseOrders ?? "—")}
              />
              <Row
                label="UK AP invoices"
                value={String(reference.data?.apInvoices ?? "—")}
              />
              <Row
                label="Sales orders"
                value={String(reference.data?.salesOrders ?? "—")}
              />
            </dl>
            {syncMessage ? <SuccessNote message={syncMessage} /> : null}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-slate-800">Invoice classify</h2>
              <StatusPill
                ok={Boolean(data.invoiceClassify?.llmReady)}
                label={data.invoiceClassify?.llmReady ? "LLM ready" : "Static parser"}
              />
            </div>
            <p className="text-sm text-slate-600">
              Static vendor/regex is always the floor. When an API key is present the LLM only
              fills missing fields. Hotjar / Tesla / Origin high-confidence overlays skip the
              model. Extracted text is sent to the provider only when LLM classify runs.
            </p>
            <dl className="mt-4 space-y-1 text-sm">
              <Row label="Mode" value={data.invoiceClassify?.mode ?? "static"} />
              <Row label="Provider" value={data.invoiceClassify?.provider ?? "—"} />
              <Row label="Model" value={data.invoiceClassify?.model ?? "—"} />
              <Row
                label="Static fast path"
                value={data.invoiceClassify?.staticFastPath ? "On" : "Off"}
              />
              <Row
                label="Sample seed"
                value={data.invoiceClassify?.seedSamples ? "On" : "Off"}
              />
            </dl>
            {data.invoiceClassify?.warning ? (
              <p className="mt-3 text-xs text-amber-700">{data.invoiceClassify.warning}</p>
            ) : (
              <p className="mt-3 text-xs text-slate-400">
                Add INVOICE_LLM_API_KEY (or OPENAI_API_KEY / XAI_API_KEY) as a Cursor Secret or in
                .env.local. Set INVOICE_LLM_CLASSIFY=false to force the static parser.
              </p>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-slate-800">People docs</h2>
              <StatusPill
                ok={Boolean(data.peopleDocsClassify?.llmReady)}
                label={data.peopleDocsClassify?.llmReady ? "LLM ready" : "Static parser"}
              />
            </div>
            <p className="text-sm text-slate-600">
              Independent hybrid classify (static floor, LLM fills gaps). Production HR should set
              PEOPLE_DOCS_LLM_API_KEY — that key turns people LLM on even if
              PEOPLE_DOCS_LLM_CLASSIFY=false. The false flag only blocks lab fallback from
              INVOICE_LLM_API_KEY / OPENAI_API_KEY / XAI_API_KEY when the people key is unset.
            </p>
            <dl className="mt-4 space-y-1 text-sm">
              <Row label="Prefix" value={data.peopleDocsClassify?.prefix ?? "aggcenter/peopleDocs/"} />
              <Row label="Mode" value={data.peopleDocsClassify?.mode ?? "static"} />
              <Row label="Model" value={data.peopleDocsClassify?.model ?? "—"} />
              <Row
                label="Sample seed"
                value={data.peopleDocsClassify?.seedSamples ? "On" : "Off"}
              />
            </dl>
            {data.peopleDocsClassify?.warning ? (
              <p className="mt-3 text-xs text-amber-700">{data.peopleDocsClassify.warning}</p>
            ) : data.peopleDocsClassify?.llmReady ? (
              <p className="mt-3 text-xs text-slate-400">
                People LLM is on. A dedicated PEOPLE_DOCS_LLM_API_KEY stays enabled even if
                PEOPLE_DOCS_LLM_CLASSIFY=false (that flag only blocks invoice-key lab fallback).
              </p>
            ) : (
              <p className="mt-3 text-xs text-slate-400">
                Add PEOPLE_DOCS_LLM_API_KEY to enable hybrid classify. PEOPLE_DOCS_LLM_CLASSIFY=false
                only blocks lab fallback when the people key is unset.
              </p>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 text-[13px] font-medium text-slate-800">Settings</h2>
            <dl className="space-y-1 text-sm">
              <Row label="Reporting currency" value={data.reportingCurrency} />
              <Row label="Storage provider" value={data.storageProvider} />
              <Row label="Data source" value={data.dataSource} />
            </dl>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
