"use client";

import { useState } from "react";

import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import type { StoredObject } from "@/lib/storage/types";
import { formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

interface ObjectsResponse {
  provider: string;
  objects: StoredObject[];
}

interface PreviewResponse {
  key: string;
  provider: string;
  size: number;
  truncated: boolean;
  isBinary: boolean;
  text: string;
}

interface IntegrationsResponse {
  oci: {
    active: boolean;
    configured: boolean;
    authMode: string;
    bucket?: string;
    region?: string;
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesPage() {
  const [prefix, setPrefix] = useState("");
  const objectsState = useFetch<ObjectsResponse>(
    `/api/storage/objects?prefix=${encodeURIComponent(prefix)}`,
  );
  const integrations = useFetch<IntegrationsResponse>("/api/integrations");

  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const provider = objectsState.data?.provider ?? "…";
  const objects = objectsState.data?.objects ?? [];
  const oci = integrations.data?.oci;

  async function viewFile(key: string) {
    setSelected(key);
    setPreview(null);
    setPreviewError(null);
    setLoadingPreview(true);
    try {
      const res = await fetch(`/api/storage/object?key=${encodeURIComponent(key)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch file");
      setPreview(json as PreviewResponse);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to fetch file");
    } finally {
      setLoadingPreview(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Files"
        subtitle="Browse the object-storage bucket and view a selected file on request"
        actions={
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                provider === "oci" ? "bg-emerald-500" : "bg-slate-400"
              }`}
            />
            provider: {provider}
            {oci?.bucket ? ` · ${oci.bucket}` : ""}
          </span>
        }
      />

      {oci && !oci.active ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Showing the local storage provider. Set the OCI secrets and{" "}
          <code>STORAGE_PROVIDER=oci</code> to browse the OCI bucket here (auth
          mode detected: <strong>{oci.authMode}</strong>).
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-0">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold text-slate-900">Objects</h2>
            <div className="flex items-center gap-2">
              <input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="prefix filter…"
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                onClick={objectsState.reload}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
          </div>

          {objectsState.loading ? (
            <div className="px-5">
              <Spinner />
            </div>
          ) : objectsState.error ? (
            <div className="p-5">
              <ErrorNote message={objectsState.error} />
            </div>
          ) : objects.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">
              No objects. Upload a statement (Statements page) to store one via the
              active provider.
            </p>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2 font-medium">Key</th>
                    <th className="px-5 py-2 text-right font-medium">Size</th>
                    <th className="px-5 py-2 font-medium">Modified</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {objects.map((o) => (
                    <tr
                      key={o.key}
                      className={selected === o.key ? "bg-indigo-50" : "hover:bg-slate-50"}
                    >
                      <td className="px-5 py-2 font-mono text-xs text-slate-700">
                        {o.key}
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums text-slate-500">
                        {formatBytes(o.size)}
                      </td>
                      <td className="px-5 py-2 text-slate-500">
                        {formatDate(o.lastModified)}
                      </td>
                      <td className="px-5 py-2 text-right">
                        <button
                          onClick={() => viewFile(o.key)}
                          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-0">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold text-slate-900">
              Preview {selected ? <span className="font-mono text-xs text-slate-500">· {selected}</span> : null}
            </h2>
          </div>
          <div className="p-5">
            {!selected ? (
              <p className="text-sm text-slate-400">
                Select a file and click <strong>View</strong> to fetch its contents
                on request.
              </p>
            ) : loadingPreview ? (
              <Spinner label="Fetching file…" />
            ) : previewError ? (
              <ErrorNote message={previewError} />
            ) : preview ? (
              <div>
                <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-500">
                  <span>{formatBytes(preview.size)}</span>
                  <span>via {preview.provider}</span>
                  {preview.truncated ? (
                    <span className="text-amber-600">truncated preview</span>
                  ) : null}
                </div>
                {preview.isBinary ? (
                  <p className="text-sm text-slate-500">
                    Binary content — preview not shown.
                  </p>
                ) : (
                  <pre className="max-h-[24rem] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                    {preview.text}
                  </pre>
                )}
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
