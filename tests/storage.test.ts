import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getConfig } from "@/lib/config";
import { LocalStorageProvider } from "@/lib/storage/local";
import { assertSafeKey, buildObjectPreview } from "@/lib/service";

describe("assertSafeKey", () => {
  it("accepts normal object keys", () => {
    expect(() => assertSafeKey("statements/UP-1-report.csv")).not.toThrow();
    expect(() => assertSafeKey("a/b/c.json")).not.toThrow();
  });

  it("rejects traversal and unsafe keys", () => {
    for (const bad of ["", "../secret", "a/../../etc/passwd", "/abs", "a\\b", "x\0y"]) {
      expect(() => assertSafeKey(bad)).toThrow();
    }
  });
});

describe("buildObjectPreview", () => {
  it("returns text for small utf-8 content", () => {
    const p = buildObjectPreview("a.csv", "local", Buffer.from("hello,world"));
    expect(p.isBinary).toBe(false);
    expect(p.truncated).toBe(false);
    expect(p.text).toBe("hello,world");
    expect(p.size).toBe(11);
  });

  it("flags binary content and omits text", () => {
    const p = buildObjectPreview("b.bin", "local", Buffer.from([65, 0, 66]));
    expect(p.isBinary).toBe(true);
    expect(p.text).toBe("");
  });

  it("truncates oversized content", () => {
    const big = Buffer.alloc(512 * 1024 + 100, 0x41); // > 512 KiB of 'A'
    const p = buildObjectPreview("big.txt", "local", big);
    expect(p.truncated).toBe(true);
    expect(p.size).toBe(big.length);
    expect(p.text.length).toBe(512 * 1024);
  });

  it("treats PDFs as binary even when they have no NUL bytes", () => {
    const p = buildObjectPreview(
      "aggCenter/bankStatements/UK-HSBC/stmt.pdf",
      "oci",
      Buffer.from("%PDF-1.4 text-only statement"),
    );
    expect(p.isBinary).toBe(true);
    expect(p.text).toBe("");
  });
});

describe("LocalStorageProvider", () => {
  const root = path.join(os.tmpdir(), `aggcenter-store-${Date.now()}`);
  const provider = new LocalStorageProvider(root);

  it("round-trips put/get/list/delete", async () => {
    await provider.put("statements/a.csv", Buffer.from("x,y\n1,2"), "text/csv");
    const got = await provider.get("statements/a.csv");
    expect(got.toString()).toBe("x,y\n1,2");

    const list = await provider.list("statements/");
    expect(list.map((o) => o.key)).toContain("statements/a.csv");
    expect(list[0].size).toBeGreaterThan(0);

    await provider.delete("statements/a.csv");
    const after = await provider.list("statements/");
    expect(after.find((o) => o.key === "statements/a.csv")).toBeUndefined();
  });
});

describe("OCI Swift config auth-mode resolution", () => {
  const KEYS = [
    "OCI_BUCKET",
    "OCI_NAMESPACE",
    "OCI_REGION",
    "OCI_SWIFT_BASE_URL",
    "OCI_SWIFT_USER",
    "OCI_SWIFT_PASSWORD",
  ];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("is 'none' and unconfigured with no settings", () => {
    expect(getConfig().oci.authMode).toBe("none");
    expect(getConfig().oci.configured).toBe(false);
  });

  it("is 'swift' when credentials + bucket + namespace + region are present", () => {
    process.env.OCI_BUCKET = "b";
    process.env.OCI_NAMESPACE = "ns";
    process.env.OCI_REGION = "us-ashburn-1";
    process.env.OCI_SWIFT_USER = "domain/user";
    process.env.OCI_SWIFT_PASSWORD = "token";
    const oci = getConfig().oci;
    expect(oci.authMode).toBe("swift");
    expect(oci.configured).toBe(true);
  });

  it("accepts a host base URL (with namespace + bucket) instead of a region", () => {
    process.env.OCI_BUCKET = "b";
    process.env.OCI_NAMESPACE = "ns";
    process.env.OCI_SWIFT_BASE_URL = "https://swiftobjectstorage.x.oraclecloud.com";
    process.env.OCI_SWIFT_USER = "domain/user";
    process.env.OCI_SWIFT_PASSWORD = "token";
    expect(getConfig().oci.configured).toBe(true);
  });

  it("accepts a full container base URL without separate namespace/bucket", () => {
    process.env.OCI_SWIFT_BASE_URL =
      "https://swiftobjectstorage.us-ashburn-1.oraclecloud.com/v1/ns/bucket";
    process.env.OCI_SWIFT_USER = "oracleidentitycloudservice/user";
    process.env.OCI_SWIFT_PASSWORD = "token";
    const oci = getConfig().oci;
    expect(oci.authMode).toBe("swift");
    expect(oci.configured).toBe(true);
  });

  it("is unconfigured when the password is missing", () => {
    process.env.OCI_BUCKET = "b";
    process.env.OCI_NAMESPACE = "ns";
    process.env.OCI_REGION = "us-ashburn-1";
    process.env.OCI_SWIFT_USER = "domain/user";
    expect(getConfig().oci.authMode).toBe("none");
    expect(getConfig().oci.configured).toBe(false);
  });
});
