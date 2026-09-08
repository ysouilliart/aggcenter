import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/parse/csv";
import { parseBankStatementCsv } from "@/lib/parse/bankStatement";

describe("parseCsv", () => {
  it("parses quoted fields and escaped quotes", () => {
    const rows = parseCsv(
      'a,b,c\n1,"hello, world","say ""hi"""\n2,x,y\n',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ a: "1", b: "hello, world", c: 'say "hi"' });
    expect(rows[1]).toEqual({ a: "2", b: "x", c: "y" });
  });
});

describe("parseBankStatementCsv", () => {
  it("parses signed amounts, references and currency defaults", () => {
    const csv = [
      "date,description,reference,counterparty,amount,currency",
      "2026-08-03,Incoming wire,SO-5001,Acme Corp,48250.00,USD",
      "2026-08-05,Vendor payment,PO-8001,CloudHost Ltd,-12000.00,USD",
    ].join("\n");

    const { transactions, errors } = parseBankStatementCsv(csv, {
      statementId: "STMT-1",
      accountId: "ACC-1",
    });

    expect(errors).toHaveLength(0);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      id: "STMT-1-L1",
      amount: 4825000, // cents
      reference: "SO-5001",
      counterparty: "Acme Corp",
      currency: "USD",
    });
    expect(transactions[1].amount).toBe(-1200000); // cents
  });

  it("derives amount from debit/credit columns and parenthesised negatives", () => {
    const csv = [
      "date,description,debit,credit",
      "2026-08-01,Deposit,,1000",
      "2026-08-02,Withdrawal,(250.50),",
    ].join("\n");

    const { transactions } = parseBankStatementCsv(csv, {
      statementId: "S",
      accountId: "A",
      defaultCurrency: "EUR",
    });

    expect(transactions[0].amount).toBe(100000); // 1000.00 in cents
    expect(transactions[0].currency).toBe("EUR");
    expect(transactions[1].amount).toBe(-25050); // (250.50) in cents
  });

  it("reports errors for unparseable dates", () => {
    const csv = "date,amount\nnot-a-date,100";
    const { transactions, errors } = parseBankStatementCsv(csv, {
      statementId: "S",
      accountId: "A",
    });
    expect(transactions).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });
});
