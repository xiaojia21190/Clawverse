#!/usr/bin/env bash
# Clawverse Collab Worker launcher
# Called by OpenClaw SessionStart hook

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DAEMON_URL="${CLAWVERSE_DAEMON_URL:-http://127.0.0.1:19820}"
PID_FILE="$PROJECT_ROOT/data/collab/worker.pid"
LOG_FILE="$PROJECT_ROOT/data/collab/worker.log"

mkdir -p "$PROJECT_ROOT/data/collab"

# Check if already running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[collab-worker] already running (PID $OLD_PID)"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# Check if daemon is running
if ! curl -sf "$DAEMON_URL/health" > /dev/null 2>&1; then
  echo "[collab-worker] daemon not running at $DAEMON_URL, skipping"
  exit 0
fi

# Launch worker in background
nohup pnpm --prefix "$PROJECT_ROOT" collab:worker >> "$LOG_FILE" 2>&1 &
WORKER_PID=$!
echo $WORKER_PID > "$PID_FILE"
echo "[collab-worker] started (PID $WORKER_PID), log: $LOG_FILE"
