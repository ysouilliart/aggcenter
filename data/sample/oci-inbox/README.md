# Sample statements for OCI auto-ingest

Copy these files into the UK cash org folder in the bucket (or local
`.data/storage` mirror). The org root is `aggCenter/ORG_112 - UK`.

## Bank statements (`bank/`)

### CSV (account id in the path)

The first path segment under `bank/` is the **account id**:

```
aggCenter/ORG_112 - UK/bank/<accountId>/<file>.csv
```

For example, upload the files here to:

```
aggCenter/ORG_112 - UK/bank/ACC-1001/operating-2026-09.csv
aggCenter/ORG_112 - UK/bank/ACC-2001/eur-collections-2026-09.csv
```

`accountId` must match a known account (from the active data source). CSV columns:
`date, description, reference, counterparty, amount, currency`.

### PDF (account identity from the statement header)

HSBC UK statement PDFs go under a bank-code folder. The parser is selected from
that folder; the account is created/matched from IBAN / account number in the
PDF header:

```
aggCenter/ORG_112 - UK/bank/UK-HSBC/<file>.pdf
```

## Reference documents

| Prefix | Contents |
| --- | --- |
| `aggCenter/ORG_112 - UK/inv/` | AP invoice header/line CSVs |
| `aggCenter/ORG_112 - UK/po/` | Purchase order header/line CSVs |
| `aggCenter/ORG_112 - UK/so/` | Sales order header + charge-component CSVs |
| `aggCenter/ORG_112 - UK/rem/` | Remittance CSVs |

Then click **Sync from bucket** on the Statements page (or `POST /api/statements/ingest`)
for bank files, and **Load from bucket** on Integrations (or
`POST /api/reference/ingest`) for reference docs. Ingestion is idempotent for
statements: re-syncing skips files already imported (keyed by object path), so
you can drop more files and sync again safely.
