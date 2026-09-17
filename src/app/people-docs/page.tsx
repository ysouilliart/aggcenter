"use client";

import { useMemo, useRef, useState } from "react";

import { Card, ConfidencePill, ErrorNote, KpiCard, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import type { PeopleDocDetail, PeopleDocRecord, PeopleDocSummary } from "@/lib/peopleDocs/types";
import { PEOPLE_DOC_FIELD_DEFS, type PeopleDocFieldKey } from "@/lib/parse/peopleDocs/types";
import { formatDate } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

type ClassifyStatus = {
  mode: "llm" | "static";
  llmReady: boolean;
  warning?: string;
  model?: string;
};

const EMPTY_DOCS: PeopleDocRecord[] = [];

function flagLabel(value: boolean | undefined): string {
  if (value == null) return "—";
  return value ? "Yes" : "No";
}

function headerValue(doc: PeopleDocRecord, key: PeopleDocFieldKey): string {
  if (key === "autoRenew") return flagLabel(doc.autoRenew);
  if (key === "perpetual") return flagLabel(doc.perpetual);
  return doc[key] || "—";
}

export default function PeopleDocsPage() {
  const list = useFetch<{ docs: PeopleDocRecord[] }>("/api/people-docs");
  const summary = useFetch<PeopleDocSummary & { classify?: ClassifyStatus }>("/api/people-docs/summary");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const docs = list.data?.docs ?? EMPTY_DOCS;
  const activeId =
    selectedId && docs.some((d) => d.id === selectedId) ? selectedId : (docs[0]?.id ?? null);
  const detail = useFetch<PeopleDocDetail>(
    activeId ? `/api/people-docs/${encodeURIComponent(activeId)}` : "/api/people-docs/summary",
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = summary.data?.byFolder;

  async function reloadAll() {
    list.reload();
    summary.reload();
    if (activeId) detail.reload();
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF, Word, Excel or text people document.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/people-docs", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setMessage(`Parsed ${json.doc.fileName} → ${json.doc.folder} (${json.doc.parseStatus}).`);
      if (fileRef.current) fileRef.current.value = "";
      setSelectedId(json.doc.id);
      await reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/people-docs/ingest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      setMessage(
        `Synced ${json.prefix}: ${json.ingested.length} ingested, ${json.skipped.length} skipped, ${json.errors.length} error(s)` +
          (json.usedSampleFallback ? " · sample landing" : "") +
          ".",
      );
      await reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function patchDoc(action: "reprocess" | "archive") {
    if (!activeId) return;
    setReprocessing(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/people-docs/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `${action} failed`);
      const mode = json.doc?.classifyMode ?? json.doc?.doc?.classifyMode;
      setMessage(
        action === "reprocess"
          ? `Reprocessed (${mode ?? "static"}).`
          : "Archived.",
      );
      await reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setReprocessing(false);
    }
  }

  const selected =
    activeId && detail.data && "doc" in detail.data ? detail.data : undefined;
  const fieldMap = useMemo(() => {
    const map = new Map((selected?.fields ?? []).map((f) => [f.key, f]));
    return map;
  }, [selected]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0">
        <PageHeader
          className="mb-3"
          title="People docs"
          subtitle="Hybrid classify for aggcenter/peopleDocs: static floor, then PEOPLE_DOCS_LLM_API_KEY. Reprocess after enabling LLM."
          actions={
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync landing folder"}
            </button>
          }
        />

        {summary.data?.classify?.warning ? (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {summary.data.classify.warning}
          </div>
        ) : summary.data?.classify?.llmReady ? (
          <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            LLM classify is on ({summary.data.classify.model}). People-docs key is independent of
            invoices. Scripting stays the floor; extracted people-doc text is sent to the provider
            only when classify runs.
          </div>
        ) : null}

        {error ? <ErrorNote message={error} /> : null}
        {message ? <p className="mb-3 text-sm text-slate-600">{message}</p> : null}

        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Landing" value={String(counts?.landing ?? 0)} sub="Drop zone" />
          <KpiCard
            label="Processed"
            value={String(counts?.processed ?? 0)}
            sub="Parsed"
            tone="positive"
          />
          <KpiCard
            label="Needs review"
            value={String(counts?.anomaly ?? 0)}
            sub="Anomaly folder"
            tone="amber"
          />
          <KpiCard label="Archived" value={String(counts?.archived ?? 0)} sub="Closed" />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden max-lg:grid-rows-[minmax(10rem,38vh)_minmax(0,1fr)] lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <h2 className="mb-3 shrink-0 font-semibold text-slate-900">Documents</h2>
          <form onSubmit={handleUpload} className="mb-3 shrink-0 space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.csv,.txt"
              className="block w-full text-sm text-slate-600"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting ? "Parsing…" : "Parse document"}
            </button>
          </form>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {list.loading && !docs.length ? (
              <Spinner />
            ) : docs.length === 0 ? (
              <p className="text-sm text-slate-500">
                No people docs yet. Drop files into aggcenter/peopleDocs/landing/ and sync, or upload
                here.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {docs.map((doc) => {
                  const active = doc.id === activeId;
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(doc.id)}
                        className={`w-full rounded-lg px-2 py-3 text-left ${
                          active ? "bg-indigo-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">
                              {doc.agreementId || doc.fileName}
                            </div>
                            <div className="truncate text-xs text-slate-500">{doc.fileName}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {doc.agreementType || "—"} · {doc.resmedEntity || "—"}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <StatusBadge status={doc.folder} />
                            <ConfidencePill confidence={doc.confidence} />
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          {!activeId ? (
            <p className="text-sm text-slate-500">Select a document to see classified fields.</p>
          ) : detail.loading && !selected ? (
            <Spinner />
          ) : !selected ? (
            <p className="text-sm text-slate-500">Document not found.</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{selected.doc.fileName}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.doc.classifyMode ?? "static"} classify · uploaded{" "}
                    {formatDate(selected.doc.uploadedAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge status={selected.doc.parseStatus} />
                    <StatusBadge status={selected.doc.classifyMode ?? "static"} />
                    <ConfidencePill confidence={selected.doc.confidence} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => patchDoc("reprocess")}
                    disabled={reprocessing}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {reprocessing ? "Reprocessing…" : "Reprocess"}
                  </button>
                  <button
                    type="button"
                    onClick={() => patchDoc("archive")}
                    disabled={reprocessing || selected.doc.folder === "archived"}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Archive
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {selected.doc.classifierWarning &&
                selected.doc.classifierWarning !== summary.data?.classify?.warning &&
                !/LLM classify is off/i.test(selected.doc.classifierWarning) ? (
                  <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {selected.doc.classifierWarning}
                  </p>
                ) : selected.doc.classifyMode === "llm" ? (
                  <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
                    LLM overlay on the static parser. Scripted fields were kept; the model filled
                    gaps.
                  </p>
                ) : null}
                {selected.doc.reviewReason ? (
                  <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {selected.doc.reviewReason}
                  </p>
                ) : null}

                <dl className="grid gap-3 sm:grid-cols-2">
                  {PEOPLE_DOC_FIELD_DEFS.map((def) => {
                    const field = fieldMap.get(def.key);
                    const raw = headerValue(selected.doc, def.key);
                    const value = field?.value || raw;
                    const missing = value === "—";
                    return (
                      <div key={def.key} className="rounded-lg border border-slate-100 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            {def.label}
                          </dt>
                          <ConfidencePill confidence={field?.confidence ?? 0} missing={missing} />
                        </div>
                        <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
                      </div>
                    );
                  })}
                </dl>

                {selected.doc.extractedText ? (
                  <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap">
                    {selected.doc.extractedText.slice(0, 4000)}
                  </pre>
                ) : null}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
