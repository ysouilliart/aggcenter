import { afterEach, describe, expect, it, vi } from "vitest";

import {
  invalidateFetchCache,
  prefetchFetch,
  readFetchCache,
} from "@/lib/useFetch";

describe("fetch cache", () => {
  afterEach(() => {
    invalidateFetchCache();
    vi.unstubAllGlobals();
  });

  it("stores a successful prefetch and serves it without a second network call", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ total: 3 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    prefetchFetch("/api/reconciliation");
    await vi.waitFor(() => {
      expect(readFetchCache("/api/reconciliation")).toEqual({ total: 3 });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    prefetchFetch("/api/reconciliation");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops cached cash APIs on invalidate", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({ url }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    prefetchFetch("/api/cash-forecast");
    await vi.waitFor(() => {
      expect(readFetchCache("/api/cash-forecast")).toBeTruthy();
    });
    invalidateFetchCache("/api/cash");
    expect(readFetchCache("/api/cash-forecast")).toBeUndefined();
  });
});
