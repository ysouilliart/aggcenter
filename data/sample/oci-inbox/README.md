# Sample statements for OCI auto-ingest

Copy these files into the UK cash org folder in the bucket (or local
`.data/storage` mirror). The org root is `aggCenter/ORG_112 - UK`.

## Bank statements (`BANK_112/`)

### CSV (account id in the path)

The first path segment under `BANK_112/` is the **account id**:

```
aggCenter/ORG_112 - UK/BANK_112/<accountId>/<file>.csv
```

For example, upload the files here to:

```
aggCenter/ORG_112 - UK/BANK_112/ACC-1001/operating-2026-09.csv
aggCenter/ORG_112 - UK/BANK_112/ACC-2001/eur-collections-2026-09.csv
```

`accountId` must match a known account (from the active data source). CSV columns:
`date, description, reference, counterparty, amount, currency`.

### PDF (account identity from the statement header)

HSBC UK statement PDFs go under a bank-code folder, or directly in `BANK_112/`
when the filename contains `HSBC`. The parser is selected from the folder or
filename; the account is created/matched from IBAN / account number in the
PDF header:

```
aggCenter/ORG_112 - UK/BANK_112/UK-HSBC/<file>.pdf
aggCenter/ORG_112 - UK/BANK_112/UK GBP HSBC CURRENT ACC AUG-26.pdf
```

## Reference documents

| Prefix | Contents |
| --- | --- |
| `aggCenter/ORG_112 - UK/INV_112/` | AP invoice header/line CSVs (`INV_Header_112.csv`, `INV_Lines_112.csv`) |
| `aggCenter/ORG_112 - UK/PO_112/` | Purchase order header/line CSVs (`PO_Header_112.csv`, `PO_Lines_112.csv`) |
| `aggCenter/ORG_112 - UK/SO_112/` | Sales order header + charge-component CSVs |
| `aggCenter/ORG_112 - UK/REM_112/` | Remittance CSVs (`remittance_112.csv`) |

Then click **Load from bucket** on Integrations (or `POST /api/reference/ingest`)
to reset cash tables and load one baseline (reference CSVs + a single parse of
each bank file currently in `BANK_112/`). **Sync from bucket** on Statements
(`POST /api/statements/ingest`) also clears previous statement rows first, then
re-parses bank files. That avoids keeping the same HSBC statement twice under
old and new object keys.
