#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env"
manifest="$repo_root/deployments/fisco.json"
rpc_url="${FISCO_RPC_URL:-http://127.0.0.1:8545}"
export PATH="$HOME/.foundry/bin:$PATH"

if [[ ! -f "$env_file" || ! -f "$manifest" ]]; then echo "Run deploy-fisco.sh after configuring .env." >&2; exit 1; fi
# shellcheck disable=SC1091
source "$repo_root/scripts/lib/env.sh"
for name in OWNER_PRIVATE_KEY DEMO_CONTACT_1_ADDRESS DEMO_CONTACT_2_ADDRESS DEMO_CONTACT_3_ADDRESS; do load_env_value "$env_file" "$name"; done
export GUARDIAN_WALLET_ADDRESS="$(jq -er '.guardianWallet' "$manifest")"
export DEMO_LEDGER_ADDRESS="$(jq -er '.demoLedger' "$manifest")"

for name in OWNER_PRIVATE_KEY DEMO_CONTACT_1_ADDRESS DEMO_CONTACT_2_ADDRESS DEMO_CONTACT_3_ADDRESS; do
  value="${!name:-}"
  if [[ -z "$value" || "$value" == *YOUR_* || "$value" == *SYNTHETIC_* ]]; then echo "Set $name in .env." >&2; exit 1; fi
done

(cd "$repo_root/contracts" && forge script script/SeedFisco.s.sol:SeedFisco --rpc-url "$rpc_url" --broadcast --slow --legacy)
echo "Seeded synthetic demo balances from config/currencies.json, policy, and contacts."
