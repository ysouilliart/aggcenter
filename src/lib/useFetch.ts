"use client";

import { useCallback, useEffect, useState } from "react";

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

export function readFetchCache<T>(url: string): T | undefined {
  return cache.get(url) as T | undefined;
}

export function invalidateFetchCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key === prefix || key.startsWith(prefix)) cache.delete(key);
  }
}

export function invalidateCashFetchCache(): void {
  invalidateFetchCache("/api/cash");
  invalidateFetchCache("/api/reconciliation");
  invalidateFetchCache("/api/anomalies");
  invalidateFetchCache("/api/statements");
  invalidateFetchCache("/api/accounts");
  invalidateFetchCache("/api/reference");
}

async function loadJson<T>(url: string): Promise<T> {
  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const request = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const json = (await res.json()) as T;
    cache.set(url, json);
    return json;
  })();

  inflight.set(url, request);
  try {
    return await request;
  } finally {
    inflight.delete(url);
  }
}

/** Warm the client cache so the next navigation can paint without a spinner. */
export function prefetchFetch(url: string): void {
  if (cache.has(url) || inflight.has(url)) return;
  void loadJson(url).catch(() => {
    /* hover prefetch is best-effort */
  });
}

export function useFetch<T>(url: string): FetchState<T> {
  const cached = cache.get(url) as T | undefined;
  const [data, setData] = useState<T | null>(() => cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => cached === undefined);
  const [nonce, setNonce] = useState(0);
  const [activeUrl, setActiveUrl] = useState(url);

  if (url !== activeUrl) {
    setActiveUrl(url);
    const hit = cache.get(url) as T | undefined;
    setData(hit ?? null);
    setError(null);
    setLoading(hit === undefined);
  }

  const reload = useCallback(() => {
    cache.delete(url);
    setNonce((n) => n + 1);
  }, [url]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const json = await loadJson<T>(url);
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  return { data, error, loading, reload };
}
