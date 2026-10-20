#!/usr/bin/env bash
# One command to a clean demo state for recording: stop the running demo, restart the four local
# FISCO BCOS nodes (data kept), deploy fresh contracts, seed synthetic demo balances and contacts,
# set the agent's audit log aside, and start the demo with the owner console on port 3000.
# Research prototype: USD and CNY demo balances on a simulated ledger, no real money.
# The AI provider follows .env (LLM_PROVIDER=groq with GROQ_API_KEY, otherwise offline rules).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export WEB_PORT="${WEB_PORT:-3000}"
agent_port="${AGENT_PORT:-8787}"; risk_port="${RISK_INTEL_PORT:-8788}"
export PATH="$HOME/.foundry/bin:$PATH"

[[ -f "$repo_root/.env" ]] || { echo "Missing .env; run: pnpm run setup" >&2; exit 1; }

# Stop whatever listens on the demo ports and wait until they are free. Run again after the deploy,
# so a demo started while the chain was resetting cannot keep the old audit log or deployment.
stop_demo() {
  for port in "$agent_port" "$risk_port" "$WEB_PORT"; do
    pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
  done
  for _ in {1..20}; do
    busy=0
    for port in "$agent_port" "$risk_port" "$WEB_PORT"; do lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && busy=1; done
    [[ "$busy" == 0 ]] && return 0
    sleep 1
  done
  echo "A demo port is still in use; stop that process and run this again." >&2; exit 1
}

echo "== Stopping the running demo (ports $agent_port, $risk_port, $WEB_PORT)"
stop_demo

echo "== Restarting the local FISCO BCOS nodes (ledger data kept)"
"$repo_root/scripts/chain-down.sh" >/dev/null 2>&1 || true
"$repo_root/scripts/chain-up.sh"

mkdir -p "$repo_root/.demo"
echo "== Deploying fresh contracts and seeding synthetic demo data"
"$repo_root/scripts/deploy-fisco.sh" >"$repo_root/.demo/reset.log" 2>&1 || { echo "Deploy failed; see .demo/reset.log" >&2; exit 1; }
"$repo_root/scripts/seed.sh" >>"$repo_root/.demo/reset.log" 2>&1 || { echo "Seed failed; see .demo/reset.log" >&2; exit 1; }
echo "Wallet $(jq -r '.guardianWallet' "$repo_root/deployments/fisco.json")"

stop_demo

# A clean Activity list: the previous audit log is moved aside (kept, not deleted).
audit_db="$(grep -E '^AUDIT_DB_PATH=' "$repo_root/.env" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
audit_db="${audit_db:-./agent/data/audit.sqlite}"
[[ "$audit_db" == /* ]] || audit_db="$repo_root/${audit_db#./}"
if [[ -f "$audit_db" ]]; then
  backup="$repo_root/.demo/audit-backup-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup"
  for file in "$audit_db" "$audit_db-wal" "$audit_db-shm"; do [[ -f "$file" ]] && mv "$file" "$backup/"; done
  echo "Previous audit log moved to ${backup#"$repo_root/"}/"
fi

echo "== Starting the demo; open http://localhost:$WEB_PORT (Ctrl-C stops it)"
exec "$repo_root/scripts/demo.sh"
