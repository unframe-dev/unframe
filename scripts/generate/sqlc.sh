#!/usr/bin/env bash
# app/server の SQL から sqlc で型付きクエリを生成する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "sqlc generate: ${SERVER_DIR}"
(cd "${SERVER_DIR}" && go tool sqlc generate)
