#!/usr/bin/env bash
# app/web (React 動的編集エディタ) の品質処理。
#   check (既定): check / test / build
#   fix         : vp fmt (format)
# 現行は app/web 未実装のため package.json が無ければスキップする (ADR-0004 follow-up)。
# fix の結果は autofix.yml が commit する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-check}"

if [ ! -f "${WEB_DIR}/package.json" ]; then
  log "web(${mode}): ${WEB_DIR} 未実装。スキップ (ADR-0004 follow-up)"
  exit 0
fi

case "${mode}" in
  fix)
    log "web(fix): vp fmt"
    pnpm --config.verify-deps-before-run=false exec vp fmt "${WEB_DIR}"
    ;;
  check)
    log "web(check): check / test / build"
    pnpm --config.verify-deps-before-run=false --filter "${WEB_FILTER}" run check
    pnpm --config.verify-deps-before-run=false --filter "${WEB_FILTER}" run test
    pnpm --config.verify-deps-before-run=false --filter "${WEB_FILTER}" run build
    ;;
  *)
    echo "usage: web.sh [check|fix]" >&2
    exit 2
    ;;
esac
