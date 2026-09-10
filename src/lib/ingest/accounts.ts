import type { BankAccount, StatementHeader } from "../domain/types";
import type { StatementRepository } from "../statements";

const UNATTRIBUTED: BankAccount = {
  id: "UNATTRIBUTED",
  name: "Unattributed",
  bank: "Unknown",
  currency: "GBP",
  openingBalance: 0,
};

function compact(value: string | undefined): string {
  return (value ?? "").replace(/[\s-]/g, "").toUpperCase();
}

export function accountIdFromHeader(
  header: StatementHeader,
  bankCode = "UK-HSBC",
): string | undefined {
  const accountNumber = (header.accountNumber ?? "").replace(/\s+/g, "");
  if (accountNumber) return `${bankCode}-${accountNumber}`;
  return undefined;
}

export function matchAccount(
  accounts: BankAccount[],
  header: StatementHeader,
): BankAccount | undefined {
  const iban = compact(header.iban);
  const accountNumber = compact(header.accountNumber);
  const generatedId = accountIdFromHeader(header);

  return accounts.find((account) => {
    if (iban && compact(account.iban) === iban) return true;
    if (accountNumber && compact(account.accountNumber) === accountNumber) {
      return true;
    }
    if (generatedId && account.id === generatedId) return true;
    return false;
  });
}

export function accountFromHeader(
  header: StatementHeader,
  bankCode = "UK-HSBC",
): BankAccount | undefined {
  const id = accountIdFromHeader(header, bankCode);
  if (!id) return undefined;
  return {
    id,
    name: header.accountName || header.accountNumber || "Bank account",
    bank: header.bankName || (bankCode === "UK-HSBC" ? "HSBC UK Bank PLC" : bankCode),
    currency: header.currency || "GBP",
    openingBalance: header.closingLedgerBroughtForward ?? 0,
    iban: header.iban,
    accountNumber: header.accountNumber,
    bic: header.bic,
  };
}

function enrichAccount(account: BankAccount, header: StatementHeader): BankAccount {
  return {
    ...account,
    name: account.name || header.accountName || account.name,
    bank: account.bank || header.bankName || account.bank,
    currency: account.currency || header.currency || account.currency,
    iban: account.iban || header.iban,
    accountNumber: account.accountNumber || header.accountNumber,
    bic: account.bic || header.bic,
  };
}

export async function resolveAccountFromHeader(options: {
  header: StatementHeader;
  bankCode?: string;
  seed: BankAccount[];
  repo: StatementRepository;
}): Promise<{ account: BankAccount; created: boolean }> {
  const bankCode = options.bankCode ?? "UK-HSBC";
  const persisted = await options.repo.listAccounts();
  const matched = matchAccount([...options.seed, ...persisted], options.header);

  if (matched) {
    const fromSeed = options.seed.some((a) => a.id === matched.id);
    if (fromSeed) return { account: matched, created: false };
    const enriched = enrichAccount(matched, options.header);
    await options.repo.upsertAccount(enriched);
    return { account: enriched, created: false };
  }

  const created = accountFromHeader(options.header, bankCode);
  if (!created) return { account: UNATTRIBUTED, created: false };
  await options.repo.upsertAccount(created);
  return { account: created, created: true };
}
