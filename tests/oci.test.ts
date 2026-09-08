import { Readable } from "stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OciConfig } from "@/lib/config";

const mocks = vi.hoisted(() => ({
  putObject: vi.fn(),
  getObject: vi.fn(),
  listObjects: vi.fn(),
  deleteObject: vi.fn(),
  getNamespace: vi.fn(),
  simpleCtor: vi.fn(),
  configFileCtor: vi.fn(),
  fromRegionId: vi.fn((r: string) => ({ regionId: r })),
}));

vi.mock("oci-objectstorage", () => {
  class ObjectStorageClient {
    putObject = mocks.putObject;
    getObject = mocks.getObject;
    listObjects = mocks.listObjects;
    deleteObject = mocks.deleteObject;
    getNamespace = mocks.getNamespace;
  }
  return { ObjectStorageClient };
});

vi.mock("oci-common", () => {
  class SimpleAuthenticationDetailsProvider {
    constructor(...args: unknown[]) {
      mocks.simpleCtor(...args);
    }
  }
  class ConfigFileAuthenticationDetailsProvider {
    constructor(...args: unknown[]) {
      mocks.configFileCtor(...args);
    }
  }
  return {
    SimpleAuthenticationDetailsProvider,
    ConfigFileAuthenticationDetailsProvider,
    Region: { fromRegionId: mocks.fromRegionId },
  };
});

import { OciStorageProvider } from "@/lib/storage/oci";

function simpleConfig(overrides: Partial<OciConfig> = {}): OciConfig {
  return {
    bucket: "my-bucket",
    region: "us-ashburn-1",
    authMode: "simple",
    configured: true,
    tenancy: "ocid.tenancy",
    user: "ocid.user",
    fingerprint: "aa:bb:cc",
    privateKeyB64: Buffer.from("PEM-CONTENT").toString("base64"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getNamespace.mockResolvedValue({ value: "ns123" });
  mocks.putObject.mockResolvedValue({});
  mocks.deleteObject.mockResolvedValue({});
  mocks.fromRegionId.mockImplementation((r: string) => ({ regionId: r }));
});

describe("OciStorageProvider", () => {
  it("builds a SimpleAuthenticationDetailsProvider from decoded env secrets", async () => {
    const provider = new OciStorageProvider(simpleConfig());
    await provider.put("statements/a.csv", Buffer.from("x,y"), "text/csv");

    expect(mocks.fromRegionId).toHaveBeenCalledWith("us-ashburn-1");
    // tenancy, user, fingerprint, DECODED private key, passphrase(null), region
    expect(mocks.simpleCtor).toHaveBeenCalledWith(
      "ocid.tenancy",
      "ocid.user",
      "aa:bb:cc",
      "PEM-CONTENT",
      null,
      { regionId: "us-ashburn-1" },
    );
  });

  it("puts an object with namespace, bucket and content length", async () => {
    const provider = new OciStorageProvider(simpleConfig());
    const body = Buffer.from("hello");
    const res = await provider.put("k.txt", body, "text/plain");

    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaceName: "ns123",
        bucketName: "my-bucket",
        objectName: "k.txt",
        putObjectBody: body,
        contentLength: 5,
        contentType: "text/plain",
      }),
    );
    expect(res.key).toBe("k.txt");
    expect(res.size).toBe(5);
  });

  it("reads an object stream into a Buffer", async () => {
    mocks.getObject.mockResolvedValue({ value: Readable.from([Buffer.from("file-body")]) });
    const provider = new OciStorageProvider(simpleConfig());
    const buf = await provider.get("k.txt");
    expect(buf.toString()).toBe("file-body");
    expect(mocks.getObject).toHaveBeenCalledWith(
      expect.objectContaining({ bucketName: "my-bucket", objectName: "k.txt" }),
    );
  });

  it("lists and maps objects", async () => {
    mocks.listObjects.mockResolvedValue({
      listObjects: {
        objects: [
          { name: "statements/a.csv", size: 12, timeModified: new Date("2026-08-01T00:00:00Z") },
          { name: "statements/b.csv", size: 0 },
        ],
      },
    });
    const provider = new OciStorageProvider(simpleConfig());
    const list = await provider.list("statements/");
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ key: "statements/a.csv", size: 12 });
    expect(list[0].lastModified).toBe("2026-08-01T00:00:00.000Z");
  });

  it("deletes an object", async () => {
    const provider = new OciStorageProvider(simpleConfig());
    await provider.delete("k.txt");
    expect(mocks.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({ bucketName: "my-bucket", objectName: "k.txt" }),
    );
  });

  it("fetches and caches the namespace across operations", async () => {
    mocks.getObject.mockResolvedValue({ value: Readable.from([Buffer.from("x")]) });
    mocks.listObjects.mockResolvedValue({ listObjects: { objects: [] } });
    const provider = new OciStorageProvider(simpleConfig());
    await provider.put("a", Buffer.from("a"));
    await provider.get("a");
    await provider.list();
    await provider.delete("a");
    expect(mocks.getNamespace).toHaveBeenCalledTimes(1);
  });

  it("uses the explicit namespace without an API call", async () => {
    const provider = new OciStorageProvider(simpleConfig({ namespace: "explicit-ns" }));
    await provider.put("a", Buffer.from("a"));
    expect(mocks.getNamespace).not.toHaveBeenCalled();
    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: "explicit-ns" }),
    );
  });

  it("supports config-file auth", async () => {
    mocks.listObjects.mockResolvedValue({ listObjects: { objects: [] } });
    const provider = new OciStorageProvider({
      bucket: "b",
      authMode: "configfile",
      configured: true,
      configFile: "/home/u/.oci/config",
      configProfile: "DEFAULT",
    });
    await provider.list();
    expect(mocks.configFileCtor).toHaveBeenCalledWith("/home/u/.oci/config", "DEFAULT");
  });
});
