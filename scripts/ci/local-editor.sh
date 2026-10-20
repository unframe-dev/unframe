#!/usr/bin/env bash
# app/local-editor (local Source editor) の品質処理。
#   check (既定): check / test / build
#   fix         : vp fmt (format)
# fix の結果は autofix.yml が commit する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-check}"

test -f "${LOCAL_EDITOR_DIR}/package.json"

case "${mode}" in
  fix)
    log "local-editor(fix): vp fmt"
    pnpm --config.verify-deps-before-run=false exec vp fmt "${LOCAL_EDITOR_DIR}"
    ;;
  check)
    log "local-editor(check): check / test / build"
    pnpm --config.verify-deps-before-run=false --filter "${LOCAL_EDITOR_FILTER}" run check
    pnpm --config.verify-deps-before-run=false --filter "${LOCAL_EDITOR_FILTER}" run test
    pnpm --config.verify-deps-before-run=false --filter "${LOCAL_EDITOR_FILTER}" run build
    ;;
  *)
    echo "usage: local-editor.sh [check|fix]" >&2
    exit 2
    ;;
esac
