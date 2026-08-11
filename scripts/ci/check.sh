#!/usr/bin/env bash
# 品質ゲートの集約 (ローカル用の nix run .#check)。
# ローカルでは Control Plane、Realtime、LP、Web の品質処理を集約する。CI は ci.yml が領域別 workflow を呼び分ける。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

"${DIR}/control-plane.sh" check
"${DIR}/realtime.sh" check
"${DIR}/lp.sh" check
"${DIR}/web.sh" check

log "すべてのチェックが完了"
