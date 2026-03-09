#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${CLAWVERSE_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export CLAWVERSE_PROJECT_ROOT="$ROOT"

LOG="${CLAWVERSE_EVOLVE_CRON_LOG:-/tmp/clawverse-evolve.log}"
CRON_EXPR="${1:-0 */6 * * *}"
LINE="$CRON_EXPR cd $ROOT && CLAWVERSE_PROJECT_ROOT=$ROOT pnpm evolve:cycle >> $LOG 2>&1"

( crontab -l 2>/dev/null | grep -v 'pnpm evolve:cycle' ; echo "$LINE" ) | crontab -

echo "Installed cron: $LINE"
crontab -l | grep 'pnpm evolve:cycle' || true