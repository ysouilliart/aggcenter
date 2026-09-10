import type {
  BankTransaction,
  FlowType,
  PurchaseOrder,
  ReconciliationResult,
  SalesOrder,
} from "../domain/types";
import { formatCentsPlain } from "../money";

export interface ReconcileInput {
  transactions: BankTransaction[];
  salesOrders: SalesOrder[];
  purchaseOrders: PurchaseOrder[];
}

export interface ReconciliationSummary {
  total: number;
  matched: number;
  partial: number;
  unmatched: number;
  /** Absolute value reconciled (matched + partial) vs total, 0..1. */
  matchRate: number;
}

const REF_PATTERN = /\b(SO|PO)-\d+\b/gi;

function extractRefs(txn: BankTransaction): string[] {
  const haystack = `${txn.reference ?? ""} ${txn.description ?? ""} ${txn.narrative ?? ""}`;
  const found = haystack.match(REF_PATTERN) ?? [];
  return found.map((r) => r.toUpperCase());
}

// Amounts are integer cents. Tolerance is the greater of 1 cent or 0.5%.
function amountsMatch(a: number, b: number): boolean {
  const tolerance = Math.max(1, Math.round(Math.abs(b) * 0.005));
  return Math.abs(a - b) <= tolerance;
}

/**
 * Reconcile bank transactions against the expected side of each flow:
 *   - credits (inflows) are matched to Sales Orders (Order to Cash)
 *   - debits (outflows) are matched to Purchase Orders (Procure to Pay)
 *
 * Matching prefers an explicit SO/PO reference, then falls back to a unique
 * amount+currency match. Each result carries a confidence score and the reasons
 * behind the decision.
 */
export function reconcile(input: ReconcileInput): ReconciliationResult[] {
  const { transactions, salesOrders, purchaseOrders } = input;

  const soById = new Map(salesOrders.map((so) => [so.id, so]));
  const poById = new Map(purchaseOrders.map((po) => [po.id, po]));

  return transactions.map((txn) => {
    const flow: FlowType = txn.amount >= 0 ? "O2C" : "P2P";
    const abs = Math.abs(txn.amount);
    const matchedType = flow === "O2C" ? "SO" : "PO";
    const candidates = flow === "O2C" ? salesOrders : purchaseOrders;
    const byId = flow === "O2C" ? soById : poById;

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

    // 1) Reference-based match.
    const refs = extractRefs(txn);
    for (const ref of refs) {
      const doc = byId.get(ref);
      if (doc && doc.currency === txn.currency) {
        const docAmount = doc.amount;
        const amountDiff = abs - docAmount;
        if (amountsMatch(abs, docAmount)) {
          return {
            ...base,
            status: "matched",
            matchedType,
            matchedId: ref,
            confidence: 0.99,
            amountDiff,
            reasons: ["reference match", "amount match"],
          };
        }
        return {
          ...base,
          status: "partial",
          matchedType,
          matchedId: ref,
          confidence: 0.6,
          amountDiff,
          reasons: [
            "reference match",
            `amount differs by ${formatCentsPlain(amountDiff)} ${txn.currency}`,
          ],
        };
      }
    }

    // 2) Amount-based fallback (unique amount + currency match).
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
      reasons: refs.length
        ? [`reference(s) ${refs.join(", ")} not found in ${matchedType} records`]
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
