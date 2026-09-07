import type { OciConfig } from "../config";
import type { StorageProvider, StoredObject } from "./types";

/**
 * OCI Object Storage provider.
 *
 * This is a wiring stub: it validates configuration and defines the surface
 * area, but does not bundle the `oci-sdk` dependency yet. To activate:
 *   1. `npm install oci-common oci-objectstorage`
 *   2. Implement the methods below using ObjectStorageClient.
 *   3. Provide OCI_NAMESPACE, OCI_BUCKET, OCI_REGION and auth (config file or
 *      instance principals) via environment / Cursor Secrets.
 */
export class OciStorageProvider implements StorageProvider {
  readonly name = "oci";

  constructor(private readonly config: OciConfig) {}

  private notReady(): never {
    throw new Error(
      "OCI Object Storage is selected but the client is not implemented/configured. " +
        "Set OCI_NAMESPACE, OCI_BUCKET, OCI_REGION and install oci-objectstorage. " +
        "Falling back to the local provider is recommended for development.",
    );
  }

  async put(key: string, _data: Buffer, _contentType?: string): Promise<StoredObject> {
    void key;
    void _data;
    void _contentType;
    this.notReady();
  }

  async get(key: string): Promise<Buffer> {
    void key;
    this.notReady();
  }

  async list(prefix?: string): Promise<StoredObject[]> {
    void prefix;
    this.notReady();
  }

  async delete(key: string): Promise<void> {
    void key;
    this.notReady();
  }
}
