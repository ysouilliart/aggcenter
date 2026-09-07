import type { SnowflakeConfig } from "../config";
import type {
  BankAccount,
  PurchaseOrder,
  Remittance,
  SalesOrder,
} from "../domain/types";
import type { DataSource, StatementManifestEntry } from "./types";

/**
 * Snowflake-backed reference data source.
 *
 * Wiring stub: defines the surface but does not bundle the `snowflake-sdk`
 * dependency. To activate:
 *   1. `npm install snowflake-sdk`
 *   2. Implement each method with a query (e.g. `SELECT ... FROM SALES_ORDERS`).
 *   3. Provide SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_DATABASE, etc.
 *      (and an auth mechanism) via environment / Cursor Secrets.
 */
export class SnowflakeDataSource implements DataSource {
  readonly name = "snowflake";

  constructor(private readonly config: SnowflakeConfig) {}

  private notReady(): never {
    throw new Error(
      "Snowflake data source is selected but the client is not implemented/configured. " +
        "Set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_DATABASE and install snowflake-sdk.",
    );
  }

  getAccounts(): Promise<BankAccount[]> {
    this.notReady();
  }
  getSalesOrders(): Promise<SalesOrder[]> {
    this.notReady();
  }
  getPurchaseOrders(): Promise<PurchaseOrder[]> {
    this.notReady();
  }
  getRemittances(): Promise<Remittance[]> {
    this.notReady();
  }
  getStatementManifest(): Promise<StatementManifestEntry[]> {
    this.notReady();
  }
  readStatementFile(_file: string): Promise<string> {
    void _file;
    this.notReady();
  }
}
