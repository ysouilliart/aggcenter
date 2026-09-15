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
 * Supporting-file source used to identify bank-statement payments: accounts,
 * sales orders, purchase orders, and remittances. The local implementation
 * reads bundled sample data; the Snowflake implementation would query the
 * data warehouse. Remittances that are not on the statement also feed the
 * cash forecast.
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
