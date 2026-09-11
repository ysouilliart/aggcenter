# aggcenter

**Aggregation Center** — an operations aggregator for improving business
efficiency across typical operational processes. The first vertical is
**Cash Position** for the classic *Order-to-Cash* (O2C) and *Procure-to-Pay*
(P2P) flows: consume bank statements, reconcile them against sales orders,
purchase orders and remittances, and surface a cash-position dashboard plus an
anomalies report.

Built with **Next.js (App Router) + React + TypeScript** and **Tailwind CSS**.

## Features

- **Cash Position dashboard** — opening/closing balances, inflows (O2C) vs
  outflows (P2P), running-balance trend and per-account breakdown, multi-currency.
- **Reconciliation** — bank transactions matched to SO/PO by reference and
  amount, with confidence scores and matched / partial / unmatched status.
- **Anomalies** — duplicate payments, amount mismatches, large unmatched items,
  missing customer receipts, statistical outliers and overdraft risk.
- **Statements** — upload bank-statement CSVs; they are stored via the active
  file provider and fed straight into the pipeline alongside bundled samples.
- **Supplier workspace** — separate from cash. Ingest OCI `supplier/` extracts
  (profile, site, address, VAT ID), surface missing attributes, VAT-format and
  address issues, plus rationalisation of payment terms / group / type. Edit a
  record in place; each save writes a new version and an audit event in
  `aggc-supplier`.
- **Integrations** — pluggable adapters for **OCI Object Storage** (files),
  **Snowflake** (reference data) and an optional external API, all defaulting to
  safe local/sample implementations.

## Architecture

```
src/
  app/                 # App Router pages + API route handlers
    api/               #   /api/cash-position, /reconciliation, /anomalies, /statements, /suppliers, ...
    suppliers/         #   Supplier workspace (overview, records, audit)
  components/          # AppShell (Cash / Suppliers workspaces), UI primitives, SVG charts
  lib/
    domain/            # shared types
    parse/             # CSV + bank-statement parsing
    recon/             # reconciliation engine
    cash/              # cash-position calculator
    anomalies/         # cash anomaly detection
    suppliers/         # supplier ingest, VAT/address checks, versions + audit
    storage/           # StorageProvider: local (default) + OCI adapter
    datasource/        # DataSource: local sample (default) + Snowflake adapter
    service.ts         # ties data loading, uploads and computations together
    config.ts          # env-driven configuration
data/sample/           # sample accounts, SOs, POs, remittances, statements, suppliers
tests/                 # vitest unit tests
```

Integrations are chosen at runtime from environment variables (see
`.env.example`). With no configuration the app runs fully on bundled sample data
and local file storage; set the documented `OCI_*` / `SNOWFLAKE_*` variables
(ideally via Cursor Secrets) to switch providers.

## Getting started

Requires Node.js 20+.

```bash
npm ci          # install dependencies
npm run dev     # start the dev server on http://localhost:3000
```

Other scripts:

```bash
npm test         # run unit tests (vitest)
npm run typecheck
npm run lint
npm run build    # production build
```

## API

| Method | Path                  | Description                                  |
| ------ | --------------------- | -------------------------------------------- |
| GET    | `/api/health`         | Health check                                 |
| GET    | `/api/cash-position`  | Cash position per currency                   |
| GET    | `/api/reconciliation` | Reconciliation results + summary             |
| GET    | `/api/anomalies`      | Detected anomalies                           |
| GET    | `/api/statements`     | List statements (sample + uploaded)          |
| POST   | `/api/statements`     | Upload a bank-statement CSV (multipart)      |
| GET    | `/api/accounts`       | Bank accounts                                |
| GET    | `/api/integrations`   | Active provider / configuration status       |
| GET    | `/api/suppliers/summary` | Supplier aggregates + issue / distribution counts |
| GET    | `/api/suppliers`      | Site-grained records + issues (filterable)   |
| POST   | `/api/suppliers/ingest` | Import `supplier/` extracts from object storage |
| GET    | `/api/suppliers/:id`  | One record plus its versions and audit       |
| PATCH  | `/api/suppliers/:id`  | Update fields; writes a version + audit row  |
| GET    | `/api/suppliers/audit` | Version snapshots and field-level history  |

## Database (Postgres / Neon)

