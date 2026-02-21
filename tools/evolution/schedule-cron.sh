#!/usr/bin/env bash
set -euo pipefail

ROOT="/root/.openclaw/workspace/Clawverse"
LOG="/tmp/clawverse-evolve.log"
CRON_EXPR="${1:-0 */6 * * *}"

LINE="$CRON_EXPR cd $ROOT && pnpm evolve:cycle >> $LOG 2>&1"

( crontab -l 2>/dev/null | grep -v 'pnpm evolve:cycle' ; echo "$LINE" ) | crontab -

echo "Installed cron: $LINE"
crontab -l | grep 'pnpm evolve:cycle' || true
