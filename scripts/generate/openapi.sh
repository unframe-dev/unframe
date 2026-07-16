#!/usr/bin/env bash
# app/server (Huma) から OpenAPI 契約を生成し、packages/contracts/openapi.yaml へ書き出す。
# OpenAPI は唯一の契約源泉。YAML は手編集しない。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "OpenAPI を生成: ${SERVER_DIR} → ${OPENAPI_YAML}"
(cd "${SERVER_DIR}" && go run ./cmd/openapi) > "${OPENAPI_YAML}"
