# aggcenter

**Aggregation Center** — an operations aggregator for improving business
efficiency across typical operational processes. The first vertical is
**Cash Position** for the classic *Order-to-Cash* (O2C) and *Procure-to-Pay*
(P2P) flows. The **bank statement is the baseline**: reconciliation asks
whether supporting sales orders, purchase orders and remittances are in the
system to identify each payment. Remittances that have not landed on the
statement are a cash forecast (predicted in / out), not anomalies.

Built with **Next.js (App Router) + React + TypeScript**, **Material UI**, and **Tailwind CSS**. Vite powers unit tests (`vitest`) and parse scripts (`vite-node`). The UI uses Inter, a light canvas, white sidebar, bright blue primary (`#1E88E5`), and orange for pending / attention (`#F57C00`).

## Features

- **Cash Position dashboard** — actual opening/closing from the bank statement,
  inflows vs outflows, plus predicted in / out from remittances still to land.
- **Cash Forecast** — customer remittances = predicted in, vendor remittances =
  predicted out. These are not anomalies.
- **Reconciliation** — each bank payment is identified with supporting SO / PO /
  remittance files (matched / partial / unmatched).
- **Anomalies** — duplicate payments, amount mismatches, large unidentified bank
  lines, statistical outliers and overdraft risk. Missing remittances are
  forecast, not findings.
- **Statements** — the cash baseline. Upload or sync bank files; each Load /
  Sync from bucket replaces the previous parse.
- **Supplier workspace** — separate from cash. Ingest OCI `supplier/` extracts
  (profile, site, address, VAT ID), surface missing attributes, VAT-format and
  address issues, plus rationalisation of payment terms / group / type. Edit a
  record in place; each save writes a new version and an audit event in
  `aggc-supplier`. Build Oracle Fusion **Supplier FBDI** templates from the
  extracts plus those corrections and save them to `aggcenter/FBDI/supplier/`
  for later upload.
- **Invoice parser** — new workspace. Upload or sync PDF, Word (DOCX), Excel
  (XLSX) and CSV invoices. Text is extracted deterministically (pdf.js / Office);
  classification is either a static vendor/regex path or a **schema-constrained
  LLM** mapped into the existing invoice field schema. Uncertain results go to
  **Needs review** for human confirm (accept / edit / reject). Persists to
  `aggc-invoice`. Object storage uses
  `aggcenter/invoices/{landing,received,processed,archived,anomaly}/`.
- **People docs** — HR agreements and policies. Split view with a document list
  and field-level confidence pills (agreement ID, requestor, type, subtype,
  business function, ResMed entity, start/end dates, auto-renew, perpetual).
  Hybrid classify: static labelled regex is the floor; the LLM fills gaps
  (`PEOPLE_DOCS_LLM_*`, independent of invoice classify). Reprocess re-runs parse.
  Folders:
  `aggcenter/peopleDocs/{landing,processed,archived,anomaly}/`.
- **Integrations** — pluggable adapters for **OCI Object Storage** (files),
  **Snowflake** (reference data) and an optional external API, all defaulting to
  safe local/sample implementations.

## Architecture

