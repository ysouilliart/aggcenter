import { describe, expect, it } from "vitest";

import { getConfig } from "@/lib/config";
import {
  DEFAULT_CASH_ORG_ROOT,
  cashObjectPrefix,
  joinObjectPrefix,
  resolveCashFilePrefixes,
} from "@/lib/cash/paths";

describe("cash object prefixes", () => {
  it("preserves the org-root spacing and casing", () => {
    expect(DEFAULT_CASH_ORG_ROOT).toBe("aggCenter/ORG_112 - UK");
    expect(cashObjectPrefix("inv")).toBe("aggCenter/ORG_112 - UK/inv/");
    expect(cashObjectPrefix("po")).toBe("aggCenter/ORG_112 - UK/po/");
    expect(cashObjectPrefix("so")).toBe("aggCenter/ORG_112 - UK/so/");
    expect(cashObjectPrefix("rem")).toBe("aggCenter/ORG_112 - UK/rem/");
    expect(cashObjectPrefix("bank")).toBe("aggCenter/ORG_112 - UK/bank/");
  });

  it("joins segments without collapsing spaces", () => {
    expect(joinObjectPrefix("aggCenter/ORG_112 - UK", "inv")).toBe(
      "aggCenter/ORG_112 - UK/inv/",
    );
  });

  it("defaults CSV and PDF statement prefixes to the bank folder", () => {
    const prefixes = resolveCashFilePrefixes({});
    expect(prefixes.orgRoot).toBe(DEFAULT_CASH_ORG_ROOT);
    expect(prefixes.bank).toBe("aggCenter/ORG_112 - UK/bank/");
    expect(prefixes.statementCsv).toBe(prefixes.bank);
    expect(prefixes.statementPdf).toBe(prefixes.bank);
    expect(prefixes.inv).toBe("aggCenter/ORG_112 - UK/inv/");
    expect(prefixes.po).toBe("aggCenter/ORG_112 - UK/po/");
    expect(prefixes.so).toBe("aggCenter/ORG_112 - UK/so/");
    expect(prefixes.rem).toBe("aggCenter/ORG_112 - UK/rem/");
  });

  it("rebuilds every folder when CASH_ORG_ROOT is set", () => {
    const prefixes = resolveCashFilePrefixes({
      CASH_ORG_ROOT: "aggCenter/ORG_99 - IE/",
    });
    expect(prefixes.orgRoot).toBe("aggCenter/ORG_99 - IE");
    expect(prefixes.po).toBe("aggCenter/ORG_99 - IE/po/");
    expect(prefixes.statementCsv).toBe("aggCenter/ORG_99 - IE/bank/");
  });

  it("lets a full prefix env override a single folder", () => {
    const prefixes = resolveCashFilePrefixes({
      REFERENCE_PO_PREFIX: "custom/purchaseOrders",
      STATEMENT_CSV_PREFIX: "inbox",
    });
    expect(prefixes.po).toBe("custom/purchaseOrders/");
    expect(prefixes.statementCsv).toBe("inbox/");
    expect(prefixes.statementPdf).toBe("aggCenter/ORG_112 - UK/bank/");
    expect(prefixes.inv).toBe("aggCenter/ORG_112 - UK/inv/");
  });
});

describe("getConfig cash file defaults", () => {
  const KEYS = [
    "CASH_ORG_ROOT",
    "STATEMENT_CSV_PREFIX",
    "STATEMENT_PDF_PREFIX",
    "REFERENCE_AP_PREFIX",
    "REFERENCE_PO_PREFIX",
    "REFERENCE_SO_PREFIX",
    "REFERENCE_REMITTANCE_PREFIX",
  ];

  it("exposes the UK org layout on AppConfig", () => {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    try {
      for (const k of KEYS) delete process.env[k];
      const config = getConfig();
      expect(config.cashFiles.orgRoot).toBe("aggCenter/ORG_112 - UK");
      expect(config.referencePoPrefix).toBe("aggCenter/ORG_112 - UK/po/");
      expect(config.referenceApPrefix).toBe("aggCenter/ORG_112 - UK/inv/");
      expect(config.referenceSalesOrderPrefix).toBe("aggCenter/ORG_112 - UK/so/");
      expect(config.referenceRemittancePrefix).toBe("aggCenter/ORG_112 - UK/rem/");
      expect(config.statementCsvPrefix).toBe("aggCenter/ORG_112 - UK/bank/");
      expect(config.statementPdfPrefix).toBe("aggCenter/ORG_112 - UK/bank/");
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
