#!/usr/bin/env bash
# packages/contracts/openapi.yaml から各言語クライアントを生成する。
# TS クライアントは packages/api-client-ts に生成する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "TS クライアントを生成: filter ${API_CLIENT_TS_FILTER}"
pnpm --config.verify-deps-before-run=false --filter "${API_CLIENT_TS_FILTER}" run gen

# C# クライアント生成は Unity 側の生成ツール導入時に追加する。
log "C# クライアント生成設定: ${CONTRACTS_DIR}/codegen"