```
src/
  app/                 # App Router pages + API route handlers
    api/               #   /api/cash-position, /cash-forecast, /reconciliation, /anomalies, /statements, /suppliers, ...
    suppliers/         #   Supplier workspace (overview, records, review, audit, FBDI)
    invoices/          #   Invoice parser (inbox, needs-review, document viewer)
    people-docs/       #   HR agreements / policies (list + field confidence)
  components/          # AppShell (Cash / Suppliers / Invoices / People workspaces), UI primitives, SVG charts
  lib/
    domain/            # shared types
    parse/             # CSV + bank-statement + invoice + people-doc parsing
    recon/             # reconciliation engine
    cash/              # cash-position calculator + remittance forecast
    anomalies/         # cash anomaly detection
    suppliers/         # supplier ingest, VAT/address checks, versions + audit, FBDI
    invoices/          # invoice ingest, OCI folder moves, repository
    peopleDocs/        # people-doc ingest, OCI folder moves, repository
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

Requires Node.js 22+.

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
| GET    | `/api/suppliers/review` | Updated records with net before/after field changes |
| POST   | `/api/suppliers/:id/vat-check` | Validate a VAT ID via EU VIES (name + address) |
| POST   | `/api/suppliers/review/vat-check` | Batch VIES checks for review records (max 25) |
| GET    | `/api/suppliers/fbdi`     | Preview Fusion Supplier FBDI + list saved packages |
| POST   | `/api/suppliers/fbdi`     | Build FBDI CSVs/ZIP and save under `aggcenter/FBDI/supplier/` |
| GET    | `/api/suppliers/fbdi/download` | Download a saved FBDI object (ZIP, CSV, manifest) |
| GET    | `/api/invoices`             | List parsed invoices (filter `folder`, `status`) |
| POST   | `/api/invoices`             | Upload PDF/DOCX/XLSX/CSV; parse and store        |
| POST   | `/api/invoices/ingest`      | Sync `aggcenter/invoices/landing/` (sample seed only if `INVOICE_SEED_SAMPLES=true`) |
| GET    | `/api/invoices/summary`     | Counts by pipeline folder + classify mode / warning |
| GET    | `/api/invoices/:id`         | Header, lines, tax, bank, classified fields, trace, confirm audit |
| PATCH  | `/api/invoices/:id`         | `{ "action": "archive" }` or `{ "action": "confirm" \| "reject", "fields", "actor" }` |
| GET    | `/api/invoices/:id/file`    | Original document (inline viewer)                |

## Database (Postgres / Neon)

Uploaded statements and their parsed transactions persist to Postgres via
[Drizzle ORM](https://orm.drizzle.team) when `DATABASE_URL` is set; otherwise a
local JSON store (`.data/uploads.json`) is used so the app runs with no database.
Cash tables live in a dedicated **`aggc-cash`** schema. Supplier working copies,
versions, audit events and VAT registry checks live in **`aggc-supplier`**.
Parsed invoices live in **`aggc-invoice`**.

Setup:

1. Set `DATABASE_URL` (Neon pooled connection string, or a local Postgres URL) —
   as a Cursor **Secret** in the cloud, or in `.env.local` for local dev.
2. Create the schema and tables:
   ```bash
   DATABASE_URL=... npm run db:migrate   # applies drizzle/ migrations (creates the aggc-cash, aggc-supplier and aggc-invoice schemas)
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
to **reset cash tables** and load one baseline. The **bank statement** is the
baseline; SO / PO / AP / remittance CSVs are supporting files used to identify
those payments:

| Folder | Role |
| --- | --- |
| `BANK_112` | Bank-statement baseline (one parse per file; previous statement rows are deleted first) |
| `INV_112` | Supporting AP invoices (taxation country `GB`) |
| `PO_112` | Supporting purchase orders (ORG 112 / UK) |
| `SO_112` | Supporting sales orders |
| `REM_112` | Supporting remittances (`OU: ResMed UK`). Unmatched remittances feed the cash forecast (predicted in / out), not anomalies. |

That wipe covers statements, transactions, parse traces, and upserted bank
accounts. Supporting SO/PO/AP/remittance rows are replaced. Cash position,
reconciliation, forecast, and anomalies are derived from those tables, so they
reset with the load. Bundled sample statements are not mixed in once an OCI
statement exists.

Override the org root with `CASH_ORG_ROOT`, or a single folder with
`REFERENCE_AP_PREFIX`, `REFERENCE_PO_PREFIX`, `REFERENCE_SO_PREFIX`,
`REFERENCE_REMITTANCE_PREFIX`.

Click **Sync from bucket** on the Statements page (or `POST /api/statements/ingest`)
to replace persisted statements and re-parse bank files from the active storage
provider (same one-run behaviour). Bank files are scanned under
`aggCenter/ORG_112 - UK/BANK_112/` by default:

**CSV** (`aggCenter/ORG_112 - UK/BANK_112/<accountId>/<file>.csv`) — the first path
segment under `BANK_112/` is the account id and must match a known account from the
active data source. Sample files:
[`data/sample/oci-inbox/`](data/sample/oci-inbox/).

**PDF** (`aggCenter/ORG_112 - UK/BANK_112/<bankCode>/<file>.pdf`) — `UK-HSBC` is routed
to the HSBC UK statement parser. A PDF sitting directly in `BANK_112/` still routes
when the filename contains `HSBC`. Account identity comes from the PDF header
(IBAN / account number), not the folder name; missing accounts are upserted.
Parse failures are still persisted (with a parse job / trace) so the UI can show
why. Override prefixes with `STATEMENT_CSV_PREFIX` / `STATEMENT_PDF_PREFIX`
(both default to the `BANK_112` folder), or pass `{ "prefix": "..." }` in the ingest
request body to scan a single prefix.

Each **Load from bucket** / **Sync from bucket** run **replaces** the previous
statement parse (tables are cleared first) so the same HSBC file is not kept
twice from old object keys.

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
- `SupplierSiteVATID.csv` — supplier and site VAT IDs, overlaid onto the
  site-extract rows by supplier number + site code. This file does **not** add
  records; the list baseline is one row per supplier site. Unmatched VAT rows
  are ignored.

