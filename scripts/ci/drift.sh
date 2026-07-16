#!/usr/bin/env bash
# 生成済み OpenAPI / TypeScript / sqlc 生成物に drift が無いことを検査する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

"${DIR}/../generate/all.sh"

log "生成物の drift を検査 (未追跡の新規生成物も含む)"
targets=(
  "${OPENAPI_YAML}"
  "${API_CLIENT_TS_DIR}/src/generated"
  "${SERVER_DIR}/internal/db/sqlcgen"
)
# add -A で新規(未追跡)ファイルもステージし、HEAD との差分を検査する。
# これにより git diff だけでは見逃す「新規生成ファイル」も drift として検出できる。
git -C "${REPO_ROOT}" add -A -- "${targets[@]}"
git -C "${REPO_ROOT}" diff --cached --exit-code -- "${targets[@]}"
