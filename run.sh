#!/usr/bin/env sh
# Staffroom on macOS or Linux: ./run.sh
cd "$(dirname "$0")" || exit 1
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
python -m pip install -q -r requirements.txt
echo "Staffroom is starting on http://localhost:8000  (Ctrl+C to stop)"
python -m uvicorn app.main:app --port 8000
