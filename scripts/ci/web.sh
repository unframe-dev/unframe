#!/usr/bin/env bash
# app/web (React 編集エディタ) の品質ゲート: check / test / build。
# 現行は未実装 (ADR-0004 follow-up)。package.json が無ければスキップする。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

if [ ! -f "${WEB_DIR}/package.json" ]; then
  log "web: ${WEB_DIR} 未実装。スキップ (ADR-0004 follow-up)"
  exit 0
fi

log "web: check / test / build"
pnpm --config.verify-deps-before-run=false --filter "${WEB_FILTER}" run check
pnpm --config.verify-deps-before-run=false --filter "${WEB_FILTER}" run test
pnpm --config.verify-deps-before-run=false --filter "${WEB_FILTER}" run build
