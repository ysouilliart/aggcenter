"use client";

import { useState } from "react";

import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { useFetch } from "@/lib/useFetch";

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
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
        ok
          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
          : "bg-slate-100 text-slate-600 ring-slate-500/20"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-400"}`}
      />
      {label}
    </span>
  );
}

export default function IntegrationsPage() {
  const { data, error, loading } = useFetch<IntegrationStatus>("/api/integrations");
  const reference = useFetch<{
    salesOrders: number;
    purchaseOrders: number;
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
        `Loaded ${json.purchaseOrders} UK AP invoices, ${json.salesOrders} sales orders, ${json.remittances} UK remittances.`,
      );
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

      {loading ? <Spinner /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {data ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">
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
              <h2 className="font-semibold text-slate-900">Snowflake</h2>
              <StatusPill
                ok={data.snowflake.active}
                label={data.snowflake.active ? "Active" : "Sample data"}
              />
            </div>
            <p className="text-sm text-slate-600">
              Reference data (sales orders, purchase orders, remittances).
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
              <h2 className="font-semibold text-slate-900">External API</h2>
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
              <h2 className="font-semibold text-slate-900">Database</h2>
              <StatusPill
                ok={data.database.configured}
                label={data.database.configured ? "Postgres" : "Local JSON"}
              />
            </div>
            <p className="text-sm text-slate-600">
              Persistence for uploaded statements and transactions (schema{" "}
              <span className="font-medium text-slate-900">aggc-cash</span>).
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
              <h2 className="font-semibold text-slate-900">
                Reference documents
              </h2>
              <button
                type="button"
                onClick={handleReferenceSync}
                disabled={syncing}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {syncing ? "Loading…" : "Load from bucket"}
              </button>
            </div>
            <p className="text-sm text-slate-600">
              UK AP invoices, sales orders, and remittances from{" "}
              <span className="font-medium text-slate-900">
                aggCenter/APInvoices
              </span>
              ,{" "}
              <span className="font-medium text-slate-900">
                aggCenter/salesOrder
              </span>{" "}
              and{" "}
              <span className="font-medium text-slate-900">
                aggCenter/remittance
              </span>
              . AP rows keep taxation country GB; remittances keep OU ResMed UK.
            </p>
            <dl className="mt-4 space-y-1 text-sm">
              <Row
                label="UK remittances"
                value={String(reference.data?.remittances ?? "—")}
              />
              <Row
                label="UK AP invoices"
                value={String(reference.data?.purchaseOrders ?? "—")}
              />
              <Row
                label="Sales orders"
                value={String(reference.data?.salesOrders ?? "—")}
              />
            </dl>
            {syncMessage ? (
              <p className="mt-3 text-xs text-slate-500">{syncMessage}</p>
            ) : null}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-slate-900">Settings</h2>
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
