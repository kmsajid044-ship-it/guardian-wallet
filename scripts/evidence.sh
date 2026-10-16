#!/usr/bin/env bash
# Produce on-chain execution evidence on the running local FISCO BCOS network:
# scenarios -> evidence/evidence.json + evidence/receipts/, a node data snapshot, and
# docs/EXECUTION_EVIDENCE.md. Research prototype; USD and CNY demo balances, no real money.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
host_dir="$repo_root/.fisco/nodes/127.0.0.1"
snapshot_node="node3"
snapshot_port=8548
export PATH="$HOME/.foundry/bin:$PATH"
# shellcheck disable=SC1091
source "$repo_root/scripts/lib/fisco-nodes.sh"

if ! wait_for_nodes 8545 5; then echo "FISCO BCOS is not running; start it with ./scripts/chain-up.sh." >&2; exit 1; fi
(cd "$repo_root/contracts" && forge build --quiet)
mkdir -p "$repo_root/evidence"
rm -f "$repo_root/evidence/verification.json"

echo "== Running evidence scenarios on http://127.0.0.1:8545"
(cd "$repo_root/agent" && pnpm exec tsx ../scripts/evidence.ts run --out "$repo_root/evidence")

echo "== Snapshotting $snapshot_node data"
block_json() { curl -fsS -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBlockByNumber\",\"params\":[\"$1\",false],\"id\":1}" "http://127.0.0.1:$snapshot_port"; }
height_hex="$(curl -fsS -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "http://127.0.0.1:$snapshot_port" | jq -r .result)"
block_hash="$(block_json "$height_hex" | jq -r .result.hash)"
snapshot_dir="$repo_root/evidence/node-snapshot"
archive="$snapshot_dir/${snapshot_node}-data.tar.gz"
mkdir -p "$snapshot_dir"
bash "$host_dir/$snapshot_node/stop.sh" >/dev/null
for _ in {1..30}; do pgrep -f "$host_dir/$snapshot_node/../fisco-bcos" >/dev/null || break; sleep 1; done
# Ledger data and node configuration files only; conf/ holds the node's signing material and is excluded.
tar -czf "$archive" -C "$host_dir/$snapshot_node" data config.genesis config.ini nodes.json
bash "$host_dir/$snapshot_node/start.sh" >/dev/null
sha="$(shasum -a 256 "$archive" | cut -d' ' -f1)"
bytes="$(wc -c < "$archive" | tr -d ' ')"
jq -n --arg node "$snapshot_node" --arg file "evidence/node-snapshot/$(basename "$archive")" --arg sha "$sha" --argjson bytes "$bytes" \
  --argjson number "$((height_hex))" --arg hash "$block_hash" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{node: $node, file: $file, sha256: $sha, bytes: $bytes, blockNumber: $number, blockHash: $hash, takenAt: $at, excludes: ["conf/ (node and SSL keys)", "log/"]}' > "$snapshot_dir/snapshot.json"
if ! wait_for_nodes 8545 60; then echo "$snapshot_node did not come back after the snapshot." >&2; exit 1; fi
echo "Snapshot $archive at block $((height_hex)) ($block_hash), sha256 $sha"

(cd "$repo_root/agent" && pnpm exec tsx ../scripts/evidence.ts doc)
echo "Evidence ready. Verify with ./scripts/verify-evidence.sh --running and --fresh."
