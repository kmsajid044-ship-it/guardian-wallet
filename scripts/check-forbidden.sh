#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

terms=(
  "crypto""currency" "crypto asset" "stable""coin" "token sale" "coin"
  "min""ing" "air""drop" "fauc""et" "main""net" "trad""ing"
  "yield farming" "sepo""lia" "Hong Kong stable""coin" "digital R""MB" "e-C""NY" "peg""ged"
  "x""402" "US""DC" "E""UR" "E""TH" "ERC""20" "ERC-""20" "ERC""4626" "ERC-""4626"
  "public network" "public-network" "public chain" "public block""chain" "public test""net"
)
money_terms=("Mock""USDC" "ops""Token" "token""Allowed" "IERC""20" "SafeERC""20")
failed=0

# Prefer ripgrep; otherwise scan the same file set (tracked plus untracked, non-ignored)
# with grep. Never pass silently because a scanner is missing.
if command -v rg >/dev/null 2>&1; then scanner=rg
elif command -v grep >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then scanner=grep
else echo "Forbidden-content check needs rg, or grep and git." >&2; exit 2; fi

repo_files() {
  # Working-tree view, like ripgrep: tracked files deleted on disk (not yet committed) are skipped.
  git ls-files -z --cached --others --exclude-standard -- . \
    ':!:node_modules/**' ':!:**/node_modules/**' ':!:contracts/lib/**' ':!:scripts/check-forbidden.sh' "$@" |
    while IFS= read -r -d '' file; do [[ -e "$file" ]] && printf '%s\0' "$file"; done
}

# search_repo <case-insensitive: 0|1> <pattern> [extra git pathspec excludes...]
# A scanner error prints SCAN_ERROR, which callers treat as a failure.
search_repo() {
  local insensitive="$1" pattern="$2"; shift 2
  local opts=-n; if (( insensitive )); then opts=-ni; fi
  if [[ "$scanner" == rg ]]; then
    local globs=(--glob '!node_modules/**' --glob '!contracts/lib/**' --glob '!.git/**' --glob '!scripts/check-forbidden.sh')
    local spec; for spec in "$@"; do globs+=(--glob "!${spec#:!:}"); done
    rg "$opts" "$pattern" . "${globs[@]}"; (( $? <= 1 )) || echo "SCAN_ERROR: rg failed"
  else
    repo_files "$@" | xargs -0 sh -c 'opts=$1 pattern=$2; shift 2; grep -IE "$opts" -- "$pattern" "$@"; [ $? -le 1 ] || exit 255' sh "$opts" "$pattern"
    (( $? == 0 )) || echo "SCAN_ERROR: grep failed"
  fi
}

search_stdin() {
  if [[ "$scanner" == rg ]]; then rg -n -i "$1"; else grep -nE -i -- "$1"; fi
  (( $? <= 1 )) || echo "SCAN_ERROR: stdin scan failed"
}

# The one sanctioned use of an otherwise forbidden phrase: the exact CNY disclaimer (CLAUDE.md rule 10).
# A hit is dropped only if the term no longer appears once that sentence is removed from the line.
cny_disclaimer="Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-C""NY."
drop_exempt() {
  TERM_RE="$1" EXEMPT="$cny_disclaimer" perl -ne 'if (/SCAN_ERROR/) { print; next } my $l = $_; my $e = quotemeta($ENV{EXEMPT}); $l =~ s/$e//g; print if $l =~ /\b\Q$ENV{TERM_RE}\E\b/i;'
}

# CLAUDE.md's hard-rule header lists the forbidden terms; scan everything from its body heading on.
claude_body="$(grep -n '^# CLAUDE.md' CLAUDE.md | head -1 | cut -d: -f1)"
[[ -n "$claude_body" ]] || { echo "CLAUDE.md body heading not found" >&2; exit 2; }

scan_term() {
  local term="$1"
  local output
  output="$(search_repo 1 "\\b${term}\\b" ':!:pnpm-lock.yaml' ':!:CLAUDE.md' | drop_exempt "$term")"
  if [[ -n "$output" ]]; then
    echo "Forbidden content: $term" >&2
    echo "$output" >&2
    failed=1
  fi
  output="$(tail -n +"$claude_body" CLAUDE.md | search_stdin "\\b${term}\\b" | drop_exempt "$term")"
  if [[ -n "$output" ]]; then
    echo "Forbidden content in CLAUDE.md body: $term" >&2
    echo "$output" >&2
    failed=1
  fi
}

for term in "${terms[@]}" "${money_terms[@]}"; do scan_term "$term"; done

public_rpc="$(search_repo 1 'RPC.*(https://|wss://)|(https://|wss://).*(rpc|infura|alchemy)')"
if [[ -n "$public_rpc" ]]; then echo "Public RPC reference found" >&2; echo "$public_rpc" >&2; failed=1; fi

ids="$(search_repo 0 '(CHAIN_ID=|CHAIN_ID:|"chainId"[[:space:]]*:)[[:space:]]*[0-9]+')"
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  value="$(sed -E 's/.*(CHAIN_ID=|CHAIN_ID:|"chainId"[[:space:]]*:)[[:space:]]*([0-9]+).*/\2/' <<<"$line")"
  if [[ "$value" != "31337" && "$value" != "1337" ]]; then echo "Non-local chain ID: $line" >&2; failed=1; fi
done <<<"$ids"

if (( failed != 0 )); then exit 1; fi
echo "Forbidden-content check passed ($scanner)."
