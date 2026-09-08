import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OciConfig } from "@/lib/config";
import { OciSwiftStorageProvider } from "@/lib/storage/oci";

const FULL_BASE =
  "https://swiftobjectstorage.us-ashburn-1.oraclecloud.com/v1/ns123/test-bucket";

function swiftConfig(overrides: Partial<OciConfig> = {}): OciConfig {
  return {
    authMode: "swift",
    configured: true,
    bucket: "test-bucket",
    namespace: "ns123",
    region: "us-ashburn-1",
    swiftBaseUrl: FULL_BASE,
    swiftUser: "oracleidentitycloudservice/jane.doe@example.com",
    swiftPassword: "auth-token",
    ...overrides,
  };
}

function expectedBasic(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

let fetchMock: ReturnType<typeof vi.fn>;

function defaultHandler(url: string | URL | Request, init?: RequestInit): Response {
  const method = init?.method ?? "GET";
  if (method === "PUT") return new Response("", { status: 201 });
  if (method === "DELETE") return new Response(null, { status: 204 });
  if (String(url).includes("format=json")) return new Response("[]", { status: 200 });
  return new Response("default-body", { status: 200 });
}

beforeEach(() => {
  fetchMock = vi.fn(defaultHandler);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function callBy(predicate: (url: string, init?: RequestInit) => boolean) {
  return fetchMock.mock.calls.find((c) => predicate(String(c[0]), c[1] as RequestInit));
}

describe("OciSwiftStorageProvider (Basic Auth)", () => {
  it("PUTs to the container URL with a Basic Auth header", async () => {
    const provider = new OciSwiftStorageProvider(swiftConfig());
    const res = await provider.put("statements/a.csv", Buffer.from("x,y"), "text/csv");

    const put = callBy((_u, i) => i?.method === "PUT");
    expect(put?.[0]).toBe(`${FULL_BASE}/statements/a.csv`);
    expect((put?.[1] as RequestInit).headers).toMatchObject({
      Authorization: expectedBasic(
        "oracleidentitycloudservice/jane.doe@example.com",
        "auth-token",
      ),
      "Content-Type": "text/csv",
    });
    expect(Buffer.from((put?.[1] as RequestInit).body as Uint8Array).toString()).toBe("x,y");
    expect(res).toMatchObject({ key: "statements/a.csv", size: 3 });
  });

  it("uses the identity-domain username verbatim (no namespace prefix)", async () => {
    const provider = new OciSwiftStorageProvider(swiftConfig());
    await provider.get("k.txt");
    const get = callBy((u) => u === `${FULL_BASE}/k.txt`);
    expect((get?.[1] as RequestInit).headers).toMatchObject({
      Authorization: expectedBasic(
        "oracleidentitycloudservice/jane.doe@example.com",
        "auth-token",
      ),
    });
  });

  it("GETs an object as a Buffer", async () => {
    fetchMock.mockImplementation((url) =>
      String(url).includes("format=json")
        ? new Response("[]", { status: 200 })
        : new Response("file-body", { status: 200 }),
    );
    const provider = new OciSwiftStorageProvider(swiftConfig());
    expect((await provider.get("k.txt")).toString()).toBe("file-body");
  });

  it("lists and maps container objects", async () => {
    fetchMock.mockImplementation(() =>
      new Response(
        JSON.stringify([
          { name: "statements/a.csv", bytes: 12, last_modified: "2026-08-01T00:00:00.000000" },
          { name: "statements/b.csv", bytes: 0 },
        ]),
        { status: 200 },
      ),
    );
    const provider = new OciSwiftStorageProvider(swiftConfig());
    const list = await provider.list("statements/");

    const listCall = callBy((u) => u.includes("format=json"));
    expect(String(listCall?.[0])).toContain(`${FULL_BASE}?`);
    expect(String(listCall?.[0])).toContain("prefix=statements");
    expect(list).toEqual([
      { key: "statements/a.csv", size: 12, lastModified: "2026-08-01T00:00:00.000Z" },
      { key: "statements/b.csv", size: 0, lastModified: expect.any(String) },
    ]);
  });

  it("DELETEs an object", async () => {
    const provider = new OciSwiftStorageProvider(swiftConfig());
    await provider.delete("k.txt");
    const del = callBy((_u, i) => i?.method === "DELETE");
    expect(del?.[0]).toBe(`${FULL_BASE}/k.txt`);
  });

  it("builds the container URL from host + namespace + bucket when base URL has no path", async () => {
    const provider = new OciSwiftStorageProvider(
      swiftConfig({ swiftBaseUrl: "https://swiftobjectstorage.us-ashburn-1.oraclecloud.com" }),
    );
    await provider.get("k.txt");
    const get = callBy((u) => u.endsWith("/k.txt"));
    expect(get?.[0]).toBe(
      "https://swiftobjectstorage.us-ashburn-1.oraclecloud.com/v1/ns123/test-bucket/k.txt",
    );
  });

  it("derives the base URL from the region when none is provided", async () => {
    const provider = new OciSwiftStorageProvider(
      swiftConfig({ swiftBaseUrl: undefined, region: "us-phoenix-1" }),
    );
    await provider.get("k.txt");
    const get = callBy((u) => u.endsWith("/k.txt"));
    expect(get?.[0]).toBe(
      "https://swiftobjectstorage.us-phoenix-1.oraclecloud.com/v1/ns123/test-bucket/k.txt",
    );
  });

  it("appends the bucket when the base URL is an account URL (.../v1/{namespace})", async () => {
    const provider = new OciSwiftStorageProvider(
      swiftConfig({
        swiftBaseUrl: "https://swiftobjectstorage.us-ashburn-1.oraclecloud.com/v1/ns123",
      }),
    );
    await provider.get("k.txt");
    const get = callBy((u) => u.endsWith("/k.txt"));
    expect(get?.[0]).toBe(`${FULL_BASE}/k.txt`);
  });
});
