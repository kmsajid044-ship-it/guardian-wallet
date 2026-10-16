#!/usr/bin/env bash

load_env_value() {
  local env_file="$1"
  local name="$2"
  local value
  value="$(awk -F= -v key="$name" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$env_file")"
  value="${value%\"}"
  value="${value#\"}"
  printf -v "$name" '%s' "$value"
  export "$name"
}
