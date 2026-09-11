import type {
  BankTransaction,
  FlowType,
  MatchLookup,
  MatchPattern,
  MatchStatus,
  ReconciliationResult,
} from "../domain/types";

export const DATE_WINDOW_DAYS = 5;

export const MATCH_PATTERN_LABELS: Record<MatchPattern, string> = {
  so_po_id: "SO/PO id token",
  po_invoice_number: "PO/AP invoice number",
  remittance_invoice_ref: "remittance invoice/payment ref",
  remittance_amount_window: "unique remittance amount ±5d date window",
  remittance_amount_name: "remittance amount ±5d + counterparty name",
  so_po_unique_amount: "unique SO/PO amount",
  exhausted: "no unique match",
};

export interface LookupAttempt {
  pattern: MatchPattern;
  approach: string;
  hits: number;
}

export interface MatchContext {
  txn: BankTransaction;
  flow: FlowType;
  tokens: string[];
  soLoaded: number;
  poLoaded: number;
  remLoaded: number;
  soIdHits: number;
  poInvoiceHits: number;
  remRefHits: number;
  remWindowHits: number;
  remNamedHits: number;
  soPoAmountHits: number;
  attempts: LookupAttempt[];
}

const SOURCE_FIELDS: Array<keyof BankTransaction> = [
  "reference",
  "description",
  "narrative",
  "customerReference",
  "bankReference",
  "counterparty",
];

