#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${repo_root}/packages/unframe/workspace-node/native-bin"
mkdir -p "${output}"
for target in linux-x64 darwin-arm64; do
  case "${target}" in
    linux-x64) goos=linux; goarch=amd64 ;;
    darwin-arm64) goos=darwin; goarch=arm64 ;;
  esac
  staging="$(mktemp "${output}/filesystem-helper-${target}.XXXXXX")"
  trap 'rm -f -- "${staging}"' EXIT
  GOOS="${goos}" GOARCH="${goarch}" CGO_ENABLED=0 go -C "${repo_root}/packages/unframe/workspace-node/native" build -trimpath -o "${staging}" .
  chmod 755 "${staging}"
  mv -f -- "${staging}" "${output}/filesystem-helper-${target}"
done
