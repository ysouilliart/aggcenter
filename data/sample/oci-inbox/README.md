# Sample statements for OCI auto-ingest

Drop these into your OCI bucket to test the ingest flow. The folder layout is
significant — the first path segment under `inbox/` is the **account id**:

```
inbox/<accountId>/<file>.csv
```

For example, upload the files here to:

```
inbox/ACC-1001/operating-2026-09.csv
inbox/ACC-2001/eur-collections-2026-09.csv
```

Then click **Sync from bucket** on the Statements page (or `POST /api/statements/ingest`).
Ingestion is idempotent: re-syncing skips files already imported (keyed by object
path), so you can drop more files and sync again safely.

`accountId` must match a known account (from the active data source). CSV columns:
`date, description, reference, counterparty, amount, currency`.
