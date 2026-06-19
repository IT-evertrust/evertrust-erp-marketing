#!/bin/zsh
# Bazooka scheduled entry point — called by launchd at 13:00 AND 14:00 local time
# (Asia/Ho_Chi_Minh). Exactly one of those is 08:00 Europe/Berlin depending on German
# DST; the guard below picks it. Manual runs: just call this script with no args.

BAZOOKA_DIR="/Users/kobewannkenobi/marketing-agent-workflows/erp-agents/workflows/bazooka"
LOG="$BAZOOKA_DIR/runs/launchd.log"

# Berlin-hour guard (skipped when run manually with --force)
if [[ "$1" != "--force" && "$(TZ=Europe/Berlin date +%H)" != "08" ]]; then
  echo "$(date '+%F %T') skip: not 08:00 Berlin" >> "$LOG"
  exit 0
fi

echo "$(date '+%F %T') firing bazooka" >> "$LOG"
cd "$BAZOOKA_DIR" || exit 1

# DRY RUN while credentials aren't set up yet.
# When ready to go live, change the next line to:  --live
exec "$BAZOOKA_DIR/.venv/bin/python" -m bazooka --no-llm >> "$LOG" 2>&1
