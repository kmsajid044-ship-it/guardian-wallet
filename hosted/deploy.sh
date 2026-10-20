#!/usr/bin/env bash
# Hosted online demo: deploy fresh GuardianWallet and DemoLedger contracts and seed synthetic demo
# data on the chain already running in this container. Used at start and by "Reset demo".
# Research prototype: USD and CNY demo balances on a simulated ledger, no real money.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend="$(grep -E '^CHAIN_BACKEND=' "$repo_root/.env" | cut -d= -f2-)"
export FISCO_RPC_URL="$(grep -E '^RPC_URL=' "$repo_root/.env" | cut -d= -f2-)"

if [[ "$backend" == fisco ]]; then
  "$repo_root/scripts/deploy-fisco.sh"
  "$repo_root/scripts/seed.sh"
else
  set -a
  # shellcheck disable=SC1091
  source "$repo_root/.env"
  set +a
  # Generated identities start empty on Anvil: give the owner and agent local execution balance.
  for address in "$(cast wallet address --private-key "$OWNER_PRIVATE_KEY")" "$AGENT_ADDRESS"; do
    cast rpc --rpc-url "$FISCO_RPC_URL" anvil_setBalance "$address" 0x56BC75E2D63100000 >/dev/null
  done
  (cd "$repo_root/contracts" && DEPLOYMENTS_FILE="$repo_root/deployments/local.json" forge script script/Deploy.s.sol:Deploy --rpc-url "$FISCO_RPC_URL" --broadcast)
  # Same starting state as the FISCO BCOS seed (contacts added before the 10-minute cooldown applies):
  # move the development chain's clock past the cooldown.
  cast rpc --rpc-url "$FISCO_RPC_URL" evm_increaseTime 660 >/dev/null
  cast rpc --rpc-url "$FISCO_RPC_URL" evm_mine >/dev/null
fi
echo "[deploy] GuardianWallet $(jq -r '.guardianWallet' "$repo_root/deployments/$([[ "$backend" == fisco ]] && echo fisco || echo local).json")"
