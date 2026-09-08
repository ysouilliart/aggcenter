import { describe, expect, it } from "vitest";

import { detectAnomalies } from "@/lib/anomalies/detect";
import { computeCashPosition } from "@/lib/cash/position";
import { LocalDataSource } from "@/lib/datasource/local";
import { parseBankStatementCsv } from "@/lib/parse/bankStatement";
import { reconcile, summarize } from "@/lib/recon/reconcile";
import type { BankTransaction } from "@/lib/domain/types";

/**
 * Golden, end-to-end test over the bundled sample data. All monetary
 * expectations are exact integer cents — if the money pipeline ever drifts back
 * to floats, these assertions break.
 */
async function loadSampleTransactions(): Promise<BankTransaction[]> {
  const ds = new LocalDataSource();
  const [manifest, accounts] = await Promise.all([
    ds.getStatementManifest(),
    ds.getAccounts(),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const transactions: BankTransaction[] = [];
  for (const entry of manifest) {
    const csv = await ds.readStatementFile(entry.file);
    const { transactions: parsed } = parseBankStatementCsv(csv, {
      statementId: entry.id,
      accountId: entry.accountId,
      defaultCurrency: accountById.get(entry.accountId)?.currency,
    });
    transactions.push(...parsed);
  }
  return transactions;
}

describe("golden: sample data pipeline (integer cents)", () => {
  it("computes the USD cash position exactly", async () => {
    const ds = new LocalDataSource();
    const [accounts, transactions] = await Promise.all([
      ds.getAccounts(),
      loadSampleTransactions(),
    ]);

    const usd = computeCashPosition({ currency: "USD", accounts, transactions });
    expect(usd.openingBalance).toBe(25_000_000);
    expect(usd.totalInflows).toBe(29_998_570);
    expect(usd.totalOutflows).toBe(28_077_575);
    expect(usd.netCashFlow).toBe(1_920_995);
    expect(usd.closingBalance).toBe(26_920_995);
    // Closing must equal opening + inflows - outflows, to the cent.
    expect(usd.closingBalance).toBe(
      usd.openingBalance + usd.totalInflows - usd.totalOutflows,
    );
  });

  it("computes the EUR cash position exactly", async () => {
    const ds = new LocalDataSource();
    const [accounts, transactions] = await Promise.all([
      ds.getAccounts(),
      loadSampleTransactions(),
    ]);

    const eur = computeCashPosition({ currency: "EUR", accounts, transactions });
    expect(eur.openingBalance).toBe(8_000_000);
    expect(eur.totalInflows).toBe(4_590_000);
    expect(eur.totalOutflows).toBe(960_000);
    expect(eur.closingBalance).toBe(11_630_000);
  });

  it("reconciles the expected match breakdown", async () => {
    const ds = new LocalDataSource();
    const [transactions, salesOrders, purchaseOrders] = await Promise.all([
      loadSampleTransactions(),
      ds.getSalesOrders(),
      ds.getPurchaseOrders(),
    ]);
    const summary = summarize(
      reconcile({ transactions, salesOrders, purchaseOrders }),
    );
    expect(summary.total).toBe(19);
    expect(summary.matched).toBe(13);
    expect(summary.partial).toBe(1);
    expect(summary.unmatched).toBe(5);
  });

  it("detects the expected anomalies", async () => {
    const ds = new LocalDataSource();
    const [transactions, salesOrders, purchaseOrders, remittances, accounts] =
      await Promise.all([
        loadSampleTransactions(),
        ds.getSalesOrders(),
        ds.getPurchaseOrders(),
        ds.getRemittances(),
        ds.getAccounts(),
      ]);

    const reconciliation = reconcile({ transactions, salesOrders, purchaseOrders });
    const anomalies = detectAnomalies({
      transactions,
      reconciliation,
      remittances,
      accounts,
    });

    const byType = (t: string) => anomalies.filter((a) => a.type === t).length;
    expect(byType("duplicate")).toBe(1);
    expect(byType("amount_mismatch")).toBe(1);
    expect(byType("unmatched_large")).toBe(3);
    expect(byType("missing_receipt")).toBe(1);
    expect(byType("overdraft_risk")).toBe(0);
    expect(anomalies.length).toBe(8);

    // The amount-mismatch (Initech) is exactly -$1,000.00 = -100000 cents.
    const mismatch = anomalies.find((a) => a.type === "amount_mismatch");
    expect(mismatch?.amount).toBe(3_100_000);
  });
});
