#!/usr/bin/env bash
# Notion → docs/notion/ を同期する (nix run .#notion-sync の実体)。
# 実装は scripts/docs/notion-sync (TS)。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "Notion 同期: filter ${NOTION_SYNC_FILTER}"
pnpm --filter "${NOTION_SYNC_FILTER}" sync
