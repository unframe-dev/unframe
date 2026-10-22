#!/usr/bin/env bash
# app/audience の品質処理と開発サーバー。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-check}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "${mode}" in
  fix)
    log "audience(fix): vp fmt"
    pnpm --config.verify-deps-before-run=false exec vp fmt "${AUDIENCE_DIR}"
    ;;
  check)
    log "audience(check): check / test / build"
    pnpm --config.verify-deps-before-run=false --filter "${AUDIENCE_FILTER}" run check
    pnpm --config.verify-deps-before-run=false --filter "${AUDIENCE_FILTER}" run test
    pnpm --config.verify-deps-before-run=false --filter "${AUDIENCE_FILTER}" run build
    ;;
  dev|preview)
    exec pnpm --config.verify-deps-before-run=false --filter "${AUDIENCE_FILTER}" run "${mode}" "$@"
    ;;
  *)
    echo "usage: audience.sh [check|fix|dev|preview] [arguments...]" >&2
    exit 2
    ;;
esac
