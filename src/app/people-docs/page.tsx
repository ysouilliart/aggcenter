"use client";

import Button from "@mui/material/Button";
import { useMemo, useRef, useState } from "react";

import { Card, ConfidencePill, ErrorNote, InfoNote, KpiCard, PageHeader, Spinner, StatusBadge, SuccessNote, WarningNote } from "@/components/ui";
import type { PeopleDocDetail, PeopleDocRecord, PeopleDocSummary } from "@/lib/peopleDocs/types";
import { PEOPLE_DOC_FIELD_DEFS, type PeopleDocFieldKey } from "@/lib/parse/peopleDocs/types";
import { formatDate } from "@/lib/format";
import { peopleDocDisplayTitle } from "@/lib/peopleDocs/folders";
import { useFetch } from "@/lib/useFetch";

type ModelChoice = { id: string; label: string };

type ClassifyStatus = {
  mode: "llm" | "static";
  llmReady: boolean;
  warning?: string;
  model?: string;
  configuredModel?: string;
  models?: ModelChoice[];
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
  const [keyword, setKeyword] = useState("");
  const appliedKeyword = keyword.trim();
  const listUrl = useMemo(() => {
    if (!appliedKeyword) return "/api/people-docs";
    return `/api/people-docs?q=${encodeURIComponent(appliedKeyword)}`;
  }, [appliedKeyword]);
  const downloadHref = useMemo(() => {
    if (!appliedKeyword) return "/api/people-docs/download";
    return `/api/people-docs/download?q=${encodeURIComponent(appliedKeyword)}`;
  }, [appliedKeyword]);
  const list = useFetch<{ docs: PeopleDocRecord[]; q?: string }>(listUrl);
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
  const [savingModel, setSavingModel] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = summary.data?.byFolder;
  const classify = summary.data?.classify;
  const modelOptions = classify?.models ?? [];
  const selectedModel = model ?? classify?.model ?? "";

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
      if (selectedModel) form.append("model", selectedModel);
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
      const res = await fetch("/api/people-docs/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedModel ? { model: selectedModel } : {}),
      });
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
        body: JSON.stringify({
          action,
          ...(action === "reprocess" && selectedModel ? { model: selectedModel } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `${action} failed`);
      const mode = json.doc?.classifyMode ?? json.doc?.doc?.classifyMode;
      const parsedWith = json.doc?.llmModel as string | undefined;
      setMessage(
        action === "reprocess"
          ? parsedWith
            ? `Reprocessed with ${parsedWith}.`
            : `Reprocessed (${mode ?? "static"}).`
          : "Archived.",
      );
      await reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setReprocessing(false);
    }
  }

  async function handleModelChange(next: string) {
    setModel(next);
    setSavingModel(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/people-docs/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not change the parsing model");
      setMessage(`Parsing model set to ${json.classify?.model ?? next}. Parse or reprocess a document to match fields and write a synopsis with it.`);
      summary.reload();
    } catch (err) {
      setModel(null);
      setError(err instanceof Error ? err.message : "Could not change the parsing model");
    } finally {
      setSavingModel(false);
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
          subtitle="Hybrid classify for aggcenter/peopleDocs. The selected model fills parameter gaps and writes the synopsis under the match."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-500">
                Parsing model
                <select
                  aria-label="Parsing model"
                  value={selectedModel}
                  onChange={(e) => void handleModelChange(e.target.value)}
                  disabled={!classify || savingModel || modelOptions.length === 0}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 disabled:bg-slate-50"
                >
                  {modelOptions.length === 0 && selectedModel ? (
                    <option value={selectedModel}>{selectedModel}</option>
                  ) : null}
                  {modelOptions.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                      {choice.id === classify?.configuredModel ? " (env default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="button" variant="outlined" size="small" onClick={handleSync} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync landing folder"}
              </Button>
            </div>
          }
        />

        {classify?.warning ? (
          <WarningNote message={classify.warning} />
        ) : classify?.llmReady ? (
          <InfoNote message={`LLM classify is on (${classify.model}). People-docs key is independent of invoices. Scripting stays the floor. The model fills missing parameters and writes a synopsis. Extracted text is sent only when classify runs.`} />
        ) : null}

        {error ? <ErrorNote message={error} /> : null}
        {message ? <SuccessNote message={message} /> : null}

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
          <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
            <h2 className="text-[13px] font-medium text-slate-800">Documents</h2>
            {appliedKeyword ? (
              <span className="text-xs text-slate-500">
                {docs.length} match{docs.length === 1 ? "" : "es"}
              </span>
            ) : null}
          </div>
          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Keyword search…"
              aria-label="Keyword search"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
            <a
              href={downloadHref}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download JSON
            </a>
          </div>
          <form onSubmit={handleUpload} className="mb-3 shrink-0 space-y-2">
            <Button variant="outlined" component="label" fullWidth size="small">
              Choose document
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".pdf,.docx,.xlsx,.csv,.txt"
              />
            </Button>
            <Button type="submit" variant="contained" disabled={submitting} fullWidth size="small">
              {submitting ? "Parsing…" : "Parse document"}
            </Button>
          </form>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {list.loading && !docs.length ? (
              <Spinner />
            ) : docs.length === 0 ? (
              <p className="text-sm text-slate-500">
                {appliedKeyword
                  ? `No people docs match “${appliedKeyword}”.`
                  : "No people docs yet. Drop files into aggcenter/peopleDocs/landing/ and sync, or upload here."}
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
                          active ? "bg-brand-soft" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900" title={doc.fileName}>
                              {peopleDocDisplayTitle(doc.fileName)}
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

        <Card className="flex h-full min-h-0 flex-col overflow-hidden p-0">
          {!activeId ? (
            <p className="p-4 text-sm text-slate-500">Select a document to see classified fields.</p>
          ) : detail.loading && !selected ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : !selected ? (
            <p className="p-4 text-sm text-slate-500">Document not found.</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
              <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-medium text-slate-800">{selected.doc.fileName}</h2>
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
                  <Button
                    type="button"
                    variant="outlined"
                    size="small"
                    onClick={() => patchDoc("reprocess")}
                    disabled={reprocessing}
                  >
                    {reprocessing ? "Reprocessing…" : "Reprocess"}
                  </Button>
                  <Button
                    type="button"
                    variant="outlined"
                    size="small"
                    onClick={() => patchDoc("archive")}
                    disabled={reprocessing || selected.doc.folder === "archived"}
                  >
                    Archive
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {selected.doc.classifierWarning &&
                selected.doc.classifierWarning !== classify?.warning &&
                !/LLM classify is off/i.test(selected.doc.classifierWarning) ? (
                  <WarningNote message={selected.doc.classifierWarning} />
                ) : selected.doc.classifyMode === "llm" ? (
                  <InfoNote message="LLM overlay on the static parser. Scripted fields were kept; the model filled gaps." />
                ) : null}
                {selected.doc.reviewReason ? (
                  <WarningNote message={selected.doc.reviewReason} />
                ) : null}

                <h3 className="mb-2 text-xs font-medium text-slate-500">Matched parameters</h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {PEOPLE_DOC_FIELD_DEFS.map((def) => {
                    const field = fieldMap.get(def.key);
                    const raw = headerValue(selected.doc, def.key);
                    const value = field?.value || raw;
                    const missing = value === "—";
                    return (
                      <div key={def.key} className="rounded-lg border border-slate-100 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-xs font-medium text-slate-500">
                            {def.label}
                          </dt>
                          <ConfidencePill confidence={field?.confidence ?? 0} missing={missing} />
                        </div>
                        <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>

              <section
                className="mt-3 shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
                aria-label="Document synopsis"
              >
                <h3 className="text-xs font-medium text-slate-500">Synopsis</h3>
                {selected.doc.synopsis ? (
                  <p className="mt-1 text-sm leading-relaxed text-slate-800">{selected.doc.synopsis}</p>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">
                    No LLM synopsis for this document. Choose a parsing model and reprocess to generate one.
                  </p>
                )}
                {selected.doc.llmModel ? (
                  <p className="mt-2 text-xs text-slate-400">Parsed with {selected.doc.llmModel}</p>
                ) : null}
              </section>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