The overview shows distributions (terms, group, type, country) and issue counts.
The records view is site-grained: filter by issue type, open a row, apply a
suggested fix, and save. Each save writes the previous record into
`aggc-supplier.supplier_record_versions` and field-level rows into
`aggc-supplier.supplier_audit_events`. **Review** (`/suppliers/review`) lists
those updates as a final before/after pass.

VAT IDs are checked two ways:

1. Local format / checksum (`src/lib/suppliers/vat.ts`).
2. The official EU **VIES** REST API (no key) —
   `POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number` —
   which confirms whether the number is registered and, when the member state
   publishes it, returns the **registered name and address**. Native-script
   results (Greek, Bulgarian, …) are **translated to English** when the check
   runs. Lookups are stored in `aggc-supplier.supplier_vat_checks`. GB numbers
   are not in VIES after Brexit; member-state outages are recorded as
   inconclusive, not invalid. Optional override: `VIES_API_URL`.

Re-ingest replaces the **working copy** only; version, audit, and VAT-check
history are kept.

When the prefix is empty, bundled samples under [`data/sample/suppliers/`](data/sample/suppliers/)
are used so the workspace still runs without OCI.

**FBDI** (`/suppliers/fbdi`) builds Oracle Fusion **Import Suppliers** CSVs from
the original `supplier/` extracts, overlaying rationalised fields from the
working copy (and synthesizing rows for records that exist only in aggcenter).
The package is saved under `aggcenter/FBDI/supplier/<batchId>/`:

- `POZ_SUPPLIERS_INT.csv`, `POZ_SUP_ADDRESSES_INT.csv`,
  `POZ_SUPPLIER_SITES_INT.csv`, `POZ_SITE_ASSIGNMENTS_INT.csv`
- `PozSupplierImport.zip` — upload this with Load Interface File for Import
- `overlay-report.csv` and `manifest.json` — what changed versus source

Override the output folder with `SUPPLIER_FBDI_PREFIX`. Scope can be all
records, changed + new, or new-only. Import action defaults to **UPDATE**
(the normal cutover/cleanup path for suppliers that already exist in Fusion).
CREATE remains available for new-only / synthesized rows; Fusion will reject
CREATE if the supplier number is already loaded. Synthesized rows with no
extract match are always written as CREATE even inside an UPDATE package.

### Invoice parser

Cash, suppliers and invoices are separate **workspaces**. Drop files into
`aggcenter/invoices/landing/` (or upload from the Inbox) then
**Sync landing folder** (`POST /api/invoices/ingest`):

```
aggcenter/invoices/landing/      inbound drop zone
aggcenter/invoices/received/     claimed for parsing
aggcenter/invoices/processed/    classified successfully
aggcenter/invoices/archived/     closed
aggcenter/invoices/anomaly/      needs review
```

Supported types: **PDF**, **DOCX**, **XLSX**, **CSV**. Legacy `.doc` / `.xls`
and image-only scans go to **anomaly**. Open an invoice to see classified
supplier, customer, dates, tax, totals, bank/BPAY details, line items and the
original document in the viewer. Archive moves the object to `archived/`.

**Folders**

- `processed` — `parsed` results that do not need confirm (high-confidence
  static vendor overlays, or high-confidence LLM with invoice #, totals, and a
  known currency).
- `anomaly` (**Needs review**) — `partial`, `anomaly`, `failed`, empty/scanned
  extracts, unknown currency, missing invoice # / totals, and low-confidence
  LLM output. These are **not** treated as finished.

**Classify modes**

1. **Static** — Hotjar / Tesla / Origin overlays plus generic regex. Used when
   no API key is set, `INVOICE_LLM_CLASSIFY=false`, or the LLM call / schema
   validation fails (`static-fallback`).
2. **Static fast path** — when LLM is on and `INVOICE_STATIC_FAST_PATH=true`
   (default), a high-confidence Hotjar/Tesla/Origin parse skips the model.
3. **LLM overlay** — static scripting always runs first and is the floor. The
   model only fills empty fields (and may correct a `$`→AUD default when the
   extract labels another ISO currency). Amounts may be integer cents or
   decimal major units; both map to integer cents.

**Human confirm**

Open an invoice in Inbox or Needs review. When `needsConfirm` is set, edit key
fields and **Accept & process** (moves to `processed`, status `parsed`) or
**Reject** (stays in anomaly). Each confirm writes `invoice_confirm_events`
(actor, action, field-level edits). Low-confidence LLM parses are never
auto-promoted to processed.

**Environment**

