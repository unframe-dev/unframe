#!/usr/bin/env bash
# app/server (Go backend) の品質処理。
#   check (既定): vet / lint (golangci-lint run。gofmt formatter 込み)
#   fix         : golangci-lint fmt (format) + run --fix (lint autofix)
# fix の結果は autofix.yml が commit する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-check}"
case "${mode}" in
  fix)
    log "server(fix): golangci-lint fmt / run --fix"
    (cd "${SERVER_DIR}" && golangci-lint fmt)
    # 自動修正できない指摘が残っても fix 自体は失敗させない (残りは check が gate する)
    (cd "${SERVER_DIR}" && golangci-lint run --fix) || true
    ;;
  check)
    log "server(check): vet / lint / test / build"
    (cd "${SERVER_DIR}" && go vet ./...)
    (cd "${SERVER_DIR}" && golangci-lint run)
    (cd "${SERVER_DIR}" && go test ./...)
    (cd "${SERVER_DIR}" && go build ./...)
    ;;
  *)
    echo "usage: server.sh [check|fix]" >&2
    exit 2
    ;;
esac
