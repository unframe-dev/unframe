#!/usr/bin/env bash
# app/server/control-plane (Cloudflare Workers / Hono) の品質処理。
#   check (既定): typecheck / test / deploy dry-run
#   fix         : Vite+ formatter
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-check}"
case "${mode}" in
  fix)
    log "control-plane(fix): vp fmt"
    pnpm --config.verify-deps-before-run=false exec vp fmt \
      --config "${CONTROL_PLANE_DIR}/.oxfmtrc.json" \
      "${CONTROL_PLANE_DIR}"
    ;;
  check)
    log "control-plane(check): typecheck / test / deploy dry-run"
    pnpm --config.verify-deps-before-run=false --filter "${CONTROL_PLANE_FILTER}" run check
    ;;
  *)
    echo "usage: control-plane.sh [check|fix]" >&2
    exit 2
    ;;
esac
