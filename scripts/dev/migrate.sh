#!/usr/bin/env bash
# Turso/libSQL に goose マイグレーションを適用する (nix run .#migrate の実体)。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "DB マイグレーションを適用: ${SERVER_DIR}"
(cd "${SERVER_DIR}" && go run ./cmd/migrate)
