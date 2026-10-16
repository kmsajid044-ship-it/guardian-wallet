#!/usr/bin/env bash
# Shared FISCO BCOS node helpers for chain-up.sh and verify-evidence.sh.

# rpc_ready <web3 port>: true when the loopback Web3 endpoint answers with chain ID 1337.
rpc_ready() {
  curl -fsS -m 3 -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    "http://127.0.0.1:$1" 2>/dev/null | jq -er '.result == "0x539"' >/dev/null
}

# configure_fisco_nodes <host dir> <first web3 port>: chain ID 1337, auth check off, Web3 RPC on
# consecutive loopback ports starting at the given port.
configure_fisco_nodes() {
  local host_dir="$1" web3_base="$2" index port genesis config
  for index in 0 1 2 3; do
    port=$((web3_base + index))
    genesis="$host_dir/node${index}/config.genesis"
    config="$host_dir/node${index}/config.ini"
    perl -0pi -e 's/(\[chain\][^\[]*?chain_id=)[^\n]+/${1}1337/s; s/(\[web3\]\s+chain_id=)\d+/${1}1337/' "$genesis"
    perl -0pi -e 's/(is_auth_check=)true/${1}false/' "$genesis"
    perl -0pi -e "s/(\[web3_rpc\][^\[]*?enable=)false/\${1}true/s; s/(\[web3_rpc\][^\[]*?listen_port=)\d+/\${1}${port}/s" "$config"
  done
}

# wait_for_nodes <first web3 port> [attempts]: all four endpoints ready.
wait_for_nodes() {
  local base="$1" attempts="${2:-60}" ready port
  for ((i = 0; i < attempts; i++)); do
    ready=0
    for port in "$base" $((base + 1)) $((base + 2)) $((base + 3)); do if rpc_ready "$port"; then ready=$((ready + 1)); fi; done
    if [[ "$ready" == 4 ]]; then return 0; fi
    sleep 1
  done
  return 1
}
