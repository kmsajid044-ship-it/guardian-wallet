#!/usr/bin/env bash
# Start the demo on the local FISCO BCOS network: Risk Intel (8788), agent API (8787), and the
# owner console (5173). Ctrl-C stops all three. Run `pnpm run setup` first.
# Research prototype: USD and BDT demo balances on a simulated ledger, no real money.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
logs="$repo_root/.demo"
agent_port="${AGENT_PORT:-8787}"; risk_port="${RISK_INTEL_PORT:-8788}"; web_port="${WEB_PORT:-5173}"
# Environment variables take precedence over .env for every service, so the ports can be moved.
export AGENT_PORT="$agent_port" RISK_INTEL_PORT="$risk_port" RISK_INTEL_URL="http://127.0.0.1:$risk_port" VITE_AGENT_API_URL="http://127.0.0.1:$agent_port"
export PATH="$HOME/.foundry/bin:$PATH"
# shellcheck disable=SC1091
source "$repo_root/scripts/lib/fisco-nodes.sh"

[[ -f "$repo_root/.env" ]] || { echo "Missing .env; run: pnpm run setup" >&2; exit 1; }
"$repo_root/scripts/chain-up.sh" >/dev/null
wallet="$(jq -r '.guardianWallet' "$repo_root/deployments/fisco.json")"
if [[ "$(cast code "$wallet" --rpc-url http://127.0.0.1:8545 2>/dev/null || echo 0x)" == "0x" ]]; then
  echo "No GuardianWallet at $wallet on this chain; run: pnpm run setup" >&2; exit 1
fi
for port in "$agent_port" "$risk_port" "$web_port"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $port is already in use; stop that process first." >&2; exit 1; fi
done

mkdir -p "$logs"
# The agent writes a fresh owner session token here (mode 0600) at each start; the console reads it
# through the Vite dev server, same-origin only. It is never printed. A stale one is removed first.
owner_session="${OWNER_SESSION_FILE:-$logs/owner-session}"
export OWNER_SESSION_FILE="$owner_session"
rm -f "$owner_session"
pids=()
stop() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; wait 2>/dev/null || true; rm -f "$owner_session"; echo; echo "Demo stopped."; }
trap stop EXIT INT TERM
start() { local name="$1"; shift; ("$@" >"$logs/$name.log" 2>&1) & pids+=("$!"); }
start risk-intel pnpm --dir "$repo_root/risk-intel" exec tsx src/index.ts
start agent pnpm --dir "$repo_root/agent" exec tsx src/index.ts
start web pnpm --dir "$repo_root/web" exec vite --host 127.0.0.1 --port "$web_port" --strictPort

# Any HTTP answer means the server is listening (Risk Intel answers 402 without a fee receipt).
ready() { [[ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" != "000" ]]; }
for _ in {1..60}; do
  if ready http://127.0.0.1:$agent_port/health && ready http://127.0.0.1:$risk_port/fx && ready http://127.0.0.1:$web_port/; then break; fi
  sleep 1
done
for check in "agent http://127.0.0.1:$agent_port/health" "risk-intel http://127.0.0.1:$risk_port/fx" "web http://127.0.0.1:$web_port/"; do
  set -- $check
  ready "$2" || { echo "$1 did not start; see $logs/$1.log" >&2; exit 1; }
done
[[ -s "$owner_session" ]] || { echo "agent did not write its owner session; see $logs/agent.log" >&2; exit 1; }

cat <<INFO
Guardian Wallet demo is running on local FISCO BCOS (chain ID 1337). No real money.

  Owner console  http://127.0.0.1:$web_port
  Agent API      http://127.0.0.1:$agent_port
  Risk Intel     http://127.0.0.1:$risk_port
  Logs           $logs/
  Owner session  $owner_session (per run, 0600; required as x-owner-session on /owner/*)

60-second tour:
  1. Chat: "Pay ana 50 USD"          -> T1, executed, transaction hash shown
  2. Chat: "Pay ana 250 USD"         -> T2, appears in the approval inbox; approve it
  3. Chat: "Pay ana"                 -> asks how much instead of guessing
  4. Attack Lab: "Run all 11"         -> every attack blocked, with layer and hash
  5. Kill switch: pause, then resume  -> owner-only resume
  6. Value Dashboard                  -> evaluation targets and live audit counts

Press Ctrl-C to stop.
INFO
wait
