import type { OciConfig } from "../config";
import type { StorageProvider, StoredObject } from "./types";

/**
 * OCI Object Storage provider using the OpenStack **Swift** API (v1 auth).
 *
 * Flow (see Oracle's "Object Storage with the Swift API" docs):
 *   1. GET {baseUrl}/auth/v1.0 with X-Storage-User / X-Storage-Pass
 *      -> returns X-Auth-Token and X-Storage-Url
 *   2. object/container ops against {storageUrl}/{bucket}[/{object}] with X-Auth-Token
 *
 * This is plain HTTPS (no SDK). Credentials come from environment secrets and are
 * only used server-side; they are never logged or returned to clients.
 */

interface Session {
  token: string;
  storageUrl: string;
}

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
  private session?: Session;

  constructor(private readonly config: OciConfig) {}

  private baseUrl(): string {
    const base =
      this.config.swiftBaseUrl ||
      (this.config.region
        ? `https://swiftobjectstorage.${this.config.region}.oraclecloud.com`
        : undefined);
    if (!base) throw new Error("OCI Swift base URL or region is required.");
    return base.replace(/\/+$/, "");
  }

  private bucket(): string {
    if (!this.config.bucket) throw new Error("OCI_BUCKET is required.");
    return this.config.bucket;
  }

  private storageUser(): string {
    const user = this.config.swiftUser;
    if (!user) throw new Error("OCI_SWIFT_USER is required.");
    // OCI expects "<namespace>:<user>"; don't double-prefix if already namespaced.
    if (user.includes(":")) return user;
    if (!this.config.namespace) {
      throw new Error("OCI_NAMESPACE is required for Swift authentication.");
    }
    return `${this.config.namespace}:${user}`;
  }

  private async authenticate(): Promise<Session> {
    const res = await fetch(`${this.baseUrl()}/auth/v1.0`, {
      method: "GET",
      headers: {
        "X-Storage-User": this.storageUser(),
        "X-Storage-Pass": this.config.swiftPassword ?? "",
      },
    });
    if (!res.ok) {
      throw new Error(`OCI Swift authentication failed (HTTP ${res.status}).`);
    }
    const token =
      res.headers.get("x-auth-token") ?? res.headers.get("x-storage-token");
    const storageUrl =
      res.headers.get("x-storage-url") ??
      `${this.baseUrl()}/v1/${this.config.namespace}`;
    if (!token) throw new Error("OCI Swift auth did not return a token.");
    this.session = { token, storageUrl: storageUrl.replace(/\/+$/, "") };
    return this.session;
  }

  private async getSession(): Promise<Session> {
    return this.session ?? this.authenticate();
  }

  private objectUrl(session: Session, key: string): string {
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    return `${session.storageUrl}/${encodeURIComponent(this.bucket())}/${encodedKey}`;
  }

  /** Issue an authenticated request; on 401 re-authenticate once and retry. */
  private async send(
    method: string,
    urlFor: (s: Session) => string,
    init: RequestInit = {},
  ): Promise<Response> {
    const attempt = (s: Session) =>
      fetch(urlFor(s), {
        ...init,
        method,
        headers: { ...(init.headers ?? {}), "X-Auth-Token": s.token },
      });

    let session = await this.getSession();
    let res = await attempt(session);
    if (res.status === 401) {
      session = await this.authenticate();
      res = await attempt(session);
    }
    return res;
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<StoredObject> {
    const res = await this.send("PUT", (s) => this.objectUrl(s, key), {
      // Uint8Array is a valid BodyInit; Buffer is a Uint8Array at runtime.
      body: new Uint8Array(data),
      headers: contentType ? { "Content-Type": contentType } : {},
    });
    if (!res.ok) throw new Error(`OCI Swift put failed (HTTP ${res.status}).`);
    return { key, size: data.length, lastModified: new Date().toISOString() };
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.send("GET", (s) => this.objectUrl(s, key));
    if (!res.ok) throw new Error(`OCI Swift get failed (HTTP ${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }

  async list(prefix = ""): Promise<StoredObject[]> {
    const res = await this.send("GET", (s) => {
      const url = new URL(`${s.storageUrl}/${encodeURIComponent(this.bucket())}`);
      url.searchParams.set("format", "json");
      if (prefix) url.searchParams.set("prefix", prefix);
      return url.toString();
    });
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
    const res = await this.send("DELETE", (s) => this.objectUrl(s, key));
    if (!res.ok && res.status !== 404) {
      throw new Error(`OCI Swift delete failed (HTTP ${res.status}).`);
    }
  }
}
