#!/usr/bin/env bash
# lp (SvelteKit SSG) の品質ゲート: check / test / build。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "lp: check / test / build"
pnpm --config.verify-deps-before-run=false --filter "${LP_FILTER}" run check
pnpm --config.verify-deps-before-run=false --filter "${LP_FILTER}" run test
pnpm --config.verify-deps-before-run=false --filter "${LP_FILTER}" run build
