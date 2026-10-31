#!/usr/bin/env bash
# app/server/realtime の Go gRPC backend 品質処理。
#   check (既定): vet / lint / test / build / race
#   fix         : golangci-lint fmt (format) + run --fix (lint autofix)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-check}"
case "${mode}" in
  fix)
    log "realtime(fix): golangci-lint fmt / run --fix"
    (cd "${REALTIME_SERVER_DIR}" && golangci-lint fmt)
    # 自動修正できない指摘が残っても fix 自体は失敗させない (残りは check が gate する)
    (cd "${REALTIME_SERVER_DIR}" && golangci-lint run --fix) || true
    ;;
  check)
    log "realtime(check): vet / lint / test / build / race"
    if [[ $(uname -s) == Darwin ]]; then
      (cd "${REPO_ROOT}" && node --test scripts/runtime-host/deploy.test.mjs scripts/runtime-host/funnel.test.mjs scripts/runtime-host/funnel-launchd.test.mjs scripts/runtime-host/pull-setup.test.mjs)
    fi
    (cd "${REPO_ROOT}" && node --test scripts/runtime-host/release.test.mjs scripts/runtime-host/pull-update.test.mjs)
    "${DIR}/../contracts/generate-proto.sh" check
    (cd "${REALTIME_SERVER_DIR}" && go vet ./...)
    (cd "${REALTIME_SERVER_DIR}" && golangci-lint run)
    (cd "${REALTIME_SERVER_DIR}" && go test ./...)
    (cd "${REALTIME_SERVER_DIR}" && go build ./...)
    (cd "${REALTIME_SERVER_DIR}" && go test -race ./...)
    ;;
  *)
    echo "usage: realtime.sh [check|fix]" >&2
    exit 2
    ;;
esac
