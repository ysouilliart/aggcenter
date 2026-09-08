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
- **Integrations** — pluggable adapters for **OCI Object Storage** (files),
  **Snowflake** (reference data) and an optional external API, all defaulting to
  safe local/sample implementations.

## Architecture

```
src/
  app/                 # App Router pages + API route handlers
    api/               #   /api/cash-position, /reconciliation, /anomalies, /statements, ...
  components/          # AppShell, UI primitives, SVG charts
  lib/
    domain/            # shared types
    parse/             # CSV + bank-statement parsing
    recon/             # reconciliation engine
    cash/              # cash-position calculator
    anomalies/         # anomaly detection
    storage/           # StorageProvider: local (default) + OCI adapter
    datasource/        # DataSource: local sample (default) + Snowflake adapter
    service.ts         # ties data loading, uploads and computations together
    config.ts          # env-driven configuration
data/sample/           # sample accounts, SOs, POs, remittances and statement CSVs
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

## Secrets & OCI Object Storage

File storage uses a pluggable provider. With no configuration it uses the local
filesystem (`.data/storage`); set `STORAGE_PROVIDER=oci` plus the OCI settings to
use an OCI bucket via the **OpenStack Swift API** (v1 token auth, no SDK).

Settings (from environment variables):

- Non-secret: `OCI_BUCKET`, `OCI_NAMESPACE`, `OCI_REGION`, and optional
  `OCI_SWIFT_BASE_URL` (derived from the region when omitted).
- Secret: `OCI_SWIFT_USER` (the Swift username; a `<namespace>:` prefix is added
  automatically if absent) and `OCI_SWIFT_PASSWORD` (the OCI auth token used as the
  Swift password).

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

## Roadmap

- Real Snowflake client implementation (adapter and env wiring already in place).
- Additional flows beyond cash position, and a workflow/approval layer.
- Persistent database for uploaded statements and audit history.
