import type { OciConfig } from "../config";
import type { StorageProvider, StoredObject } from "./types";

/**
 * OCI Object Storage provider using the OpenStack **Swift** API with HTTP
 * **Basic Auth** (Oracle "Approach 1"): every request carries
 * `Authorization: Basic base64(username:auth-token)` against a container URL of
 * the form `https://swiftobjectstorage.{region}.oraclecloud.com/v1/{namespace}/{bucket}`.
 *
 * - username: `<identity-domain>/<user>`, e.g. `oracleidentitycloudservice/<user>`
 * - password: an OCI Auth Token (generated in the console)
 *
 * Dependency-free (plain `fetch`). Credentials come from environment secrets and
 * are only used server-side; they are never logged or returned to clients.
 */

interface SwiftListItem {
  name: string;
  bytes?: number;
  last_modified?: string;
}

function toIso(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  // Swift timestamps are UTC but may omit the zone; assume Z when absent.
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
  const d = new Date(hasZone ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export class OciSwiftStorageProvider implements StorageProvider {
  readonly name = "oci";

  constructor(private readonly config: OciConfig) {}

  /**
   * Resolve the container URL (`.../v1/{namespace}/{bucket}`). Accepts either a
   * full storage path in OCI_SWIFT_BASE_URL, a host-only base URL, or nothing
   * (derived from the region), and appends the bucket when needed.
   */
  private containerUrl(): string {
    const base = this.config.swiftBaseUrl?.replace(/\/+$/, "");

    if (base && base.includes("/v1/")) {
      if (this.config.bucket && !base.endsWith(`/${this.config.bucket}`)) {
        return `${base}/${encodeURIComponent(this.config.bucket)}`;
      }
      return base;
    }

    const host =
      base ||
      (this.config.region
        ? `https://swiftobjectstorage.${this.config.region}.oraclecloud.com`
        : undefined);
    if (!host) throw new Error("OCI Swift base URL or region is required.");
    if (!this.config.namespace) throw new Error("OCI_NAMESPACE is required.");
    if (!this.config.bucket) throw new Error("OCI_BUCKET is required.");
    return `${host}/v1/${encodeURIComponent(this.config.namespace)}/${encodeURIComponent(
      this.config.bucket,
    )}`;
  }

  private authHeader(): string {
    if (!this.config.swiftUser || !this.config.swiftPassword) {
      throw new Error("OCI_SWIFT_USER and OCI_SWIFT_PASSWORD are required.");
    }
    const token = Buffer.from(
      `${this.config.swiftUser}:${this.config.swiftPassword}`,
    ).toString("base64");
    return `Basic ${token}`;
  }

  private objectUrl(key: string): string {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `${this.containerUrl()}/${encoded}`;
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<StoredObject> {
    const res = await fetch(this.objectUrl(key), {
      method: "PUT",
      headers: {
        Authorization: this.authHeader(),
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      // Uint8Array is a valid BodyInit; Buffer is a Uint8Array at runtime.
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`OCI Swift put failed (HTTP ${res.status}).`);
    return { key, size: data.length, lastModified: new Date().toISOString() };
  }

  async get(key: string): Promise<Buffer> {
    const res = await fetch(this.objectUrl(key), {
      headers: { Authorization: this.authHeader() },
    });
    if (!res.ok) throw new Error(`OCI Swift get failed (HTTP ${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }

  async list(prefix = ""): Promise<StoredObject[]> {
    const url = new URL(this.containerUrl());
    url.searchParams.set("format", "json");
    if (prefix) url.searchParams.set("prefix", prefix);
    const res = await fetch(url, { headers: { Authorization: this.authHeader() } });
    if (!res.ok) throw new Error(`OCI Swift list failed (HTTP ${res.status}).`);
    const items = (await res.json()) as SwiftListItem[];
    return items
      .filter((o) => o && typeof o.name === "string")
      .map((o) => ({
        key: o.name,
        size: o.bytes ?? 0,
        lastModified: toIso(o.last_modified),
      }));
  }

  async delete(key: string): Promise<void> {
    const res = await fetch(this.objectUrl(key), {
      method: "DELETE",
      headers: { Authorization: this.authHeader() },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`OCI Swift delete failed (HTTP ${res.status}).`);
    }
  }
}
