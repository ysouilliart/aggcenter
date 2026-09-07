import { promises as fs } from "fs";
import path from "path";

import type {
  BankAccount,
  PurchaseOrder,
  Remittance,
  SalesOrder,
} from "../domain/types";
import type { DataSource, StatementManifestEntry } from "./types";

const SAMPLE_DIR = path.join(process.cwd(), "data", "sample");

async function readJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(path.join(SAMPLE_DIR, file), "utf8");
  return JSON.parse(raw) as T;
}

/** Reads reference data and statement files from the bundled `data/sample` set. */
export class LocalDataSource implements DataSource {
  readonly name = "local";

  getAccounts(): Promise<BankAccount[]> {
    return readJson<BankAccount[]>("accounts.json");
  }

  getSalesOrders(): Promise<SalesOrder[]> {
    return readJson<SalesOrder[]>("sales-orders.json");
  }

  getPurchaseOrders(): Promise<PurchaseOrder[]> {
    return readJson<PurchaseOrder[]>("purchase-orders.json");
  }

  getRemittances(): Promise<Remittance[]> {
    return readJson<Remittance[]>("remittances.json");
  }

  getStatementManifest(): Promise<StatementManifestEntry[]> {
    return readJson<StatementManifestEntry[]>("statements/manifest.json");
  }

  readStatementFile(file: string): Promise<string> {
    return fs.readFile(path.join(SAMPLE_DIR, file), "utf8");
  }
}
