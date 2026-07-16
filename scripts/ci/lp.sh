#!/usr/bin/env bash
# lp (SvelteKit SSG) の品質処理。
#   check (既定): test / check (svelte-check) / build
#   fix         : vp fmt (format)
# fix の結果は autofix.yml が commit する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-check}"
case "${mode}" in
  fix)
    log "lp(fix): vp fmt"
    pnpm --config.verify-deps-before-run=false exec vp fmt "${LP_DIR}"
    ;;
  check)
    log "lp(check): test"
    pnpm --config.verify-deps-before-run=false --filter "${LP_FILTER}" run test
    log "lp(check): check / build"
    pnpm --config.verify-deps-before-run=false --filter "${LP_FILTER}" run check
    pnpm --config.verify-deps-before-run=false --filter "${LP_FILTER}" run build
    ;;
  *)
    echo "usage: lp.sh [check|fix]" >&2
    exit 2
    ;;
esac
