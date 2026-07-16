#!/usr/bin/env bash
# packages/contracts (+ api-client-ts) の品質処理。
#   check (既定): typecheck / test
#   fix         : vp fmt (format)
# fix の結果は autofix.yml が commit する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-check}"
case "${mode}" in
  fix)
    log "contracts(fix): vp fmt"
    pnpm --config.verify-deps-before-run=false exec vp fmt "${CONTRACTS_DIR}"
    ;;
  check)
    log "contracts(check): typecheck / test"
    pnpm --config.verify-deps-before-run=false --filter "${API_CLIENT_TS_FILTER}" run typecheck
    pnpm --config.verify-deps-before-run=false --filter "${API_CLIENT_TS_FILTER}" run test
    ;;
  *)
    echo "usage: contracts.sh [check|fix]" >&2
    exit 2
    ;;
esac
