import type {
  BankTransaction,
  FlowType,
  PurchaseOrder,
  ReconciliationResult,
  Remittance,
  SalesOrder,
} from "../domain/types";
import { formatCentsPlain } from "../money";
import {
  daysBetween,
  extractMatchTokens,
  isDistinctiveReference,
  namesLooselyMatch,
} from "../reference/util";

export interface ReconcileInput {
  transactions: BankTransaction[];
  salesOrders: SalesOrder[];
  purchaseOrders: PurchaseOrder[];
  remittances?: Remittance[];
}

export interface ReconciliationSummary {
  total: number;
  matched: number;
  partial: number;
  unmatched: number;
  /** Absolute value reconciled (matched + partial) vs total, 0..1. */
  matchRate: number;
}

const DATE_WINDOW_DAYS = 5;

function amountsMatch(a: number, b: number): boolean {
  const tolerance = Math.max(1, Math.round(Math.abs(b) * 0.005));
  return Math.abs(a - b) <= tolerance;
}

function txnTokens(txn: BankTransaction): string[] {
  return extractMatchTokens([
    txn.reference,
    txn.description,
    txn.narrative,
    txn.customerReference,
    txn.bankReference,
    txn.counterparty,
  ]);
}

function remittanceRefs(rem: Remittance): string[] {
  const refs = [...(rem.invoiceNumbers ?? [])];
  if (isDistinctiveReference(rem.remittanceNumber)) refs.push(rem.remittanceNumber!);
  if (isDistinctiveReference(rem.reference)) refs.push(rem.reference);
  return refs.map((r) => r.toUpperCase().replace(/\s+/g, ""));
}

function poRefs(po: PurchaseOrder): string[] {
  const refs = [...(po.poNumbers ?? [])];
  if (po.invoiceNumber) refs.push(po.invoiceNumber);
  refs.push(po.id);
  return refs.map((r) => r.toUpperCase().replace(/\s+/g, ""));
}

/**
 * Reconcile bank transactions against the expected side of each flow:
 *   - credits (inflows) are matched to Sales Orders (Order to Cash)
 *   - debits (outflows) are matched to Purchase Orders (Procure to Pay)
 *   - remittances (AR receipts / AP payments) are used when SO/PO refs are absent
 *
 * Matching prefers an explicit document reference, then a date-windowed unique
 * remittance amount, then a unique amount+currency match on SO/PO.
 */
