#!/usr/bin/env bash
# backend と lp を並走起動する (nix run .#dev の実体)。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "backend + lp を並走起動 (Ctrl-C で停止)"
trap 'kill 0' EXIT
(cd "${SERVER_DIR}" && go run ./cmd/server) &
(cd "${LP_DIR}" && pnpm run dev) &
wait
