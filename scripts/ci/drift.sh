#!/usr/bin/env bash
# 生成済み OpenAPI / TypeScript / sqlc 生成物に drift が無いことを検査する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

"${DIR}/../generate/all.sh"

log "生成物の drift を検査"
git -C "${REPO_ROOT}" diff --exit-code -- \
  "${OPENAPI_YAML}" \
  "${CONTRACTS_DIR}/src/generated" \
  "${SERVER_DIR}/internal/db/sqlcgen"
