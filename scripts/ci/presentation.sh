#!/usr/bin/env bash
# packages/presentation-* の品質処理。
#   check (既定): 実装済み package の check
#   fix         : Vite+ formatter
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-check}"
case "${mode}" in
  fix)
    log "presentation(fix): vp fmt"
    pnpm --config.verify-deps-before-run=false exec vp fmt \
      "${REPO_ROOT}"/packages/presentation-*
    ;;
  check)
    log "presentation(check): package checks"
    pnpm --config.verify-deps-before-run=false \
      --filter "${PRESENTATION_AUTHORING_FILTER}" \
      --filter "${PRESENTATION_PACKAGES_FILTER}" \
      run check
    ;;
  *)
    echo "usage: presentation.sh [check|fix]" >&2
    exit 2
    ;;
esac
