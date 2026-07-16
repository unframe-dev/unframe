#!/usr/bin/env bash
# packages/contracts (+ api-client-ts) の品質ゲート: fmt / typecheck / test。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "contracts: fmt / typecheck / test"
pnpm --config.verify-deps-before-run=false exec vp fmt --check "${CONTRACTS_DIR}"
pnpm --config.verify-deps-before-run=false --filter "${API_CLIENT_TS_FILTER}" run typecheck
pnpm --config.verify-deps-before-run=false --filter "${API_CLIENT_TS_FILTER}" run test
