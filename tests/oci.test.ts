import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OciConfig } from "@/lib/config";
import { OciSwiftStorageProvider } from "@/lib/storage/oci";

const AUTH_HEADERS = {
  "x-auth-token": "TOK",
  "x-storage-url": "https://swift.example/v1/ns123",
};

function swiftConfig(overrides: Partial<OciConfig> = {}): OciConfig {
  return {
    authMode: "swift",
    configured: true,
    bucket: "test-bucket",
    namespace: "ns123",
    region: "us-ashburn-1",
    swiftBaseUrl: "https://swift.example",
    swiftUser: "myuser",
    swiftPassword: "pw",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function defaultHandler(url: string | URL | Request, init?: RequestInit): Response {
  const u = String(url);
  const method = init?.method ?? "GET";
  if (u.endsWith("/auth/v1.0")) {
    return new Response("", { status: 200, headers: AUTH_HEADERS });
  }
  if (method === "PUT") return new Response("", { status: 201 });
  if (method === "DELETE") return new Response(null, { status: 204 });
  if (u.includes("format=json")) return new Response("[]", { status: 200 });
  return new Response("default-body", { status: 200 });
}

beforeEach(() => {
  fetchMock = vi.fn(defaultHandler);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function authCall() {
  return fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/auth/v1.0"));
}

describe("OciSwiftStorageProvider", () => {
  it("authenticates with X-Storage-User/Pass and puts to the object URL", async () => {
    const provider = new OciSwiftStorageProvider(swiftConfig());
    const body = Buffer.from("x,y");
    const res = await provider.put("statements/a.csv", body, "text/csv");

    const auth = authCall();
    expect(auth?.[0]).toBe("https://swift.example/auth/v1.0");
    expect((auth?.[1] as RequestInit).headers).toMatchObject({
      "X-Storage-User": "ns123:myuser",
      "X-Storage-Pass": "pw",
    });

    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT");
    expect(put?.[0]).toBe(
      "https://swift.example/v1/ns123/test-bucket/statements/a.csv",
    );
    expect((put?.[1] as RequestInit).headers).toMatchObject({
      "X-Auth-Token": "TOK",
      "Content-Type": "text/csv",
    });
    const sentBody = Buffer.from((put?.[1] as RequestInit).body as Uint8Array);
    expect(sentBody.toString()).toBe("x,y");
    expect(res).toMatchObject({ key: "statements/a.csv", size: 3 });
  });

  it("gets an object as a Buffer", async () => {
    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.endsWith("/auth/v1.0")) return new Response("", { status: 200, headers: AUTH_HEADERS });
      return new Response("file-body", { status: 200 });
    });
    const provider = new OciSwiftStorageProvider(swiftConfig());
    const buf = await provider.get("k.txt");
    expect(buf.toString()).toBe("file-body");
  });

  it("lists and maps container objects", async () => {
    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.endsWith("/auth/v1.0")) return new Response("", { status: 200, headers: AUTH_HEADERS });
      return new Response(
        JSON.stringify([
          { name: "statements/a.csv", bytes: 12, last_modified: "2026-08-01T00:00:00.000000" },
          { name: "statements/b.csv", bytes: 0 },
        ]),
        { status: 200 },
      );
    });
    const provider = new OciSwiftStorageProvider(swiftConfig());
    const list = await provider.list("statements/");

    const listCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("format=json"));
    expect(String(listCall?.[0])).toContain("prefix=statements");
    expect(list).toEqual([
      { key: "statements/a.csv", size: 12, lastModified: "2026-08-01T00:00:00.000Z" },
      { key: "statements/b.csv", size: 0, lastModified: expect.any(String) },
    ]);
  });

  it("deletes an object", async () => {
    const provider = new OciSwiftStorageProvider(swiftConfig());
    await provider.delete("k.txt");
    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(del?.[0]).toBe("https://swift.example/v1/ns123/test-bucket/k.txt");
  });

  it("re-authenticates once on a 401 and retries", async () => {
    let objectAttempts = 0;
    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.endsWith("/auth/v1.0")) return new Response("", { status: 200, headers: AUTH_HEADERS });
      objectAttempts += 1;
      if (objectAttempts === 1) return new Response("", { status: 401 });
      return new Response("recovered", { status: 200 });
    });
    const provider = new OciSwiftStorageProvider(swiftConfig());
    const buf = await provider.get("k.txt");
    expect(buf.toString()).toBe("recovered");
    const authCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/auth/v1.0"));
    expect(authCalls).toHaveLength(2);
  });

  it("does not double-prefix a namespaced Swift user", async () => {
    const provider = new OciSwiftStorageProvider(swiftConfig({ swiftUser: "ns123:already" }));
    await provider.list();
    expect((authCall()?.[1] as RequestInit).headers).toMatchObject({
      "X-Storage-User": "ns123:already",
    });
  });

  it("derives the base URL from the region when not provided", async () => {
    const provider = new OciSwiftStorageProvider(
      swiftConfig({ swiftBaseUrl: undefined, region: "us-phoenix-1" }),
    );
    await provider.list();
    expect(authCall()?.[0]).toBe(
      "https://swiftobjectstorage.us-phoenix-1.oraclecloud.com/auth/v1.0",
    );
  });
});
