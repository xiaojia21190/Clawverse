#!/usr/bin/env bash
# Clawverse Soul Worker launcher
# Called by OpenClaw SessionStart hook
# Runs once (computes soul hash + posts to daemon), then exits.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export CLAWVERSE_PROJECT_ROOT="${CLAWVERSE_PROJECT_ROOT:-$PROJECT_ROOT}"

DAEMON_URL="${CLAWVERSE_DAEMON_URL:-http://127.0.0.1:19820}"
LOG_FILE="$PROJECT_ROOT/data/soul/worker.log"

mkdir -p "$PROJECT_ROOT/data/soul"

if ! curl -sf "$DAEMON_URL/health" > /dev/null 2>&1; then
  echo "[soul-worker] daemon not running at $DAEMON_URL, skipping"
  exit 0
fi

echo "[soul-worker] running soul enrichment..."
env CLAWVERSE_PROJECT_ROOT="$CLAWVERSE_PROJECT_ROOT" pnpm --prefix "$PROJECT_ROOT" soul:worker >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "[soul-worker] soul enrichment complete, log: $LOG_FILE"
else
  echo "[soul-worker] soul enrichment failed (exit $EXIT_CODE), check $LOG_FILE"
fi