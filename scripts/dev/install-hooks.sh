#!/usr/bin/env bash
# git hooks を有効化する。core.hooksPath を共有 hooks (packages/config/githooks) へ向ける。
# グローバル core.hooksPath (~/.git_template/hooks 等) をローカル設定で上書きするため、
# 環境に既存のグローバル hook があっても、このリポジトリでは共有 hook が優先される。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

# 実行権限を保証 (git 管理外の環境でも hook が動くように)
chmod +x "${GITHOOKS_DIR}"/* 2>/dev/null || true

# hooksPath はリポジトリ相対で設定する (worktree / 別クローン先でも壊れない)
current="$(git -C "${REPO_ROOT}" config --local --get core.hooksPath || true)"
if [ "${current}" = "${GITHOOKS_REL}" ]; then
  log "git hooks は既に有効 (core.hooksPath=${GITHOOKS_REL})"
  exit 0
fi

git -C "${REPO_ROOT}" config --local core.hooksPath "${GITHOOKS_REL}"
log "git hooks を有効化: core.hooksPath=${GITHOOKS_REL}"
