#!/usr/bin/env bash
# Idempotent bootstrap for the aggcenter Cloud Agent environment.
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON_BIN="${PYTHON_BIN:-python3}"

if [ ! -d ".venv" ]; then
  "$PYTHON_BIN" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

python -m pip install --upgrade pip
pip install -r requirements-dev.txt

echo "aggcenter environment ready. Run: source .venv/bin/activate && uvicorn app.main:app --reload"
