#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env"
rpc_url="${FISCO_RPC_URL:-http://127.0.0.1:8545}"
export PATH="$HOME/.foundry/bin:$PATH"

if [[ ! -f "$env_file" ]]; then echo "Missing $env_file." >&2; exit 1; fi
# shellcheck disable=SC1091
source "$repo_root/scripts/lib/env.sh"
for name in OWNER_PRIVATE_KEY AGENT_ADDRESS GUARDIAN_ADDRESS FEE_ACCOUNT_ADDRESS; do load_env_value "$env_file" "$name"; done
export FEE_ACCOUNT_ADDRESS="${FEE_ACCOUNT_ADDRESS:-0x00000000000000000000000000000000000000f3}"
export DEPLOYMENTS_FILE="$repo_root/deployments/fisco.json"

for name in OWNER_PRIVATE_KEY AGENT_ADDRESS FEE_ACCOUNT_ADDRESS; do
  value="${!name:-}"
  if [[ -z "$value" || "$value" == *YOUR_* || "$value" == *SYNTHETIC_* ]]; then echo "Set $name in .env." >&2; exit 1; fi
done

# The official Java SDK console initializes the local Web3 execution balances.
# No signing value is written to disk: a one-use named pipe supplies it from .env.
# shellcheck disable=SC1091
source "$repo_root/scripts/lib/fisco-console.sh"
fund_fisco_web3_accounts "$repo_root"

(cd "$repo_root/contracts" && forge script script/DeployFisco.s.sol:DeployFisco --rpc-url "$rpc_url" --broadcast --slow --legacy)
echo "Deployment manifest: $DEPLOYMENTS_FILE"
