import { PDFDocument, StandardFonts } from "pdf-lib";

/** Landscape A4, matching HSBC "Statement details" exports. */
const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;

const COLS = [
  { label: "Bank reference", x: 31.2 },
  { label: "Customer reference", x: 129.2 },
  { label: "TRN type", x: 227.2 },
  { label: "Value date", x: 325.2 },
  { label: "Credit amount", x: 423.2 },
  { label: "Debit amount", x: 521.2 },
  { label: "Balance", x: 619.2 },
  { label: "Post date", x: 717.2 },
] as const;

export interface FixtureTxn {
  bankReference: string;
  bankReferenceWrap?: string;
  customerReference: string;
  trnType: string;
  valueDate: string;
  postDate: string;
  credit?: string;
  debit?: string;
  balance: string;
  narrative: string;
  narrativeWrap?: string;
  overlay?: string;
}

export interface HsbcFixtureSpec {
  accountName?: string;
  accountNumber?: string;
  bankName?: string;
  currency?: string;
  location?: string;
  bic?: string;
  iban?: string;
  accountStatus?: string;
  accountType?: string;
  dateRange?: string;
  asAt?: string;
  from?: string;
  currentAvailable?: string;
  currentLedger?: string;
  closingAvailable?: string;
  closingLedger?: string;
  page2Narrative?: string;
  transactions: FixtureTxn[];
}

const DEFAULTS: Required<Omit<HsbcFixtureSpec, "transactions" | "page2Narrative">> & {
  page2Narrative?: string;
} = {
  accountName: "ACME HOLDINGS LTD",
  accountNumber: "123456-00000001",
  bankName: "HSBC UK Bank PLC",
  currency: "GBP",
  location: "United Kingdom",
  bic: "HBUKGB4B",
  iban: "GB00HBUK12345600000001",
  accountStatus: "Active",
  accountType: "Current account",
  dateRange: "01 Aug 2026 to 31 Aug 2026",
  asAt: "01 Sep 2026 10:31",
  from: "31 Aug 2026",
  currentAvailable: "1,150.00",
  currentLedger: "1,150.00",
  closingAvailable: "1,000.00",
  closingLedger: "1,000.00",
};

/**
 * Build a small HSBC-like statement PDF for tests (fictional counterparties).
 * Layout mirrors the production export: landscape, column headers, overlay noise.
 */
