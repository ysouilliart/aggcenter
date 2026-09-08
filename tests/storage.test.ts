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

describe("OCI config auth-mode resolution", () => {
  const KEYS = [
    "OCI_BUCKET",
    "OCI_REGION",
    "OCI_TENANCY",
    "OCI_USER",
    "OCI_FINGERPRINT",
    "OCI_PRIVATE_KEY_B64",
    "OCI_CONFIG_FILE",
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

  it("is 'simple' when env credentials are present", () => {
    process.env.OCI_BUCKET = "b";
    process.env.OCI_REGION = "us-ashburn-1";
    process.env.OCI_TENANCY = "ocid.tenancy";
    process.env.OCI_USER = "ocid.user";
    process.env.OCI_FINGERPRINT = "aa:bb";
    process.env.OCI_PRIVATE_KEY_B64 = "cGVt";
    const oci = getConfig().oci;
    expect(oci.authMode).toBe("simple");
    expect(oci.configured).toBe(true);
  });

  it("is 'configfile' when only a config file is provided", () => {
    process.env.OCI_BUCKET = "b";
    process.env.OCI_CONFIG_FILE = "/home/u/.oci/config";
    const oci = getConfig().oci;
    expect(oci.authMode).toBe("configfile");
    expect(oci.configured).toBe(true);
  });
});
