# aggcenter

**Aggregation Center** — a small [FastAPI](https://fastapi.tiangolo.com/) service that
collects data *sources* and reports aggregated metrics across them, with a live
dashboard UI.

## Features

- REST API to register sources and read aggregated stats
- Category roll-ups (count / total / average)
- Live dashboard (`/`) with auto-refresh and an "add source" form
- Zero external services required — the store is in-memory and seeded on start

## Requirements

- Python 3.12+

## Getting started

```bash
# 1. Install dependencies into a virtual environment
./scripts/cloud-agent-install.sh

# 2. Activate the environment
source .venv/bin/activate

# 3. Run the development server (http://localhost:8000)
uvicorn app.main:app --reload
```

Then open http://localhost:8000 for the dashboard, or explore the interactive API
docs at http://localhost:8000/docs.

## API

| Method | Path                  | Description                          |
| ------ | --------------------- | ------------------------------------ |
| GET    | `/`                   | Dashboard UI                         |
| GET    | `/api/health`         | Health check                         |
| GET    | `/api/sources`        | List all registered sources          |
| POST   | `/api/sources`        | Register a new source                |
| GET    | `/api/sources/{id}`   | Fetch a single source                |
| GET    | `/api/aggregate`      | Aggregated metrics across sources    |

Example:

```bash
curl -s localhost:8000/api/aggregate | python3 -m json.tool
curl -s -X POST localhost:8000/api/sources \
  -H 'Content-Type: application/json' \
  -d '{"name":"payments-api","category":"revenue","value":100}'
```

## Tests

```bash
source .venv/bin/activate
pytest
```

## Project layout

```
app/
  main.py         # FastAPI app + routes
  aggregator.py   # in-memory store + aggregation logic
  models.py       # Pydantic models
  static/         # dashboard UI
tests/            # pytest API tests
scripts/          # install + dev-server helpers
.cursor/          # Cloud Agent environment config
```

## Cloud Agent environment

The [`.cursor/environment.json`](.cursor/environment.json) file configures the
Cursor Cloud Agent environment: `install` provisions a virtualenv and installs
dependencies, and a `dev-server` terminal runs the app on port `8000`.
