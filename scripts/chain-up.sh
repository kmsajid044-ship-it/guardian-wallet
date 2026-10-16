#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="$repo_root/.fisco"
nodes_dir="$runtime_dir/nodes"
host_dir="$nodes_dir/127.0.0.1"
builder="$runtime_dir/build_chain.sh"
fisco_version="v3.16.4"
builder_url="https://raw.githubusercontent.com/FISCO-BCOS/FISCO-BCOS/${fisco_version}/tools/BcosAirBuilder/build_chain.sh"
export PATH="$HOME/.foundry/bin:$PATH"

rpc_result() {
  curl -fsS -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    "http://127.0.0.1:$1" 2>/dev/null | jq -er '.result == "0x539"' >/dev/null
}

configure_nodes() {
  local index port genesis config
  for index in 0 1 2 3; do
    port=$((8545 + index))
    genesis="$host_dir/node${index}/config.genesis"
    config="$host_dir/node${index}/config.ini"
    perl -0pi -e 's/(\[chain\][^\[]*?chain_id=)[^\n]+/${1}1337/s; s/(\[web3\]\s+chain_id=)\d+/${1}1337/' "$genesis"
    perl -0pi -e 's/(is_auth_check=)true/${1}false/' "$genesis"
    perl -0pi -e "s/(\[web3_rpc\][^\[]*?enable=)false/\${1}true/s; s/(\[web3_rpc\][^\[]*?listen_port=)8545/\${1}${port}/s" "$config"
  done
}

mkdir -p "$runtime_dir"
if [[ ! -x "$builder" ]]; then
  curl -fsSL "$builder_url" -o "$builder"
  chmod 0755 "$builder"
fi

if [[ ! -x "$host_dir/fisco-bcos" && ! -f "$host_dir/start_all.sh" ]]; then
  if [[ ! -f "$repo_root/.env" ]]; then echo "Missing $repo_root/.env." >&2; exit 1; fi
  # shellcheck disable=SC1091
  source "$repo_root/scripts/lib/env.sh"
  load_env_value "$repo_root/.env" OWNER_PRIVATE_KEY
  if [[ -z "${OWNER_PRIVATE_KEY:-}" || "$OWNER_PRIVATE_KEY" == *YOUR_* ]]; then echo "Set OWNER_PRIVATE_KEY in .env." >&2; exit 1; fi
  owner_address="$(cast wallet address --private-key "$OWNER_PRIVATE_KEY")"
  staging="$runtime_dir/nodes.building.$$"
  if ! (cd "$runtime_dir" && bash "$builder" -l 127.0.0.1:4 -p 30300,20200 -o "$staging" -v "$fisco_version" -I 1337 -a "$owner_address"); then
    echo "Native setup failed; retrying with the official Docker mode." >&2
    if ! docker info >/dev/null 2>&1; then
      if command -v colima >/dev/null 2>&1; then colima start; else echo "Docker is not running." >&2; exit 1; fi
    fi
    staging="$runtime_dir/nodes.docker.$$"
    (cd "$runtime_dir" && bash "$builder" -D -l 127.0.0.1:4 -p 30300,20200 -o "$staging" -v "$fisco_version" -I 1337 -a "$owner_address")
  fi
  mv "$staging" "$nodes_dir"
fi

configure_nodes

if rpc_result 8545; then
  echo "FISCO BCOS is ready: http://127.0.0.1:8545 (chain ID 1337)."
  exit 0
fi

bash "$host_dir/start_all.sh"
for _ in {1..30}; do
  ready=0
  for port in 8545 8546 8547 8548; do if rpc_result "$port"; then ready=$((ready + 1)); fi; done
  if [[ "$ready" == 4 ]]; then
    "$host_dir/fisco-bcos" --version | head -1
    echo "Four FISCO BCOS nodes are ready; primary Web3 endpoint: http://127.0.0.1:8545."
    exit 0
  fi
  sleep 1
done

echo "FISCO BCOS did not become ready; inspect $host_dir/node*/log/." >&2
exit 1
