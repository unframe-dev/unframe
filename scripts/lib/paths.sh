#!/usr/bin/env bash
# 共有パス定数。ADR-0004 の目標構成に対する現行ディレクトリの対応表。
# 物理移行 (app/backend → app/server 等) が完了したら、右辺を目標名へ更新する。
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
export REPO_ROOT

# app/server (目標) / app/backend (現行)
export SERVER_DIR="${REPO_ROOT}/app/backend"
# app/web (React 編集エディタ)。現行は未実装 (ADR-0004 follow-up)
export WEB_DIR="${REPO_ROOT}/app/web"
export WEB_FILTER="@unframe/web"
# lp (SvelteKit SSG)
export LP_DIR="${REPO_ROOT}/lp"
export LP_FILTER="@unframe/site"
# packages/contracts (openapi.yaml + codegen)
export CONTRACTS_DIR="${REPO_ROOT}/packages/contracts"
export OPENAPI_YAML="${CONTRACTS_DIR}/openapi.yaml"
# TS クライアント成果物。現行は packages/contracts 同居、目標は packages/api-client-ts
export API_CLIENT_TS_FILTER="@unframe/contracts"
# Notion 同期 (scripts/docs/notion-sync)
export NOTION_SYNC_FILTER="unframe-notion-sync"

log() { printf '\033[1;34m[unframe]\033[0m %s\n' "$*"; }
