#!/usr/bin/env bash
# openapi.yaml から各言語クライアントを生成する。
# 目標: packages/api-client-ts (TS) と packages/api-client-csharp (C#)。
# 現行: TS のみ packages/contracts に同居。C# 生成は follow-up (ADR-0004)。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "TS クライアントを生成: filter ${API_CLIENT_TS_FILTER}"
pnpm --config.verify-deps-before-run=false --filter "${API_CLIENT_TS_FILTER}" run gen

# TODO(ADR-0004): packages/api-client-csharp の C# 生成を追加する。
log "C# クライアント生成は未実装 (ADR-0004 follow-up)"
