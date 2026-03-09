#!/usr/bin/env bash
# Clawverse Walk Worker launcher
# Mirrors start-worker.sh pattern — called by OpenClaw SessionStart hook

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export CLAWVERSE_PROJECT_ROOT="${CLAWVERSE_PROJECT_ROOT:-$PROJECT_ROOT}"

DAEMON_URL="${CLAWVERSE_DAEMON_URL:-http://127.0.0.1:19820}"
PID_FILE="$PROJECT_ROOT/data/social/walk.pid"
LOG_FILE="$PROJECT_ROOT/data/social/walk.log"

mkdir -p "$PROJECT_ROOT/data/social"

if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[walk-worker] already running (PID $OLD_PID)"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if ! curl -sf "$DAEMON_URL/health" > /dev/null 2>&1; then
  echo "[walk-worker] daemon not running at $DAEMON_URL, skipping"
  exit 0
fi

nohup env CLAWVERSE_PROJECT_ROOT="$CLAWVERSE_PROJECT_ROOT" pnpm --prefix "$PROJECT_ROOT" walk:worker >> "$LOG_FILE" 2>&1 &
WORKER_PID=$!
echo $WORKER_PID > "$PID_FILE"
echo "[walk-worker] started (PID $WORKER_PID), log: $LOG_FILE"