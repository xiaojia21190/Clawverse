#!/usr/bin/env bash
# Stop Clawverse Collab Worker

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID_FILE="$PROJECT_ROOT/data/collab/worker.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "[collab-worker] stopped (PID $PID)"
  else
    echo "[collab-worker] not running"
  fi
  rm -f "$PID_FILE"
else
  echo "[collab-worker] no PID file found"
fi
