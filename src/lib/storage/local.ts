import { promises as fs } from "fs";
import path from "path";

import type { StorageProvider, StoredObject } from "./types";

/**
 * Filesystem-backed StorageProvider. Objects live under `.data/storage/`,
 * which mirrors an object-storage bucket layout closely enough for local dev.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? path.join(process.cwd(), ".data", "storage");
  }

  private full(key: string): string {
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<StoredObject> {
    const dest = this.full(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
    const stat = await fs.stat(dest);
    return { key, size: stat.size, lastModified: stat.mtime.toISOString() };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.full(key));
  }

  async list(prefix = ""): Promise<StoredObject[]> {
    const base = this.root;
    const results: StoredObject[] = [];

    async function walk(dir: string): Promise<void> {
      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
        } else {
          const key = path.relative(base, abs).split(path.sep).join("/");
          if (key.startsWith(prefix)) {
            const stat = await fs.stat(abs);
            results.push({
              key,
              size: stat.size,
              lastModified: stat.mtime.toISOString(),
            });
          }
        }
      }
    }

    await walk(base);
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.full(key), { force: true });
  }
}
