import type {
  BankTransaction,
  FlowType,
  MatchLookup,
  MatchPattern,
  MatchStatus,
  PurchaseOrder,
  ReconciliationResult,
  Remittance,
  SalesOrder,
  SupportingDocRef,
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

/** Shown on the Reconciliation page so users know how a bank line is identified. */
export const MATCH_RULES: { title: string; detail: string }[] = [
  {
    title: "Baseline",
    detail:
      "Each bank-statement line is the payment to identify. SO, PO and remittance files are supporting evidence, not a second baseline.",
  },
  {
    title: "Matched",
    detail:
      "Exactly one supporting document uniquely identifies the line and amounts agree (0.5% tolerance). Lookup order: (1) SO/PO id in bank text, (2) PO/AP invoice or PO number, (3) remittance invoice or remittance number, (4) unique remittance amount within ±5 days, (5) same window plus counterparty name, (6) unique SO/PO amount.",
  },
  {
    title: "SO/PO + remittance",
    detail:
      "If an SO or PO and a remittance both uniquely identify the same bank line with matching amounts, that is a match. Both numbers are shown in Matched to so you can verify source data.",
  },
  {
    title: "Partial",
    detail:
      "A supporting document was found but the amount differs, or several SO/PO/remittance rows share the amount so one row cannot be isolated. Candidate remittance / PO / SO numbers are listed in Matched to.",
  },
  {
    title: "Unmatched",
    detail:
      "No supporting SO, PO or remittance in the loaded files identifies this bank payment.",
  },
];

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
  soDocs: SupportingDocRef[];
  poDocs: SupportingDocRef[];
  remDocs: SupportingDocRef[];
}

export function soSupportingDoc(so: SalesOrder): SupportingDocRef {
  return { kind: "SO", id: so.id, number: so.id, label: `SO ${so.id}` };
}

export function poSupportingDoc(po: PurchaseOrder): SupportingDocRef {
  const poNumber = po.poNumbers?.find((n) => n && n !== po.id);
  const number = poNumber || po.invoiceNumber || po.id;
  const extra =
    po.invoiceNumber && po.invoiceNumber !== number && po.invoiceNumber !== po.id
      ? ` · inv ${po.invoiceNumber}`
      : "";
  const label =
    number !== po.id ? `PO ${number} (${po.id})${extra}` : `PO ${po.id}${extra}`;
  return { kind: "PO", id: po.id, number, label };
}

export function remSupportingDoc(rem: Remittance): SupportingDocRef {
  const number = rem.remittanceNumber || rem.reference || rem.id;
  const invoices = rem.invoiceNumbers?.filter(Boolean).slice(0, 3) ?? [];
  const parts = [`Remittance ${number}`];
  if (number !== rem.id) parts.push(`(${rem.id})`);
  if (invoices.length) parts.push(`inv ${invoices.join(", ")}`);
  return { kind: "remittance", id: rem.id, number, label: parts.join(" ") };
}

export function uniqueSupportingDocs(docs: SupportingDocRef[]): SupportingDocRef[] {
  const seen = new Set<string>();
  const out: SupportingDocRef[] = [];
  for (const doc of docs) {
    const key = `${doc.kind}:${doc.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(doc);
  }
  return out;
}

function isRemittanceUnique(ctx: MatchContext): boolean {
  return ctx.remRefHits === 1 || ctx.remWindowHits === 1 || ctx.remNamedHits === 1;
}

function isCommercialUnique(ctx: MatchContext): boolean {
  return ctx.soIdHits === 1 || ctx.poInvoiceHits === 1 || ctx.soPoAmountHits === 1;
}

/**
 * Winner first, then corroborating remittance / SO / PO numbers so Matched to
 * can verify "remittance found" / "PO found" / "SO found". Amount-sharing SO/PO
 * rows are not dumped onto a unique remittance match; remittance numbers are
 * reserved slots so they are not crowded out by many SO/PO candidates.
 */
export function supportingDocsForResult(
  ctx: MatchContext,
  matchedType?: ReconciliationResult["matchedType"],
  matchedId?: string,
): SupportingDocRef[] {
  const commercial = uniqueSupportingDocs(
    ctx.flow === "O2C" ? ctx.soDocs : ctx.poDocs,
  );
  const rems = uniqueSupportingDocs(ctx.remDocs);
  const remUnique = isRemittanceUnique(ctx);
  const commercialUnique = isCommercialUnique(ctx);

  const pickCommercial = (limit: number) =>
    (commercialUnique ? commercial.slice(0, 1) : commercial).slice(0, limit);
  const pickRems = (limit: number) =>
    (remUnique ? rems.slice(0, 1) : rems).slice(0, limit);

  const all = uniqueSupportingDocs([...commercial, ...rems]);
  if (!matchedId) {
    return uniqueSupportingDocs([...pickRems(4), ...pickCommercial(4)]).slice(
      0,
      8,
    );
  }

  const winner =
    all.find((d) => d.kind === matchedType && d.id === matchedId) ??
    all.find((d) => d.id === matchedId);

  const ordered: SupportingDocRef[] = [];
  if (winner) ordered.push(winner);

  if (matchedType === "remittance") {
    if (commercialUnique) ordered.push(...commercial.slice(0, 1));
    else if (ctx.soIdHits > 0 || ctx.poInvoiceHits > 0) {
      ordered.push(...commercial.slice(0, 3));
    }
  } else {
    ordered.push(...pickRems(4));
  }

  return uniqueSupportingDocs(ordered).slice(0, 8);
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
    matchedType?: ReconciliationResult["matchedType"];
    matchedId?: string;
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
    supportingDocs: supportingDocsForResult(ctx, opts.matchedType, opts.matchedId),
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

export function matchedToDocs(result: ReconciliationResult): SupportingDocRef[] {
  const docs = result.lookup?.supportingDocs ?? [];
  if (docs.length) return docs;
  if (!result.matchedId) return [];
  return [
    {
      kind: result.matchedType ?? "SO",
      id: result.matchedId,
      number: result.matchedId,
      label: matchedDocLabel(result.matchedType, result.matchedId),
    },
  ];
}