| Variable | Default | Purpose |
| --- | --- | --- |
| `INVOICE_LLM_CLASSIFY` | on when a key is present | Set `false` to force the static parser |
| `INVOICE_LLM_API_KEY` | — | Secret. Also accepts `OPENAI_API_KEY` / `XAI_API_KEY` |
| `INVOICE_LLM_MODEL` | `gpt-4o-mini` (xAI: `grok-4-fast-non-reasoning`) | Chat model name |
| `INVOICE_LLM_API_BASE` | OpenAI or `https://api.x.ai/v1` from the key | OpenAI-compatible base URL |
| `INVOICE_LLM_TIMEOUT_MS` | `30000` | Classify timeout |
| `INVOICE_STATIC_FAST_PATH` | `true` | Skip LLM for high-confidence vendor overlays |
| `INVOICE_SEED_SAMPLES` | `false` | Seed bundled samples into an empty landing folder |
| `INVOICE_PREFIX` | `aggcenter/invoices` | Pipeline root |

Put the key in `.env.local` for local dev, or as a Cursor **Secret**
(`INVOICE_LLM_API_KEY`) in Cloud Agents — never commit it. xAI keys (`xai-…`
or `XAI_API_KEY`) select `https://api.x.ai/v1` automatically. Invoice classify
is independent of people docs (`PEOPLE_DOCS_LLM_CLASSIFY` / `PEOPLE_DOCS_LLM_API_KEY`).

When LLM classify is off or the key is missing, the Inbox, APIs, and
Integrations page show a warning and the static parser runs.

**PII / provider** — extracted invoice text is sent to the configured model
provider **only** when the LLM classify path runs. Full invoice text is not
logged. Scanned / empty extracts stay in anomaly (no LLM call). OCR is a
follow-up; this pipeline does not invent fields from blank text.

When landing is empty, bundled samples under
[`data/sample/invoices/landing/`](data/sample/invoices/landing/) are used
**only if** `INVOICE_SEED_SAMPLES=true` (Hotjar, Tesla, Origin Energy, a
scanned PDF, and a CSV). Override the root with `INVOICE_PREFIX`.

### People docs

HR agreements and policies live in a separate **People** workspace. Drop files
into `aggcenter/peopleDocs/landing/` (or upload from People docs) then
**Sync landing folder** (`POST /api/people-docs/ingest`):

```
aggcenter/peopleDocs/landing/      inbound drop zone
aggcenter/peopleDocs/processed/    classified successfully
aggcenter/peopleDocs/archived/     closed
aggcenter/peopleDocs/anomaly/      needs review
```

The screen lists documents on the left (that list scrolls on its own) and
classified fields on the right (the detail pane stays in view), each with a
confidence pill:

- Agreement ID/number
- Requestor
- Agreement type
- Agreement Sub type
- Business Function
- Resmed Entity
- Agreement start date / end date
- Auto renew
- Perpetual

Classify is the same hybrid as invoices: static labelled regex first, LLM
overlay only fills empty fields, then static fallback if the model fails.
People-docs LLM is **independent** of invoice classify. A dedicated
`PEOPLE_DOCS_LLM_API_KEY` **always turns people LLM on**, even if
`PEOPLE_DOCS_LLM_CLASSIFY=false`. That false flag only blocks lab fallback from
`INVOICE_LLM_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` when the people key is
unset. Production HR should set `PEOPLE_DOCS_LLM_API_KEY`. **Reprocess** re-runs
parse on the stored file after enabling LLM. Partial / low-confidence results
stay in anomaly.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PEOPLE_DOCS_PREFIX` | `aggcenter/peopleDocs` | Pipeline root |
| `PEOPLE_DOCS_SEED_SAMPLES` | `false` | Seed bundled samples into empty landing |
| `PEOPLE_DOCS_LLM_CLASSIFY` | on when a people or fallback key is present | `false` only blocks lab fallback; a dedicated people key always enables LLM |
| `PEOPLE_DOCS_LLM_API_KEY` | lab fallback to invoice / OpenAI / xAI keys | Dedicated HR secret (preferred in production; always enables people LLM) |
| `PEOPLE_DOCS_LLM_MODEL` | invoice model | Optional override |
| `PEOPLE_DOCS_LLM_API_BASE` | invoice API base | Optional override |
| `PEOPLE_DOCS_LLM_TIMEOUT_MS` | max(invoice timeout, 45s) | Optional override |

## Roadmap

- Real Snowflake client implementation (adapter and env wiring already in place).
- Additional operational workspaces beyond cash, suppliers, invoices and people docs, and a workflow/approval layer.
- Invoice OCR for scanned / image-only PDFs (today those stay in Needs review; the LLM path does not invent fields from blank extracts).