export function bankSourceFields(txn: BankTransaction): string[] {
  return SOURCE_FIELDS.filter((field) => {
    const value = txn[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function describeSource(txn: BankTransaction, tokens: string[]): string {
  const fields = bankSourceFields(txn);
  const fieldList = fields.length ? fields.join(", ") : "bank text";
  if (tokens.length) {
    return `tokens ${tokens.slice(0, 8).join(", ")} from ${fieldList}`;
  }
  return `bank amount + date (no invoice token in ${fieldList})`;
}

export function describeTarget(ctx: MatchContext): string {
  const ccy = ctx.txn.currency;
  if (ctx.flow === "O2C") {
    return `SO ${ccy} (${ctx.soLoaded} loaded) + remittance customer ${ccy} (${ctx.remLoaded} loaded)`;
  }
  return `PO ${ccy} (${ctx.poLoaded} loaded) + remittance vendor ${ccy} (${ctx.remLoaded} loaded)`;
}

export function foundFlags(
  ctx: MatchContext,
): Pick<MatchLookup, "soFound" | "poFound" | "remittanceFound"> {
  return {
    soFound: ctx.flow === "O2C" && (ctx.soIdHits > 0 || ctx.soPoAmountHits > 0),
    poFound: ctx.flow === "P2P" && (ctx.soIdHits > 0 || ctx.poInvoiceHits > 0 || ctx.soPoAmountHits > 0),
    remittanceFound: ctx.remRefHits > 0 || ctx.remWindowHits > 0,
  };
}

export function formatFound(ctx: MatchContext): string {
  const flags = foundFlags(ctx);
  if (ctx.flow === "O2C") {
    return `SO ${flags.soFound ? "yes" : "no"} · remittance ${flags.remittanceFound ? "yes" : "no"}`;
  }
  return `PO ${flags.poFound ? "yes" : "no"} · remittance ${flags.remittanceFound ? "yes" : "no"}`;
}

export function formatAttempts(attempts: LookupAttempt[]): string {
  if (attempts.length === 0) return "none";
  return attempts
    .map((attempt, index) => `${index + 1}. ${attempt.approach} → ${attempt.hits}`)
    .join(" · ");
}

export function proposeRemediation(
  ctx: MatchContext,
  status: Exclude<MatchStatus, "matched">,
  opts: { pattern: MatchPattern; amountDiffPlain?: string },
): string {
  const tokenBit = ctx.tokens.length
    ? `Bank tokens: ${ctx.tokens.slice(0, 6).join(", ")}.`
    : "No invoice/SO/PO token on the bank line.";
  const diff = opts.amountDiffPlain ? ` by ${opts.amountDiffPlain}` : "";

  if (opts.pattern === "so_po_id" && status === "partial") {
    return ctx.flow === "O2C"
      ? `SO found by id; amount differs${diff}. Treat as partial collection, multi-invoice receipt, or FX. Confirm the remaining open amount on the SO.`
      : `PO found by id; amount differs${diff}. Check partial payment, credit note, or invoice vs payment currency.`;
  }
  if (opts.pattern === "po_invoice_number" && status === "partial") {
    return `PO/AP invoice found; amount differs${diff}. Check partial payment, credit note, or a different invoice on the same supplier.`;
  }
  if (opts.pattern === "remittance_invoice_ref" && status === "partial") {
    return `Remittance found by invoice/payment ref; amount differs${diff}. Check split applications, short-pay, or bank charges on the remittance.`;
  }

  if (ctx.remRefHits > 1) {
    return `${tokenBit} Tokens hit ${ctx.remRefHits} remittances and amount did not isolate one. Add the full invoice set from the bank line, or match on remittance id.`;
  }

  if (ctx.remWindowHits > 1 && ctx.remNamedHits !== 1) {
    return `${tokenBit} Amount ±${DATE_WINDOW_DAYS}d hit ${ctx.remWindowHits} remittances; counterparty name did not isolate one. Put invoice numbers on the bank line, or add a counterparty alias.`;
  }

  if (ctx.soPoAmountHits > 1) {
    const kind = ctx.flow === "O2C" ? "SO" : "PO";
    return `${tokenBit} ${ctx.soPoAmountHits} ${kind}s share this amount (ambiguous). Need an ${kind} token or remittance invoice number on the bank line.`;
  }

  if (
    ctx.tokens.length &&
    ctx.soIdHits === 0 &&
    ctx.poInvoiceHits === 0 &&
    ctx.remRefHits === 0 &&
    ctx.remWindowHits === 0
  ) {
    return `${tokenBit} None of those tokens are on a loaded SO/PO or remittance. Load the UK AR invoice/remittance row that carries them, or map bank customerReference → Oracle invoice.`;
  }

  if (!ctx.tokens.length && ctx.remWindowHits === 0 && ctx.soPoAmountHits === 0) {
    const kind = ctx.flow === "O2C" ? "SO" : "PO";
    return `${tokenBit} No remittance or ${kind} at this amount in the ±${DATE_WINDOW_DAYS}d window. Load the missing remittance, or classify as payroll/tax/internal (non-reconcilable).`;
  }

  if (ctx.tokens.length && ctx.remWindowHits === 0 && ctx.soPoAmountHits === 0) {
    return `${tokenBit} Tokens missed SO/PO/remittance refs, and no amount match in ±${DATE_WINDOW_DAYS}d. Load the missing remittance or widen the extract (UK AR invoices).`;
  }

  return `${tokenBit} Review source against target and prefer adding invoice numbers to the bank line or the remittance extract.`;
}

export function buildMatchFields(
  ctx: MatchContext,
  opts: {
    status: MatchStatus;
    pattern: MatchPattern;
    approach?: string;
    candidateCount: number;
    amountDiffPlain?: string;
  },
): Pick<ReconciliationResult, "matchPattern" | "lookup" | "remediation" | "reasons"> {
  const source = describeSource(ctx.txn, ctx.tokens);
  const target = describeTarget(ctx);
  const approach = opts.approach ?? formatAttempts(ctx.attempts);
  const lookup: MatchLookup = {
    source,
    target,
    approach,
    ...foundFlags(ctx),
    candidateCount: opts.candidateCount,
    tokens: ctx.tokens.slice(0, 8),
  };
  const remediation =
    opts.status === "matched"
      ? undefined
      : proposeRemediation(ctx, opts.status, {
          pattern: opts.pattern,
          amountDiffPlain: opts.amountDiffPlain,
        });

  const reasons = [
    `Pattern: ${MATCH_PATTERN_LABELS[opts.pattern]}`,
    `Source: ${source}`,
    `Target: ${target}`,
    `Lookup: ${approach}`,
    `Found: ${formatFound(ctx)}`,
  ];
  if (remediation) reasons.push(`Next: ${remediation}`);

  return {
    matchPattern: opts.pattern,
    lookup,
    remediation,
    reasons,
  };
}

export function matchedDocLabel(
  matchedType?: ReconciliationResult["matchedType"],
  matchedId?: string,
): string {
  if (!matchedId) return "—";
  if (matchedType === "remittance") return `Remittance ${matchedId}`;
  if (matchedType === "SO") return `SO ${matchedId}`;
  if (matchedType === "PO") return `PO ${matchedId}`;
  return matchedId;
}
