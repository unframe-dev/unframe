#!/usr/bin/env bash
# ローカル開発セットアップ (依存インストール)。ツールチェインは nix develop が提供する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "pnpm 依存をインストール"
pnpm install
