#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stop_script="$repo_root/.fisco/nodes/127.0.0.1/stop_all.sh"
if [[ ! -f "$stop_script" ]]; then
  echo "No local FISCO BCOS runtime is installed."
  exit 0
fi
bash "$stop_script"
