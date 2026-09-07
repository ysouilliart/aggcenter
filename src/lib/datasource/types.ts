import type {
  BankAccount,
  PurchaseOrder,
  Remittance,
  SalesOrder,
} from "../domain/types";

export interface StatementManifestEntry {
  id: string;
  file: string;
  accountId: string;
  periodStart: string;
  periodEnd: string;
}

/**
 * Reference-data source for the reconciliation engine: accounts and the
 * expected side of each flow (sales orders, purchase orders, remittances).
 * The local implementation reads bundled sample data; the Snowflake
 * implementation would query the data warehouse.
 */
export interface DataSource {
  readonly name: string;
  getAccounts(): Promise<BankAccount[]>;
  getSalesOrders(): Promise<SalesOrder[]>;
  getPurchaseOrders(): Promise<PurchaseOrder[]>;
  getRemittances(): Promise<Remittance[]>;
  getStatementManifest(): Promise<StatementManifestEntry[]>;
  readStatementFile(file: string): Promise<string>;
}
