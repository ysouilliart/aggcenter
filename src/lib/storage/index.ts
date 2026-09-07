import { getConfig } from "../config";
import { LocalStorageProvider } from "./local";
import { OciStorageProvider } from "./oci";
import type { StorageProvider } from "./types";

export type { StorageProvider, StoredObject } from "./types";

let cached: StorageProvider | null = null;

/**
 * Resolve the active StorageProvider. Uses OCI when explicitly selected and
 * configured; otherwise falls back to the local filesystem provider so the app
 * always has working file storage in development.
 */
export function getStorageProvider(): StorageProvider {
  if (cached) return cached;

  const config = getConfig();
  if (config.storageProvider === "oci" && config.oci.configured) {
    cached = new OciStorageProvider(config.oci);
  } else {
    cached = new LocalStorageProvider();
  }
  return cached;
}
