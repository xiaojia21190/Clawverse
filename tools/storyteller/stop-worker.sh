#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID_FILE="$PROJECT_ROOT/data/life/storyteller-worker.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "[storyteller-worker] stopped (PID $PID)"
  else
    echo "[storyteller-worker] not running"
  fi
  rm -f "$PID_FILE"
else
  echo "[storyteller-worker] no PID file found"
fi