Uploaded statements and their parsed transactions persist to Postgres via
[Drizzle ORM](https://orm.drizzle.team) when `DATABASE_URL` is set; otherwise a
local JSON store (`.data/uploads.json`) is used so the app runs with no database.
Cash tables live in a dedicated **`aggc-cash`** schema. Supplier working copies,
versions and audit events live in **`aggc-supplier`**.

Setup:

1. Set `DATABASE_URL` (Neon pooled connection string, or a local Postgres URL) —
   as a Cursor **Secret** in the cloud, or in `.env.local` for local dev.
2. Create the schema and tables:
   ```bash
   DATABASE_URL=... npm run db:migrate   # applies drizzle/ migrations (creates the aggc-cash and aggc-supplier schemas)
   ```
3. Run the app; uploads now persist to Postgres. `/api/integrations` reports the
   active database provider (`postgres` vs `local-json`) without exposing the URL.

Schema changes: edit `src/lib/db/schema.ts`, then `npm run db:generate` to create
a new migration and `npm run db:migrate` to apply it. The connection uses TLS
automatically for Neon / `sslmode=require`.

## Secrets & OCI Object Storage

File storage uses a pluggable provider. With no configuration it uses the local
filesystem (`.data/storage`); set `STORAGE_PROVIDER=oci` plus the OCI settings to
use an OCI bucket via the **OpenStack Swift API** with **HTTP Basic Auth**
(Oracle "Approach 1"), i.e. `Authorization: Basic base64(user:auth-token)` against
`https://swiftobjectstorage.<region>.oraclecloud.com/v1/<namespace>/<bucket>`. No SDK.

Settings (from environment variables) — two equivalent ways to point at the bucket:

- **Full container URL** (matches OCI's "storage URL"):
  `OCI_SWIFT_BASE_URL=https://swiftobjectstorage.<region>.oraclecloud.com/v1/<namespace>/<bucket>`.
  Namespace/bucket/region are then optional.
- **Pieces**: `OCI_BUCKET`, `OCI_NAMESPACE`, `OCI_REGION` (and `OCI_SWIFT_BASE_URL`
  becomes optional, derived from the region).

Credentials (secret): `OCI_SWIFT_USER` — your identity-domain user, used verbatim,
e.g. `oracleidentitycloudservice/<user>` — and `OCI_SWIFT_PASSWORD`, an OCI Auth
Token generated in the console (used as the Basic Auth password).

Secret handling rules:

- **Never commit secrets.** `.env*` is git-ignored (except `.env.example`), and CI
  runs `gitleaks` to catch accidental commits.
- In **Cursor Cloud Agents**, add these in the **Secrets** panel; they are injected
  as environment variables into new agent runs.
- Secrets are read only on the server and are **never logged or returned to the
  browser** (the integration status exposes only bucket/region/auth-mode).

To validate connectivity, open **Files** and click **View** on an object — the
selected file is fetched from the active provider on request (size-capped, with a
binary guard).

### Auto-ingest statements from the bucket

Click **Load from bucket** on Integrations (or `POST /api/reference/ingest`)
to import UK reference documents from `aggCenter/APInvoices`,
`aggCenter/salesOrder`, and `aggCenter/remittance`. AP invoices keep
taxation country `GB`; remittances keep `OU: ResMed UK` and are stored as
one payment per remittance id (invoice numbers kept for matching).
Reconciliation uses those rows plus the bundled sample SO/PO set.

Click **Sync from bucket** on the Statements page (or `POST /api/statements/ingest`)
to import files from the active storage provider. Two layouts are scanned by
default:

**CSV** (`inbox/<accountId>/<file>.csv`) — the first path segment is the account
id and must match a known account from the active data source. Sample files:
[`data/sample/oci-inbox/`](data/sample/oci-inbox/).

**PDF** (`aggCenter/bankStatements/<bankCode>/<file>.pdf`) — `UK-HSBC` is routed
to the HSBC UK statement parser. Account identity comes from the PDF header
(IBAN / account number), not the folder name; missing accounts are upserted.
Parse failures are still persisted (with a parse job / trace) so the UI can show
why. Override prefixes with `STATEMENT_CSV_PREFIX` / `STATEMENT_PDF_PREFIX`, or
pass `{ "prefix": "..." }` in the ingest request body to scan a single prefix.

Ingestion is **idempotent** — files already imported (keyed by object path) are
skipped on re-sync.

Open a statement from the list to see the parsed **header**, **transactions**
(including the Narrative column), **parse trace**, and **source** metadata.
PDFs stay binary on the Files page — they are not dumped as text.

Cash position for statements that carry a bank running balance (HSBC PDFs)
uses the **oldest** `balanceAfter − amount` as the period opening. HSBC
"Closing ledger brought forward" is the **newest** listed balance (period
close), not the start-of-period opening — storing it as `BankAccount.openingBalance`
would double-count the period’s flows. Sample CSVs have no running balance, so
USD/EUR cash still uses each account’s stored opening. Reconciliation and
Anomalies can filter by currency so a large GBP statement does not bury the
sample USD/EUR rows.

### Supplier workspace

Cash and supplier master-data are separate **workspaces** in the sidebar (Cash /
Suppliers). Load extracts from the `supplier/` prefix in the bucket (or
`POST /api/suppliers/ingest`):

- `Supplier_Profile_EBS_Extract.csv` — name, number, tax type, taxpayer id
- `Supplier_Site_EBS_Extract.csv` — payment terms, pay group, payment method
- `Supplier_Address_EBS_Extract.csv` — country, lines, city, postal code
- `SupplierSiteVATID.csv` — supplier and site VAT IDs (overlaid by supplier number + site code)

The overview shows distributions (terms, group, type, country) and issue counts.
The records view is site-grained: filter by issue type, open a row, apply a
suggested fix, and save. Each save writes the previous record into
`aggc-supplier.supplier_record_versions` and field-level rows into
`aggc-supplier.supplier_audit_events`. Re-ingest replaces the **working copy**
only; version and audit history are kept.

When the prefix is empty, bundled samples under [`data/sample/suppliers/`](data/sample/suppliers/)
are used so the workspace still runs without OCI.

## Roadmap

- Real Snowflake client implementation (adapter and env wiring already in place).
- Additional operational workspaces beyond cash and suppliers, and a workflow/approval layer.
