#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${CLAWVERSE_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export CLAWVERSE_PROJECT_ROOT="$PROJECT_ROOT"

stop_pid_file() {
  local name="$1"
  local pid_file="$2"

  if [ ! -f "$pid_file" ]; then
    echo "[SessionStop] $name not running"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "[SessionStop] stopping $name (PID $pid)"
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "[SessionStop] force killing $name (PID $pid)"
      kill -9 "$pid" 2>/dev/null || true
    fi
  else
    echo "[SessionStop] removing stale pid for $name"
  fi

  rm -f "$pid_file"
}

stop_pid_file 'walk worker' "$PROJECT_ROOT/data/social/walk.pid"
stop_pid_file 'storyteller worker' "$PROJECT_ROOT/data/life/storyteller-worker.pid"
stop_pid_file 'life worker' "$PROJECT_ROOT/data/life/worker.pid"
stop_pid_file 'collab worker' "$PROJECT_ROOT/data/collab/worker.pid"
stop_pid_file 'social worker' "$PROJECT_ROOT/data/social/worker.pid"
stop_pid_file 'daemon' "$PROJECT_ROOT/data/daemon/daemon.pid"