#!/usr/bin/env bash

fisco_console_version="v3.8.0"

ensure_fisco_console() {
  local repo_root="$1"
  local runtime="$repo_root/.fisco"
  local console="$runtime/console"
  if [[ ! -x "$console/start.sh" ]]; then
    local archive="$runtime/console.tar.gz"
    local stage="$runtime/console.extract.$$"
    curl -fsSL "https://github.com/FISCO-BCOS/console/releases/download/${fisco_console_version}/console.tar.gz" -o "$archive"
    mkdir -p "$stage"
    tar -xzf "$archive" -C "$stage"
    mv "$stage/console" "$console"
  fi
  if [[ ! -f "$console/conf/config.toml" ]]; then cp "$console/conf/config-example.toml" "$console/conf/config.toml"; fi
  cp "$runtime/nodes/127.0.0.1/sdk/ca.crt" "$console/conf/ca.crt"
  cp "$runtime/nodes/127.0.0.1/sdk/sdk.crt" "$console/conf/sdk.crt"
  cp "$runtime/nodes/127.0.0.1/sdk/sdk.key" "$console/conf/sdk.key"
}

# prepare_fisco_console_for <repo root> <console dir> <sdk cert dir> <peer list>: a lightweight
# console for another local network, sharing the installed jars but with its own config and certs.
prepare_fisco_console_for() {
  local repo_root="$1" console="$2" sdk="$3" peers="$4"
  ensure_fisco_console "$repo_root"
  local shared="$repo_root/.fisco/console"
  mkdir -p "$console/conf"
  ln -sfn "$shared/apps" "$console/apps"
  ln -sfn "$shared/lib" "$console/lib"
  cp "$shared/start.sh" "$console/start.sh"
  cp -R "$shared/conf/." "$console/conf/"
  cp "$sdk/ca.crt" "$sdk/sdk.crt" "$sdk/sdk.key" "$console/conf/"
  perl -pi -e "s/^peers=.*/peers=${peers}/" "$console/conf/config.toml"
}

run_fisco_console_as_owner() {
  local repo_root="$1"
  local commands="$2"
  local console="${3:-$repo_root/.fisco/console}"
  local private_hex public_hex der_hex ec_pem owner_pem fifo
  private_hex="${OWNER_PRIVATE_KEY#0x}"
  public_hex="$(cast wallet public-key --private-key "$OWNER_PRIVATE_KEY")"
  public_hex="${public_hex#0x}"
  der_hex="30740201010420${private_hex}a00706052b8104000aa14403420004${public_hex}"
  ec_pem="$({ printf '%s' "$der_hex" | xxd -r -p | base64; } | { printf '%s\n' '-----BEGIN EC PRIVATE KEY-----'; cat; printf '%s\n' '-----END EC PRIVATE KEY-----'; })"
  owner_pem="$(printf '%s\n' "$ec_pem" | openssl pkcs8 -topk8 -nocrypt)"
  fifo="$console/owner.$$.pem"
  mkfifo "$fifo"
  (printf '%s\n' "$owner_pem" > "$fifo") &
  printf '%s\nquit\n' "$commands" | "$console/start.sh" group0 -pem "$(basename "$fifo")"
  wait
  unlink "$fifo"
}

# fund_fisco_web3_accounts <repo root> [console dir]: enable balances and fund owner and agent.
fund_fisco_web3_accounts() {
  local repo_root="$1"
  local console="${2:-$repo_root/.fisco/console}"
  local owner_address
  owner_address="$(cast wallet address --private-key "$OWNER_PRIVATE_KEY")"
  if [[ -z "${2:-}" ]]; then ensure_fisco_console "$repo_root"; fi
  run_fisco_console_as_owner "$repo_root" "$(printf '%s\n' \
    'setSystemConfigByKey feature_balance 1' \
    'setSystemConfigByKey feature_balance_precompiled 1' \
    "addBalance $owner_address 1000000000000000000" \
    "addBalance $AGENT_ADDRESS 1000000000000000000")" "$console"
}
