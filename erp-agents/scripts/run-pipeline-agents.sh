#!/bin/zsh
# Start every agent HTTP service the mock-ui calls, each on its canonical port, using
# that package's own .venv. Idempotent: skips a service already answering /health.
# Logs go to <pkg>/runs/server.log.
#
#   pkg            module                      port   endpoint
#   bazooka        bazooka.server:app          8800   /reach/run
#   satellite      satellite.server:app        8801   /satellite/run
#   sleeper        sleeper.server:app          8803   /sleeper/run
#   ammoforge      ammoforge.server:app        8804   /ammoforge/run
#   crm            crm.server:app              8805   /crm/run
#   contractmaker  contractmaker.server:app    8807   /contractmaker/run
#   sales          sales.server:app            8808   /sales/run
#
# NOTE: glock + rag removed — they were ported to the modular monolith at
#   src/erp_agents/workflows/engage/{reply_glock,rag_agent}. Run those via
#   scripts/run_workflow.py (CLI) or the unified agent server (future phase).
#
# Usage:  run-pipeline-agents.sh         # start all
#         run-pipeline-agents.sh stop    # stop the ones we started

ROOT="/Users/kobewannkenobi/marketing-agent-workflows/erp-agents/workflows"

AGENTS=(
  "bazooka:bazooka.server:app:8800"
  "satellite:satellite.server:app:8801"
  "sleeper:sleeper.server:app:8803"
  "ammoforge:ammoforge.server:app:8804"
  "crm:crm.server:app:8805"
  "contractmaker:contractmaker.server:app:8807"
  "sales:sales.server:app:8808"
)

start() {
  local pkg=$1 module=$2 port=$3
  if curl -s -m1 "http://localhost:$port/health" >/dev/null 2>&1; then
    echo "✓ $pkg already up on :$port"; return
  fi
  local dir="$ROOT/$pkg"
  if [[ ! -x "$dir/.venv/bin/python" ]]; then
    echo "✗ $pkg: no .venv at $dir/.venv — create it (python -m venv .venv && pip install -e .)"; return
  fi
  echo "→ starting $pkg on :$port"
  mkdir -p "$dir/runs"
  ( cd "$dir" && nohup ./.venv/bin/python -m uvicorn "$module" --port "$port" \
      >"$dir/runs/server.log" 2>&1 & echo $! >"$dir/runs/server.pid" )
}

stop() {
  for entry in "${AGENTS[@]}"; do
    local pkg="${entry%%:*}"
    local pid_file="$ROOT/$pkg/runs/server.pid"
    [[ -f "$pid_file" ]] && kill "$(cat "$pid_file")" 2>/dev/null && echo "stopped $pkg" && rm -f "$pid_file"
  done
}

if [[ "$1" == "stop" ]]; then stop; exit 0; fi

for entry in "${AGENTS[@]}"; do
  pkg="${entry%%:*}"; rest="${entry#*:}"; module="${rest%:*}"; port="${rest##*:}"
  start "$pkg" "$module" "$port"
done

echo "waiting for health…"; sleep 2
for entry in "${AGENTS[@]}"; do
  pkg="${entry%%:*}"; port="${entry##*:}"
  printf "  %-14s :%s  " "$pkg" "$port"
  curl -s -m1 "http://localhost:$port/health" || echo "DOWN"
  echo
done
