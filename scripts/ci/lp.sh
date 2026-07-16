#!/usr/bin/env bash
# lp (SvelteKit SSG) の品質処理。
#   check (既定): check (svelte-check) / test / build
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
    # SvelteKit の設定 (svelte.config.js) と tsconfig.json が揃うまで check/build は動かない。
    # 整備後に自動で有効化する (ADR-0004 の app/web / lp 実装 follow-up)。
    if [ -f "${LP_DIR}/svelte.config.js" ] && [ -f "${LP_DIR}/tsconfig.json" ]; then
      log "lp(check): check / build"
      pnpm --config.verify-deps-before-run=false --filter "${LP_FILTER}" run check
      pnpm --config.verify-deps-before-run=false --filter "${LP_FILTER}" run build
    else
      log "lp(check): svelte.config.js / tsconfig.json 未整備のため check/build をスキップ (WIP)"
    fi
    ;;
  *)
    echo "usage: lp.sh [check|fix]" >&2
    exit 2
    ;;
esac
