#!/usr/bin/env bash
# Clawverse Daemon Bootstrap
# Called by OpenClaw SessionStart hook (must run BEFORE worker hooks)
# Auto-builds if needed, starts daemon, waits until healthy.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DAEMON_URL="${CLAWVERSE_DAEMON_URL:-http://127.0.0.1:19820}"
PID_FILE="$PROJECT_ROOT/data/daemon/daemon.pid"
LOG_FILE="$PROJECT_ROOT/data/daemon/daemon.log"
MAX_WAIT=15  # seconds to wait for daemon health

mkdir -p "$PROJECT_ROOT/data/daemon"

# 1. Already running?
if curl -sf "$DAEMON_URL/health" > /dev/null 2>&1; then
  echo "[daemon-bootstrap] daemon already running at $DAEMON_URL"
  exit 0
fi

# 2. Clean stale PID
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[daemon-bootstrap] daemon process $OLD_PID exists but not healthy, killing..."
    kill "$OLD_PID" 2>/dev/null
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

# 3. Auto-build if dist missing
if [ ! -f "$PROJECT_ROOT/apps/daemon/dist/index.js" ]; then
  echo "[daemon-bootstrap] dist not found, building..."
  (cd "$PROJECT_ROOT" && pnpm build) >> "$LOG_FILE" 2>&1
  if [ $? -ne 0 ]; then
    echo "[daemon-bootstrap] build failed, check $LOG_FILE"
    exit 1
  fi
  echo "[daemon-bootstrap] build complete"
fi

# 4. Start daemon in background
echo "[daemon-bootstrap] starting daemon..."
nohup node "$PROJECT_ROOT/apps/daemon/dist/index.js" >> "$LOG_FILE" 2>&1 &
DAEMON_PID=$!
echo $DAEMON_PID > "$PID_FILE"

# 5. Wait for health
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  sleep 1
  ELAPSED=$((ELAPSED + 1))
  if curl -sf "$DAEMON_URL/health" > /dev/null 2>&1; then
    echo "[daemon-bootstrap] daemon ready (PID $DAEMON_PID) after ${ELAPSED}s, log: $LOG_FILE"
    exit 0
  fi
done

# 6. Timeout — daemon may still be starting, don't kill it
echo "[daemon-bootstrap] daemon not healthy after ${MAX_WAIT}s (PID $DAEMON_PID), workers may retry"
exit 0
