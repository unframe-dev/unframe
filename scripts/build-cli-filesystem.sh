#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${repo_root}/packages/unframe/workspace-node/.cache/filesystem-helper"
mkdir -p "$(dirname "${output}")"
staging="$(mktemp "${output}.XXXXXX")"
trap 'rm -f -- "${staging}"' EXIT
CGO_ENABLED=0 go -C "${repo_root}/packages/unframe/workspace-node/native" build -trimpath -o "${staging}" .
chmod 755 "${staging}"
mv -f -- "${staging}" "${output}"
