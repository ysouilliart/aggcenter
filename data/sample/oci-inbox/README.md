# Sample statements for OCI auto-ingest

## CSV (account id in the path)

The first path segment under `inbox/` is the **account id**:

```
inbox/<accountId>/<file>.csv
```

For example, upload the files here to:

```
inbox/ACC-1001/operating-2026-09.csv
inbox/ACC-2001/eur-collections-2026-09.csv
```

`accountId` must match a known account (from the active data source). CSV columns:
`date, description, reference, counterparty, amount, currency`.

## PDF (account identity from the statement header)

HSBC UK statement PDFs go under a bank-code folder. The parser is selected from
that folder; the account is created/matched from IBAN / account number in the
PDF header:

```
aggCenter/bankStatements/UK-HSBC/<file>.pdf
```

Then click **Sync from bucket** on the Statements page (or `POST /api/statements/ingest`).
Ingestion is idempotent: re-syncing skips files already imported (keyed by object
path), so you can drop more files and sync again safely.
