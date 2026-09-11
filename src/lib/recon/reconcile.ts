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
import {
  DATE_WINDOW_DAYS,
  buildMatchFields,
  type MatchContext,
} from "./match-notes";

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

function newContext(
  txn: BankTransaction,
  flow: FlowType,
  tokens: string[],
  soLoaded: number,
  poLoaded: number,
  remLoaded: number,
): MatchContext {
  return {
    txn,
    flow,
    tokens,
    soLoaded,
    poLoaded,
    remLoaded,
    soIdHits: 0,
    poInvoiceHits: 0,
    remRefHits: 0,
    remWindowHits: 0,
    remNamedHits: 0,
    soPoAmountHits: 0,
    attempts: [],
  };
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
    const remParty = flow === "O2C" ? "customer" : "vendor";
    const soPool = salesOrders.filter((so) => so.currency === txn.currency);
    const poPool = purchaseOrders.filter((po) => po.currency === txn.currency);
    const remPool = remittances.filter(
      (rem) => rem.party === remParty && rem.currency === txn.currency,
    );
    const ctx = newContext(
      txn,
      flow,
      tokens,
      soPool.length,
      poPool.length,
      remPool.length,
    );

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

    const finish = (
      result: Omit<ReconciliationResult, "reasons" | "matchPattern" | "lookup" | "remediation"> & {
        status: ReconciliationResult["status"];
      },
      notes: Parameters<typeof buildMatchFields>[1],
    ): ReconciliationResult => ({
      ...result,
      ...buildMatchFields(ctx, notes),
    });

    // 1) Classic SO/PO id in the bank text.
    const idHits = tokens
      .map((ref) => byId.get(ref))
      .filter((doc): doc is SalesOrder | PurchaseOrder => Boolean(doc && doc.currency === txn.currency));
    ctx.soIdHits = idHits.length;
    ctx.attempts.push({
      pattern: "so_po_id",
      approach: `${matchedType} id token`,
      hits: idHits.length,
    });
    if (idHits.length === 1) {
      const doc = idHits[0];
      const amountDiff = abs - doc.amount;
      if (amountsMatch(abs, doc.amount)) {
        return finish(
          {
            ...base,
            status: "matched",
            matchedType,
            matchedId: doc.id,
            confidence: 0.99,
            amountDiff,
          },
          {
            status: "matched",
            pattern: "so_po_id",
            approach: `${matchedType} id token → 1 (amount match)`,
            candidateCount: 1,
          },
        );
      }
      return finish(
        {
          ...base,
          status: "partial",
          matchedType,
          matchedId: doc.id,
          confidence: 0.6,
          amountDiff,
        },
        {
          status: "partial",
          pattern: "so_po_id",
          approach: `${matchedType} id token → 1 (amount differs)`,
          candidateCount: 1,
          amountDiffPlain: `${formatCentsPlain(amountDiff)} ${txn.currency}`,
        },
      );
    }

    // 2) AP invoice / PO number on a purchase-order row.
    if (flow === "P2P") {
      const byInvoice = poPool.filter((po) => poRefs(po).some((ref) => tokens.includes(ref)));
      ctx.poInvoiceHits = byInvoice.length;
      ctx.attempts.push({
        pattern: "po_invoice_number",
        approach: "PO/AP invoice or PO number",
        hits: byInvoice.length,
      });
      if (byInvoice.length === 1) {
        const doc = byInvoice[0];
        const amountDiff = abs - doc.amount;
        if (amountsMatch(abs, doc.amount)) {
          return finish(
            {
              ...base,
              status: "matched",
              matchedType: "PO",
              matchedId: doc.id,
              confidence: 0.95,
              amountDiff,
            },
            {
              status: "matched",
              pattern: "po_invoice_number",
              approach: "PO/AP invoice or PO number → 1 (amount match)",
              candidateCount: 1,
            },
          );
        }
        return finish(
          {
            ...base,
            status: "partial",
            matchedType: "PO",
            matchedId: doc.id,
            confidence: 0.6,
            amountDiff,
          },
          {
            status: "partial",
            pattern: "po_invoice_number",
            approach: "PO/AP invoice or PO number → 1 (amount differs)",
            candidateCount: 1,
            amountDiffPlain: `${formatCentsPlain(amountDiff)} ${txn.currency}`,
          },
        );
      }
    }

    // 3) Remittance invoice / payment reference.
    const remByRef = remPool.filter((rem) =>
      remittanceRefs(rem).some((ref) => tokens.includes(ref)),
    );
    ctx.remRefHits = remByRef.length;
    ctx.attempts.push({
      pattern: "remittance_invoice_ref",
      approach: "remittance invoice/payment ref",
      hits: remByRef.length,
    });
    if (remByRef.length === 1) {
      const rem = remByRef[0];
      const amountDiff = abs - rem.amount;
      if (amountsMatch(abs, rem.amount)) {
        return finish(
          {
            ...base,
            status: "matched",
            matchedType: "remittance",
            matchedId: rem.id,
            confidence: 0.96,
            amountDiff,
          },
          {
            status: "matched",
            pattern: "remittance_invoice_ref",
            approach: "remittance invoice/payment ref → 1 (amount match)",
            candidateCount: 1,
          },
        );
      }
      return finish(
        {
          ...base,
          status: "partial",
          matchedType: "remittance",
          matchedId: rem.id,
          confidence: 0.65,
          amountDiff,
        },
        {
          status: "partial",
          pattern: "remittance_invoice_ref",
          approach: "remittance invoice/payment ref → 1 (amount differs)",
          candidateCount: 1,
          amountDiffPlain: `${formatCentsPlain(amountDiff)} ${txn.currency}`,
        },
      );
    }
    if (remByRef.length > 1) {
      const amountHits = remByRef.filter((rem) => amountsMatch(abs, rem.amount));
      if (amountHits.length === 1) {
        const rem = amountHits[0];
        return finish(
          {
            ...base,
            status: "matched",
            matchedType: "remittance",
            matchedId: rem.id,
            confidence: 0.9,
            amountDiff: abs - rem.amount,
          },
          {
            status: "matched",
            pattern: "remittance_invoice_ref",
            approach: `remittance invoice/payment ref → ${remByRef.length}, unique amount among refs`,
            candidateCount: 1,
          },
        );
      }
    }

    // 4) Unique remittance amount in a date window (same currency + direction).
    const remWindow = remPool.filter(
      (rem) =>
        amountsMatch(abs, rem.amount) && daysBetween(rem.date, txn.date) <= DATE_WINDOW_DAYS,
    );
    ctx.remWindowHits = remWindow.length;
    ctx.attempts.push({
      pattern: "remittance_amount_window",
      approach: `remittance amount ±${DATE_WINDOW_DAYS}d`,
      hits: remWindow.length,
    });
    if (remWindow.length === 1) {
      const rem = remWindow[0];
      return finish(
        {
          ...base,
          status: "matched",
          matchedType: "remittance",
          matchedId: rem.id,
          confidence: 0.8,
          amountDiff: abs - rem.amount,
        },
        {
          status: "matched",
          pattern: "remittance_amount_window",
          approach: `remittance amount ±${DATE_WINDOW_DAYS}d → 1 unique`,
          candidateCount: 1,
        },
      );
    }

    const remNamed = remWindow.filter((rem) =>
      namesLooselyMatch(rem.name, txn.counterparty ?? txn.bankReference ?? txn.narrative),
    );
    ctx.remNamedHits = remNamed.length;
    ctx.attempts.push({
      pattern: "remittance_amount_name",
      approach: "remittance amount ±5d + counterparty name",
      hits: remNamed.length,
    });
    if (remNamed.length === 1) {
      const rem = remNamed[0];
      return finish(
        {
          ...base,
          status: "matched",
          matchedType: "remittance",
          matchedId: rem.id,
          confidence: 0.85,
          amountDiff: abs - rem.amount,
        },
        {
          status: "matched",
          pattern: "remittance_amount_name",
          approach: "remittance amount ±5d + counterparty name → 1",
          candidateCount: 1,
        },
      );
    }

    // 5) Amount-based fallback (unique amount + currency match on SO/PO).
    const amountMatches = candidates.filter(
      (doc) => doc.currency === txn.currency && amountsMatch(abs, doc.amount),
    );
    ctx.soPoAmountHits = amountMatches.length;
    ctx.attempts.push({
      pattern: "so_po_unique_amount",
      approach: `${matchedType} unique amount`,
      hits: amountMatches.length,
    });
    if (amountMatches.length === 1) {
      const doc = amountMatches[0];
      return finish(
        {
          ...base,
          status: "matched",
          matchedType,
          matchedId: doc.id,
          confidence: 0.7,
          amountDiff: abs - doc.amount,
        },
        {
          status: "matched",
          pattern: "so_po_unique_amount",
          approach: `${matchedType} unique amount → 1 (no reference)`,
          candidateCount: 1,
        },
      );
    }
    if (amountMatches.length > 1) {
      return finish(
        {
          ...base,
          status: "partial",
          confidence: 0.3,
          amountDiff: 0,
        },
        {
          status: "partial",
          pattern: "exhausted",
          candidateCount: amountMatches.length,
        },
      );
    }

    return finish(
      {
        ...base,
        status: "unmatched",
      },
      {
        status: "unmatched",
        pattern: "exhausted",
        candidateCount: 0,
      },
    );
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
