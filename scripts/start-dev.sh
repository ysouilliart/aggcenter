#!/usr/bin/env bash
# Start the aggcenter development server (used by the Cloud Agent terminal).
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source .venv/bin/activate

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
