"use client";

import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { useFetch } from "@/lib/useFetch";

interface IntegrationStatus {
  storageProvider: string;
  dataSource: string;
  reportingCurrency: string;
  oci: { active: boolean; configured: boolean; bucket?: string; region?: string };
  snowflake: {
    active: boolean;
    configured: boolean;
    account?: string;
    database?: string;
  };
  externalApi: { configured: boolean; baseUrl?: string };
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
              <Row label="Bucket" value={data.oci.bucket ?? "—"} />
              <Row label="Region" value={data.oci.region ?? "—"} />
            </dl>
            <p className="mt-3 text-xs text-slate-400">
              Set OCI_NAMESPACE, OCI_BUCKET, OCI_REGION and STORAGE_PROVIDER=oci
              to activate.
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