export async function buildHsbcFixturePdf(
  spec: HsbcFixtureSpec = { transactions: defaultTransactions() },
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 8;
  const merged = { ...DEFAULTS, ...spec };
  const txns = spec.transactions.length ? spec.transactions : defaultTransactions();

  const page1 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const draw = (page: typeof page1, text: string, x: number, y: number) => {
    page.drawText(text, { x, y, size, font });
  };

  draw(page1, "|", 114, 552);
  draw(page1, "Statement details", 128.4, 551);

  draw(page1, "Account name", 34, 521);
  draw(page1, merged.accountName, 139.2, 521);
  draw(page1, "Closing ledger balance brought forward", 416.1, 521);
  draw(page1, merged.closingLedger, 750.5, 521);

  draw(page1, "Account number", 34, 507);
  draw(page1, merged.accountNumber, 139.2, 507);
  draw(page1, "From", 416.1, 507);
  draw(page1, merged.from, 444.9, 507);

  draw(page1, "Bank name", 34, 492);
  draw(page1, merged.bankName, 139.2, 492);

  // Amount sits ~0.5pt above the label, as in the live HSBC export.
  draw(page1, merged.closingAvailable, 750.5, 489);
  draw(page1, "Closing available balance brought forward", 416.1, 488.5);

  draw(page1, "Currency", 34, 478);
  draw(page1, merged.currency, 139.2, 478);
  draw(page1, "From", 416.1, 474);
  draw(page1, merged.from, 444.9, 474);

  draw(page1, "Location", 34, 464);
  draw(page1, merged.location, 139.2, 464);

  draw(page1, "Current ledger balance", 416.1, 455);
  draw(page1, merged.currentLedger, 750.5, 455);

  draw(page1, "BIC", 34, 449);
  draw(page1, merged.bic, 139.2, 449);

  draw(page1, "As at", 416.1, 440);
  draw(page1, merged.asAt, 444.9, 440);

  draw(page1, "IBAN", 34, 435);
  draw(page1, merged.iban, 139.2, 435);

  draw(page1, "Current available balance", 416.1, 422);
  draw(page1, merged.currentAvailable, 750.5, 422);

  draw(page1, "Account status", 34, 420);
  draw(page1, merged.accountStatus, 139.2, 420);

  draw(page1, "As at", 416.1, 408);
  draw(page1, merged.asAt, 444.9, 408);

  draw(page1, "Account type", 34, 406);
  draw(page1, merged.accountType, 139.2, 406);

  draw(page1, "Specified date range", 416.1, 390);
  draw(page1, merged.dateRange, 697.4, 390);

  const drawColumns = (page: typeof page1, y: number) => {
    for (const col of COLS) draw(page, col.label, col.x, y);
  };

  drawColumns(page1, 354);

  const drawTxn = (
    page: typeof page1,
    txn: FixtureTxn,
    y: number,
  ): number => {
    draw(page, txn.bankReference, 31.2, y);
    draw(page, txn.customerReference, 129.2, y);
    draw(page, txn.trnType, 227.2, y);
    draw(page, txn.valueDate, 325.2, y);
    if (txn.credit) draw(page, txn.credit, 484.2, y);
    if (txn.debit) draw(page, txn.debit, 579.4, y);
    draw(page, txn.balance, 670, y);
    draw(page, txn.postDate, 717.2, y);

    if (txn.overlay) {
      for (const col of COLS) draw(page, txn.overlay, col.x, y - 1);
    }
    if (txn.bankReferenceWrap) {
      draw(page, txn.bankReferenceWrap, 31.2, y - 12);
    }
    draw(page, "Narrative", 31.9, y - 28);
    draw(page, txn.narrative, 81.6, y - 27);
    if (txn.narrativeWrap) {
      draw(page, txn.narrativeWrap, 81.6, y - 38);
    }
    return y - 55;
  };

  let y = 333;
  // Last txn's extra wrap can overflow onto page 2 when requested.
  const overflow = merged.page2Narrative;
  const onPage1 = overflow ? txns.slice(0, -1) : txns;
  const last = overflow ? txns[txns.length - 1] : undefined;

  for (const txn of onPage1) {
    y = drawTxn(page1, txn, y);
  }
  if (last) {
    y = drawTxn(page1, { ...last, narrativeWrap: undefined }, y);
  }

  draw(
    page1,
    "01 Sep 2026 | Account number " + merged.accountNumber,
    31.2,
    32.5,
  );
  draw(page1, "Page", 742.9, 32.5);
  draw(page1, "1", 766.3, 32.5);
  draw(page1, "of", 779.2, 32.5);
  draw(page1, overflow ? "2" : "1", 793.6, 32.5);

  if (overflow && last) {
    const page2 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    draw(page2, "|", 114, 552);
    draw(page2, "Statement details", 128.4, 551);
    drawColumns(page2, 520);
    draw(page2, overflow, 81.6, 498);
    draw(page2, "Narrative", 31.9, 497);
    draw(
      page2,
      "01 Sep 2026 | Account number " + merged.accountNumber,
      31.2,
      32.5,
    );
    draw(page2, "Page", 742.9, 32.5);
    draw(page2, "2", 766.3, 32.5);
    draw(page2, "of", 779.2, 32.5);
    draw(page2, "2", 793.6, 32.5);
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

export function defaultTransactions(): FixtureTxn[] {
  return [
    {
      bankReference: "06709260106215ASAH942",
      bankReferenceWrap: "0260828826402080",
      customerReference: "2000838228",
      trnType: "FBP",
      valueDate: "28 Aug 2026",
      postDate: "28 Aug 2026",
      credit: "100.00",
      balance: "1,000.00",
      narrative:
        "INTUS HEALTHCARE L, /DbAcct/40208070128732, /ROC/2000838228, /FPID/06709260106215ASAH9420260828826402080",
      overlay: "0802046288280620249HA",
    },
    {
      bankReference: "RBC28086IVLYUUIO",
      customerReference: "ADVICE CONFIRMS",
      trnType: "Tt",
      valueDate: "28 Aug 2026",
      postDate: "28 Aug 2026",
      credit: "175.00",
      balance: "900.00",
      narrative: "/REMI//ROC/10056879539YK1 /INS/CITIUS33XXX /ORDP/ACME PARENT INC",
      narrativeWrap: "SPECTRUM CENT, ER BOULEVARD SAN DIEGO CA/OBK/CITIUS33XXX",
    },
    {
      bankReference: "RBH28086IVM035KW",
      customerReference: "VAT TRANSFER",
      trnType: "Tt",
      valueDate: "28 Aug 2026",
      postDate: "28 Aug 2026",
      debit: "-50.00",
      balance: "725.00",
      narrative: "/REMI/VAT TRANSFER /DAS/REF:45697IZ012UH/OCMT/EUR368",
    },
  ];
}
