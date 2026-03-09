#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${CLAWVERSE_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export CLAWVERSE_PROJECT_ROOT="$PROJECT_ROOT"

run_step() {
  local name="$1"
  local script="$2"
  echo "[SessionStart] $name"
  if [ -x "$script" ]; then
    "$script"
  else
    bash "$script"
  fi
}

run_step 'daemon bootstrap' "$PROJECT_ROOT/tools/daemon/bootstrap.sh"
run_step 'soul worker' "$PROJECT_ROOT/tools/soul/start-soul-worker.sh"
run_step 'social worker' "$PROJECT_ROOT/tools/social/start-worker.sh"
run_step 'collab worker' "$PROJECT_ROOT/tools/collab/start-collab-worker.sh"
run_step 'life worker' "$PROJECT_ROOT/tools/life/start-life-worker.sh"
run_step 'storyteller worker' "$PROJECT_ROOT/tools/storyteller/start-worker.sh"
run_step 'walk worker' "$PROJECT_ROOT/tools/walk/start-walk-worker.sh"