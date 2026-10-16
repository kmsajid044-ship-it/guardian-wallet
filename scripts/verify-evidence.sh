#!/usr/bin/env bash
# Verify the exported execution evidence.
#   --running  mode (a): fetch every exported transaction by hash from all four running nodes and
#              require receipts, transactions, and block hashes to equal the export. Checks the
#              original hashes.
#   --fresh    mode (b): build a separate four-node FISCO BCOS network on other loopback ports,
#              deploy from scratch, replay every scenario, and require the same outcomes and
#              effects. Proves reproducibility. The primary network is not touched.
#   --all      both (default).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---all}"
export PATH="$HOME/.foundry/bin:$PATH"
# shellcheck disable=SC1091
source "$repo_root/scripts/lib/fisco-nodes.sh"
# shellcheck disable=SC1091
source "$repo_root/scripts/lib/env.sh"
# shellcheck disable=SC1091
source "$repo_root/scripts/lib/fisco-console.sh"
evidence() { (cd "$repo_root/agent" && pnpm exec tsx ../scripts/evidence.ts "$@"); }

if [[ ! -f "$repo_root/evidence/evidence.json" ]]; then echo "No evidence yet; run ./scripts/evidence.sh first." >&2; exit 1; fi

verify_running() {
  echo "== Mode (a): original hashes on the running network"
  if ! wait_for_nodes 8545 5; then echo "FISCO BCOS is not running; start it with ./scripts/chain-up.sh." >&2; exit 1; fi
  evidence verify-running --rpc http://127.0.0.1:8545,http://127.0.0.1:8546,http://127.0.0.1:8547,http://127.0.0.1:8548
  local snapshot="$repo_root/evidence/node-snapshot/snapshot.json"
  if [[ -f "$snapshot" ]]; then
    local file expected actual
    file="$repo_root/$(jq -r .file "$snapshot")"; expected="$(jq -r .sha256 "$snapshot")"
    actual="$(shasum -a 256 "$file" | cut -d' ' -f1)"
    if [[ "$actual" != "$expected" ]]; then echo "Node snapshot checksum mismatch: $actual != $expected" >&2; exit 1; fi
    local number hash
    number="$(jq -r .blockNumber "$snapshot")"; hash="$(jq -r .blockHash "$snapshot")"
    local live
    live="$(curl -fsS -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBlockByNumber\",\"params\":[\"$(printf '0x%x' "$number")\",false],\"id\":1}" http://127.0.0.1:8545 | jq -r .result.hash)"
    if [[ "$live" != "$hash" ]]; then echo "Snapshot block $number hash $hash is not on the running chain ($live)" >&2; exit 1; fi
    echo "Node snapshot sha256 $actual matches; snapshot block $number $hash is on the running chain"
  fi
}

verify_fresh() {
  echo "== Mode (b): fresh network, deploy, replay"
  # Global, not local: the EXIT trap runs after this function returns.
  work="$repo_root/.fisco/verify-chain"
  local binary="$repo_root/.fisco/nodes/127.0.0.1/fisco-bcos"
  local base=8555
  [[ -x "$binary" ]] || { echo "Missing $binary; run ./scripts/chain-up.sh once." >&2; exit 1; }
  for port in 8555 8556 8557 8558 20300 30400; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $port is in use; stop the previous verification network." >&2; exit 1; fi
  done
  load_env_value "$repo_root/.env" OWNER_PRIVATE_KEY
  load_env_value "$repo_root/.env" AGENT_ADDRESS
  local owner_address
  owner_address="$(cast wallet address --private-key "$OWNER_PRIVATE_KEY")"
  # stop_all.sh can give up on a node; make sure no verification node outlives this run.
  kill_fresh_nodes() { pkill -f "$work/nodes/" 2>/dev/null || true; for _ in {1..20}; do pgrep -f "$work/nodes/" >/dev/null || return 0; sleep 0.5; done; pkill -9 -f "$work/nodes/" 2>/dev/null || true; }
  kill_fresh_nodes
  rm -rf "$work"; mkdir -p "$work"
  cleanup() { if [[ -f "$work/nodes/127.0.0.1/stop_all.sh" ]]; then bash "$work/nodes/127.0.0.1/stop_all.sh" >/dev/null 2>&1 || true; fi; kill_fresh_nodes; rm -rf "$work"; }
  trap cleanup EXIT
  (cd "$work" && bash "$repo_root/.fisco/build_chain.sh" -e "$binary" -l 127.0.0.1:4 -p 30400,20300 -o "$work/nodes" -I 1337 -a "$owner_address" >"$work/build.log" 2>&1) \
    || { cat "$work/build.log" >&2; exit 1; }
  configure_fisco_nodes "$work/nodes/127.0.0.1" "$base"
  bash "$work/nodes/127.0.0.1/start_all.sh" >/dev/null
  if ! wait_for_nodes "$base" 60; then echo "Fresh network did not start." >&2; exit 1; fi
  echo "Fresh four-node network ready on http://127.0.0.1:$base (chain ID 1337, genesis block 0)"
  # Same funding step deploy-fisco.sh performs on the primary network, through a console bound to the fresh nodes.
  prepare_fisco_console_for "$repo_root" "$work/console" "$work/nodes/127.0.0.1/sdk" '["127.0.0.1:20300", "127.0.0.1:20301"]'
  fund_fisco_web3_accounts "$repo_root" "$work/console" >"$work/funding.log" 2>&1 || { cat "$work/funding.log" >&2; exit 1; }
  echo "Funded owner and agent execution balances on the fresh network"
  (cd "$repo_root/contracts" && forge build --quiet)
  # Keep the last replay and its full log outside the throwaway network for diagnosis.
  rm -rf "$repo_root/.fisco/verify-last"; mkdir -p "$repo_root/.fisco/verify-last"
  if ! RPC_URL="http://127.0.0.1:$base" FISCO_RPC_URL="http://127.0.0.1:$base" evidence run --out "$work/evidence" 2>&1 | tee "$repo_root/.fisco/verify-last/replay.log"; then
    echo "Replay failed; full log in .fisco/verify-last/replay.log" >&2; exit 1
  fi
  cp -R "$work/evidence/." "$repo_root/.fisco/verify-last/"
  evidence compare "$work/evidence" --rpc "http://127.0.0.1:$base"
}

case "$mode" in
  --running) verify_running ;;
  --fresh) verify_fresh ;;
  --all) verify_running; verify_fresh ;;
  *) echo "usage: $0 [--running|--fresh|--all]" >&2; exit 2 ;;
esac
evidence doc >/dev/null
echo "Verification recorded in evidence/verification.json and docs/EXECUTION_EVIDENCE.md"
