#!/usr/bin/env bash
# 品質ゲートの集約 (ローカル用の nix run .#check)。
# CI は ci.yml が領域別 workflow (server/web/lp/openapi/unity) に分割して実行する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

"${DIR}/drift.sh"
"${DIR}/server.sh"
"${DIR}/contracts.sh"
"${DIR}/lp.sh"
"${DIR}/web.sh"

log "すべてのチェックが完了"
