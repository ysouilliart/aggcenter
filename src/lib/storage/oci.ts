import type { OciConfig } from "../config";
import type { StorageProvider, StoredObject } from "./types";

// Type-only imports are erased at build time, so the heavy SDK is only loaded
// at runtime (via dynamic import) when the OCI provider is actually used.
type Common = typeof import("oci-common");
type ObjectStorage = typeof import("oci-objectstorage");
type Client = InstanceType<ObjectStorage["ObjectStorageClient"]>;

interface Bundle {
  client: Client;
}

/** Normalize a PEM key supplied via env: prefer base64, else fix escaped newlines. */
function resolvePrivateKey(config: OciConfig): string | undefined {
  if (config.privateKeyB64) {
    return Buffer.from(config.privateKeyB64, "base64").toString("utf8");
  }
  if (config.privateKey) {
    return config.privateKey.includes("\\n")
      ? config.privateKey.replace(/\\n/g, "\n")
      : config.privateKey;
  }
  return undefined;
}

async function readStreamToBuffer(value: unknown): Promise<Buffer> {
  if (value == null) return Buffer.alloc(0);
  // Blob / Response-like with arrayBuffer().
  if (typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function") {
    const ab = await (value as Blob).arrayBuffer();
    return Buffer.from(ab);
  }
  // Async-iterable Node Readable / web ReadableStream.
  const chunks: Buffer[] = [];
  for await (const chunk of value as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * OCI Object Storage provider.
 *
 * Auth is resolved from environment secrets (SimpleAuthenticationDetailsProvider)
 * or, if provided, an OCI config file. Credentials are read here on the server
 * only and are never logged or returned to clients.
 */
export class OciStorageProvider implements StorageProvider {
  readonly name = "oci";
  private bundle?: Promise<Bundle>;
  private namespaceCache?: string;

  constructor(private readonly config: OciConfig) {}

  private async buildAuthProvider(common: Common) {
    if (this.config.authMode === "simple") {
      const privateKey = resolvePrivateKey(this.config);
      if (!privateKey) throw new Error("OCI private key is missing.");
      return new common.SimpleAuthenticationDetailsProvider(
        this.config.tenancy!,
        this.config.user!,
        this.config.fingerprint!,
        privateKey,
        this.config.passphrase ?? null,
        common.Region.fromRegionId(this.config.region!),
      );
    }
    if (this.config.authMode === "configfile") {
      return new common.ConfigFileAuthenticationDetailsProvider(
        this.config.configFile,
        this.config.configProfile,
      );
    }
    throw new Error(
      "OCI is not configured. Provide OCI_TENANCY/OCI_USER/OCI_FINGERPRINT/OCI_PRIVATE_KEY(_B64)/OCI_REGION " +
        "or OCI_CONFIG_FILE (see .env.example).",
    );
  }

  private async getBundle(): Promise<Bundle> {
    if (!this.bundle) {
      this.bundle = (async () => {
        const common = (await import("oci-common")) as Common;
        const os = (await import("oci-objectstorage")) as ObjectStorage;
        const authenticationDetailsProvider = await this.buildAuthProvider(common);
        const client = new os.ObjectStorageClient({ authenticationDetailsProvider });
        return { client };
      })();
    }
    return this.bundle;
  }

  private async namespace(client: Client): Promise<string> {
    if (this.config.namespace) return this.config.namespace;
    if (this.namespaceCache) return this.namespaceCache;
    const res = await client.getNamespace({});
    this.namespaceCache = res.value;
    return res.value;
  }

  private bucket(): string {
    if (!this.config.bucket) throw new Error("OCI_BUCKET is not set.");
    return this.config.bucket;
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<StoredObject> {
    const { client } = await this.getBundle();
    const namespaceName = await this.namespace(client);
    await client.putObject({
      namespaceName,
      bucketName: this.bucket(),
      objectName: key,
      putObjectBody: data,
      contentLength: data.length,
      contentType,
    });
    return { key, size: data.length, lastModified: new Date().toISOString() };
  }

  async get(key: string): Promise<Buffer> {
    const { client } = await this.getBundle();
    const namespaceName = await this.namespace(client);
    const res = await client.getObject({
      namespaceName,
      bucketName: this.bucket(),
      objectName: key,
    });
    return readStreamToBuffer(res.value);
  }

  async list(prefix = ""): Promise<StoredObject[]> {
    const { client } = await this.getBundle();
    const namespaceName = await this.namespace(client);
    const res = await client.listObjects({
      namespaceName,
      bucketName: this.bucket(),
      prefix: prefix || undefined,
      fields: "name,size,timeModified",
    });
    const objects = res.listObjects?.objects ?? [];
    return objects.map((o) => ({
      key: o.name,
      size: o.size ?? 0,
      lastModified: new Date(
        (o.timeModified as Date | undefined) ?? Date.now(),
      ).toISOString(),
    }));
  }

  async delete(key: string): Promise<void> {
    const { client } = await this.getBundle();
    const namespaceName = await this.namespace(client);
    await client.deleteObject({
      namespaceName,
      bucketName: this.bucket(),
      objectName: key,
    });
  }
}
