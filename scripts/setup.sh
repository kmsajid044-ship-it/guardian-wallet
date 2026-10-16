#!/usr/bin/env bash
# One-command setup: dependencies, test-only local identities, contracts, a four-node local
# FISCO BCOS network, deployment, and synthetic seed data. Run as `pnpm run setup`.
# Research prototype: USD and BDT demo balances on a simulated ledger, no real money.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env"
export PATH="$HOME/.foundry/bin:$PATH"

missing=()
for tool in node pnpm forge cast anvil jq curl perl openssl xxd java; do command -v "$tool" >/dev/null 2>&1 || missing+=("$tool"); done
if (( ${#missing[@]} )); then
  echo "Missing tools: ${missing[*]}" >&2
  echo "Install Node.js 20+, pnpm 10, Foundry (https://getfoundry.sh), jq, and a Java 8+ runtime (FISCO BCOS console)." >&2
  exit 1
fi

echo "== Installing dependencies"
(cd "$repo_root" && pnpm install --frozen-lockfile)

if [[ ! -f "$env_file" ]]; then
  echo "== Creating .env with fresh test-only identities (git-ignored; keys are not printed)"
  new_wallet() { cast wallet new --json | jq -r '(.data // .)[0] | "\(.address) \(.private_key)"'; }
  read -r owner_address owner_key <<<"$(new_wallet)"
  read -r agent_address agent_key <<<"$(new_wallet)"
  contact() { new_wallet | cut -d' ' -f1; }
  set_value() { perl -pi -e "s|^$1=.*|$1=$2|" "$env_file"; }
  umask 077
  cp "$repo_root/.env.example" "$env_file"
  set_value OWNER_PRIVATE_KEY "$owner_key"
  set_value AGENT_PRIVATE_KEY "$agent_key"
  set_value AGENT_ADDRESS "$agent_address"
  set_value FEE_ACCOUNT_ADDRESS 0x00000000000000000000000000000000000000f3
  set_value DEMO_CONTACT_1_ADDRESS "$(contact)"
  set_value DEMO_CONTACT_2_ADDRESS "$(contact)"
  set_value DEMO_CONTACT_3_ADDRESS "$(contact)"
  unset owner_key agent_key
  echo "Owner $owner_address, agent $agent_address"
else
  echo "== Keeping existing .env"
fi

echo "== Building contracts"
(cd "$repo_root/contracts" && forge build --quiet)

echo "== Starting the local FISCO BCOS network"
"$repo_root/scripts/chain-up.sh"

manifest="$repo_root/deployments/fisco.json"
wallet=""; [[ -f "$manifest" ]] && wallet="$(jq -r '.guardianWallet // empty' "$manifest")"
if [[ -n "$wallet" && "$(cast code "$wallet" --rpc-url http://127.0.0.1:8545 2>/dev/null || echo 0x)" != "0x" ]]; then
  echo "== Contracts already deployed at $wallet"
else
  echo "== Deploying contracts and seeding synthetic demo data"
  "$repo_root/scripts/deploy-fisco.sh"
  "$repo_root/scripts/seed.sh"
fi

echo
echo "Setup complete. Start the demo with: pnpm demo"
