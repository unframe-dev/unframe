#!/usr/bin/env bash
# app/web/console (React management SPA) の品質処理。
#   check (既定): check / test / build
#   fix         : vp fmt (format)
# fix の結果は autofix.yml が commit する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-check}"

test -f "${CONSOLE_DIR}/package.json"

case "${mode}" in
  fix)
    log "console(fix): vp fmt"
    pnpm --config.verify-deps-before-run=false exec vp fmt "${CONSOLE_DIR}"
    ;;
  check)
    log "console(check): check / test / build"
    pnpm --config.verify-deps-before-run=false --filter "${CONSOLE_FILTER}" run check
    pnpm --config.verify-deps-before-run=false --filter "${CONSOLE_FILTER}" run test
    pnpm --config.verify-deps-before-run=false --filter "${CONSOLE_FILTER}" run build
    ;;
  *)
    echo "usage: console.sh [check|fix]" >&2
    exit 2
    ;;
esac
