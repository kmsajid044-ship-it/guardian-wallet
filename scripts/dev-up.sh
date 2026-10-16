#!/usr/bin/env bash
# Starts Anvil, deploys all contracts, seeds policy/data/funds, and writes deployments/local.json.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env"
pid_file="$repo_root/.anvil.pid"
log_file="$repo_root/.anvil.log"

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file; copy .env.example and add test-only keys/addresses." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

required=(OWNER_PRIVATE_KEY AGENT_ADDRESS FEE_ACCOUNT_ADDRESS DEMO_CONTACT_1_ADDRESS DEMO_CONTACT_2_ADDRESS DEMO_CONTACT_3_ADDRESS)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" || "${!name}" == *YOUR_* || "${!name}" == *OPTIONAL_* || "${!name}" == *SYNTHETIC_* ]]; then
    echo "Set $name in .env using test-only credentials/addresses." >&2
    exit 1
  fi
done

rpc_url="${RPC_URL:-http://127.0.0.1:8545}"
if ! cast chain-id --rpc-url "$rpc_url" >/dev/null 2>&1; then
  anvil --silent >"$log_file" 2>&1 &
  anvil_pid=$!
  echo "$anvil_pid" >"$pid_file"
  for _ in {1..40}; do
    if cast chain-id --rpc-url "$rpc_url" >/dev/null 2>&1; then break; fi
    sleep 0.25
  done
  if ! cast chain-id --rpc-url "$rpc_url" >/dev/null 2>&1; then
    kill "$anvil_pid" 2>/dev/null || true
    echo "Anvil did not become ready; inspect $log_file." >&2
    exit 1
  fi
fi

(
  cd "$repo_root/contracts"
  DEPLOYMENTS_FILE="$repo_root/deployments/local.json" forge script script/Deploy.s.sol:Deploy --rpc-url "$rpc_url" --broadcast
)

echo "Local chain ready. Deployment manifest: $repo_root/deployments/local.json"
echo "Anvil PID file: $pid_file"
