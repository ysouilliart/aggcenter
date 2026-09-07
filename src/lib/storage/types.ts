export interface StoredObject {
  key: string;
  size: number;
  lastModified: string;
}

/**
 * Minimal object-storage abstraction. The local implementation is used by
 * default; the OCI implementation talks to an OCI Object Storage bucket once
 * credentials are configured.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer, contentType?: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  list(prefix?: string): Promise<StoredObject[]>;
  delete(key: string): Promise<void>;
}
