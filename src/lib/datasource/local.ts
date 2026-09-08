import { promises as fs } from "fs";
import path from "path";

import type {
  BankAccount,
  PurchaseOrder,
  Remittance,
  SalesOrder,
} from "../domain/types";
import { toCents } from "../money";
import type { DataSource, StatementManifestEntry } from "./types";

const SAMPLE_DIR = path.join(process.cwd(), "data", "sample");

async function readJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(path.join(SAMPLE_DIR, file), "utf8");
  return JSON.parse(raw) as T;
}

/**
 * Reads reference data and statement files from the bundled `data/sample` set.
 *
 * Sample JSON is authored in human-friendly major units (e.g. 3400.75); amounts
 * are converted to integer cents here so the rest of the domain only ever sees
 * minor units.
 */
export class LocalDataSource implements DataSource {
  readonly name = "local";

  async getAccounts(): Promise<BankAccount[]> {
    const accounts = await readJson<BankAccount[]>("accounts.json");
    return accounts.map((a) => ({ ...a, openingBalance: toCents(a.openingBalance) }));
  }

  async getSalesOrders(): Promise<SalesOrder[]> {
    const orders = await readJson<SalesOrder[]>("sales-orders.json");
    return orders.map((o) => ({ ...o, amount: toCents(o.amount) }));
  }

  async getPurchaseOrders(): Promise<PurchaseOrder[]> {
    const orders = await readJson<PurchaseOrder[]>("purchase-orders.json");
    return orders.map((o) => ({ ...o, amount: toCents(o.amount) }));
  }

  async getRemittances(): Promise<Remittance[]> {
    const rems = await readJson<Remittance[]>("remittances.json");
    return rems.map((r) => ({ ...r, amount: toCents(r.amount) }));
  }

  getStatementManifest(): Promise<StatementManifestEntry[]> {
    return readJson<StatementManifestEntry[]>("statements/manifest.json");
  }

  readStatementFile(file: string): Promise<string> {
    return fs.readFile(path.join(SAMPLE_DIR, file), "utf8");
  }
}
