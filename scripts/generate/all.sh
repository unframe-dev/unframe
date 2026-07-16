#!/usr/bin/env bash
# 契約・クライアント・DB コードを一括生成する (nix run .#gen の実体)。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${DIR}/openapi.sh"
"${DIR}/clients.sh"
"${DIR}/sqlc.sh"
