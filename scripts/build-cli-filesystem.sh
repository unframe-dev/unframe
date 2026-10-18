#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${repo_root}/packages/unframe-cli/.cache/filesystem-helper"
mkdir -p "$(dirname "${output}")"
staging="$(mktemp "${output}.XXXXXX")"
trap 'rm -f -- "${staging}"' EXIT
CGO_ENABLED=0 go build -trimpath -o "${staging}" "${repo_root}/packages/unframe-cli/native/filesystem.go"
chmod 755 "${staging}"
mv -f -- "${staging}" "${output}"