export function reconcile(input: ReconcileInput): ReconciliationResult[] {
  const { transactions, salesOrders, purchaseOrders } = input;
  const remittances = input.remittances ?? [];

  const soById = new Map(salesOrders.map((so) => [so.id.toUpperCase(), so]));
  const poById = new Map(purchaseOrders.map((po) => [po.id.toUpperCase(), po]));

  return transactions.map((txn) => {
    const flow: FlowType = txn.amount >= 0 ? "O2C" : "P2P";
    const abs = Math.abs(txn.amount);
    const matchedType = flow === "O2C" ? "SO" : "PO";
    const candidates = flow === "O2C" ? salesOrders : purchaseOrders;
    const byId = flow === "O2C" ? soById : poById;
    const tokens = txnTokens(txn);

    const base: ReconciliationResult = {
      transactionId: txn.id,
      accountId: txn.accountId,
      date: txn.date,
      amount: txn.amount,
      currency: txn.currency,
      flow,
      status: "unmatched",
      confidence: 0,
      amountDiff: 0,
      reasons: [],
    };

    // 1) Classic SO/PO id in the bank text.
    for (const ref of tokens) {
      const doc = byId.get(ref);
      if (doc && doc.currency === txn.currency) {
        const amountDiff = abs - doc.amount;
        if (amountsMatch(abs, doc.amount)) {
          return {
            ...base,
            status: "matched",
            matchedType,
            matchedId: doc.id,
            confidence: 0.99,
            amountDiff,
            reasons: ["reference match", "amount match"],
          };
        }
        return {
          ...base,
          status: "partial",
          matchedType,
          matchedId: doc.id,
          confidence: 0.6,
          amountDiff,
          reasons: [
            "reference match",
            `amount differs by ${formatCentsPlain(amountDiff)} ${txn.currency}`,
          ],
        };
      }
    }

    // 2) AP invoice / PO number on a purchase-order row.
    if (flow === "P2P") {
      const byInvoice = purchaseOrders.filter(
        (po) =>
          po.currency === txn.currency &&
          poRefs(po).some((ref) => tokens.includes(ref)),
      );
      if (byInvoice.length === 1) {
        const doc = byInvoice[0];
        const amountDiff = abs - doc.amount;
        if (amountsMatch(abs, doc.amount)) {
          return {
            ...base,
            status: "matched",
            matchedType: "PO",
            matchedId: doc.id,
            confidence: 0.95,
            amountDiff,
            reasons: ["invoice/PO number match", "amount match"],
          };
        }
        return {
          ...base,
          status: "partial",
          matchedType: "PO",
          matchedId: doc.id,
          confidence: 0.6,
          amountDiff,
          reasons: [
            "invoice/PO number match",
            `amount differs by ${formatCentsPlain(amountDiff)} ${txn.currency}`,
          ],
        };
      }
    }

    // 3) Remittance invoice / payment reference.
    const remParty = flow === "O2C" ? "customer" : "vendor";
    const remByRef = remittances.filter(
      (rem) =>
        rem.party === remParty &&
        rem.currency === txn.currency &&
        remittanceRefs(rem).some((ref) => tokens.includes(ref)),
    );
    if (remByRef.length === 1) {
      const rem = remByRef[0];
      const amountDiff = abs - rem.amount;
      if (amountsMatch(abs, rem.amount)) {
        return {
          ...base,
          status: "matched",
          matchedType: "remittance",
          matchedId: rem.id,
          confidence: 0.96,
          amountDiff,
          reasons: ["invoice/remittance reference match", "amount match"],
        };
      }
      return {
        ...base,
        status: "partial",
        matchedType: "remittance",
        matchedId: rem.id,
        confidence: 0.65,
        amountDiff,
        reasons: [
          "invoice/remittance reference match",
          `amount differs by ${formatCentsPlain(amountDiff)} ${txn.currency}`,
        ],
      };
    }
    if (remByRef.length > 1) {
      const amountHits = remByRef.filter((rem) => amountsMatch(abs, rem.amount));
      if (amountHits.length === 1) {
        const rem = amountHits[0];
        return {
          ...base,
          status: "matched",
          matchedType: "remittance",
          matchedId: rem.id,
          confidence: 0.9,
          amountDiff: abs - rem.amount,
          reasons: ["invoice/remittance reference match", "unique amount among refs"],
        };
      }
    }

    // 4) Unique remittance amount in a date window (same currency + direction).
    const remWindow = remittances.filter(
      (rem) =>
        rem.party === remParty &&
        rem.currency === txn.currency &&
        amountsMatch(abs, rem.amount) &&
        daysBetween(rem.date, txn.date) <= DATE_WINDOW_DAYS,
    );
    if (remWindow.length === 1) {
      const rem = remWindow[0];
      return {
        ...base,
        status: "matched",
        matchedType: "remittance",
        matchedId: rem.id,
        confidence: 0.8,
        amountDiff: abs - rem.amount,
        reasons: ["unique remittance amount in date window"],
      };
    }

    const remNamed = remWindow.filter((rem) =>
      namesLooselyMatch(rem.name, txn.counterparty ?? txn.bankReference ?? txn.narrative),
    );
    if (remNamed.length === 1) {
      const rem = remNamed[0];
      return {
        ...base,
        status: "matched",
        matchedType: "remittance",
        matchedId: rem.id,
        confidence: 0.85,
        amountDiff: abs - rem.amount,
        reasons: ["counterparty name match", "amount match"],
      };
    }

    // 5) Amount-based fallback (unique amount + currency match on SO/PO).
    const amountMatches = candidates.filter(
      (doc) => doc.currency === txn.currency && amountsMatch(abs, doc.amount),
    );
    if (amountMatches.length === 1) {
      const doc = amountMatches[0];
      return {
        ...base,
        status: "matched",
        matchedType,
        matchedId: doc.id,
        confidence: 0.7,
        amountDiff: abs - doc.amount,
        reasons: ["unique amount match (no reference)"],
      };
    }
    if (amountMatches.length > 1) {
      return {
        ...base,
        status: "partial",
        confidence: 0.3,
        amountDiff: 0,
        reasons: [`ambiguous: ${amountMatches.length} documents share this amount`],
      };
    }

    return {
      ...base,
      reasons: tokens.length
        ? [`reference(s) ${tokens.slice(0, 6).join(", ")} not found in ${matchedType}/remittance records`]
        : ["no reference and no amount match"],
    };
  });
}

export function summarize(results: ReconciliationResult[]): ReconciliationSummary {
  const total = results.length;
  const matched = results.filter((r) => r.status === "matched").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const unmatched = results.filter((r) => r.status === "unmatched").length;

  const totalAbs = results.reduce((s, r) => s + Math.abs(r.amount), 0);
  const reconciledAbs = results
    .filter((r) => r.status !== "unmatched")
    .reduce((s, r) => s + Math.abs(r.amount), 0);

  return {
    total,
    matched,
    partial,
    unmatched,
    matchRate: totalAbs === 0 ? 0 : reconciledAbs / totalAbs,
  };
}
