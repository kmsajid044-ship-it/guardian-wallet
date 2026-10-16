#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

terms=(
  "crypto""currency" "crypto asset" "stable""coin" "token sale" "coin"
  "min""ing" "air""drop" "fauc""et" "main""net" "trad""ing"
  "yield farming" "R""MB" "C""NY" "sepo""lia" "Hong Kong stable""coin"
  "x""402" "US""DC" "E""UR" "E""TH" "ERC""20" "ERC-""20" "ERC""4626" "ERC-""4626"
  "public network" "public-network" "public chain" "public block""chain" "public test""net"
)
money_terms=("Mock""USDC" "ops""Token" "token""Allowed" "IERC""20" "SafeERC""20")
failed=0

scan_term() {
  local term="$1"
  local output
  output="$(rg -n -i "\\b${term}\\b" . --glob '!node_modules/**' --glob '!contracts/lib/**' --glob '!.git/**' --glob '!pnpm-lock.yaml' --glob '!CLAUDE.md' --glob '!scripts/check-forbidden.sh' || true)"
  if [[ -n "$output" ]]; then
    echo "Forbidden content: $term" >&2
    echo "$output" >&2
    failed=1
  fi
  output="$(tail -n +12 CLAUDE.md | rg -n -i "\\b${term}\\b" || true)"
  if [[ -n "$output" ]]; then
    echo "Forbidden content in CLAUDE.md body: $term" >&2
    echo "$output" >&2
    failed=1
  fi
}

for term in "${terms[@]}" "${money_terms[@]}"; do scan_term "$term"; done

public_rpc="$(rg -n -i 'RPC[^\n]*(https://|wss://)|(https://|wss://)[^\n]*(rpc|infura|alchemy)' . --glob '!node_modules/**' --glob '!contracts/lib/**' --glob '!.git/**' --glob '!scripts/check-forbidden.sh' || true)"
if [[ -n "$public_rpc" ]]; then echo "Public RPC reference found" >&2; echo "$public_rpc" >&2; failed=1; fi

ids="$(rg -n '(CHAIN_ID=|CHAIN_ID:|"chainId"[[:space:]]*:)[[:space:]]*[0-9]+' . --glob '!node_modules/**' --glob '!contracts/lib/**' --glob '!.git/**' --glob '!scripts/check-forbidden.sh' || true)"
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  value="$(sed -E 's/.*(CHAIN_ID=|CHAIN_ID:|"chainId"[[:space:]]*:)[[:space:]]*([0-9]+).*/\2/' <<<"$line")"
  if [[ "$value" != "31337" && "$value" != "1337" ]]; then echo "Non-local chain ID: $line" >&2; failed=1; fi
done <<<"$ids"

if (( failed != 0 )); then exit 1; fi
echo "Forbidden-content check passed."
