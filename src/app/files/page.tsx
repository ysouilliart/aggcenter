"use client";

import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import { useState } from "react";

import { Card, ErrorNote, PageHeader, SortTh, Spinner, WarningNote } from "@/components/ui";
import type { StoredObject } from "@/lib/storage/types";
import { formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";
import { useSort } from "@/lib/useSort";

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

function fileSortValue(row: StoredObject, key: string): unknown {
  switch (key) {
    case "key":
      return row.key;
    case "size":
      return row.size;
    case "modified":
      return row.lastModified;
    default:
      return "";
  }
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
  const sorted = useSort(objects, fileSortValue);
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
          <Chip
            label={`provider: ${provider}${oci?.bucket ? ` · ${oci.bucket}` : ""}`}
            color={provider === "oci" ? "success" : "default"}
            variant="outlined"
          />
        }
      />

      {oci && !oci.active ? (
        <WarningNote message={`Showing the local storage provider. Set the OCI secrets and STORAGE_PROVIDER=oci to browse the OCI bucket here (auth mode detected: ${oci.authMode}).`} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-0">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
            <h2 className="text-[13px] font-medium text-slate-800">Objects</h2>
            <div className="flex items-center gap-2">
              <TextField
                size="small"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="aggCenter/ORG_112 - UK"
              />
              <Button variant="outlined" size="small" onClick={objectsState.reload}>
                Refresh
              </Button>
            </div>
          </div>

          {objectsState.loading && !objectsState.data ? (
            <div className="px-5">
              <Spinner />
            </div>
          ) : objectsState.error ? (
            <div className="p-5">
              <ErrorNote message={objectsState.error} />
            </div>
          ) : objects.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">
              No objects. Upload a statement or invoice to store one via the
              active provider.
            </p>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500">
                    <SortTh className="px-5 py-2 font-medium" label="Key" column="key" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <SortTh className="px-5 py-2 font-medium" label="Size" column="size" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} align="right" />
                    <SortTh className="px-5 py-2 font-medium" label="Modified" column="modified" sortKey={sorted.sortKey} sortDir={sorted.sortDir} onSort={sorted.toggle} />
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.rows.map((o) => (
                    <tr
                      key={o.key}
                      className={selected === o.key ? "bg-brand-soft" : "hover:bg-slate-50"}
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
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => viewFile(o.key)}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-0">
          <div className="border-b border-slate-100 px-4 py-2">
            <h2 className="text-[13px] font-medium text-slate-800">
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
                    {selected.toLowerCase().endsWith(".pdf")
                      ? "PDF — binary preview not shown. Open the parsed statement from the Statements page (header, narrative, parse trace)."
                      : "Binary content — preview not shown."}
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
