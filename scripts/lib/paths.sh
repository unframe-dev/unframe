#!/usr/bin/env bash
# 共有パス定数。リポジトリの目標構成をスクリプトから参照する。
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
export REPO_ROOT

# app/server (Go backend)
export SERVER_DIR="${REPO_ROOT}/app/server"
# app/web (React 編集エディタ)
export WEB_DIR="${REPO_ROOT}/app/web"
export WEB_FILTER="@unframe/web"
# lp (SvelteKit SSG)
export LP_DIR="${REPO_ROOT}/lp"
export LP_FILTER="@unframe/site"
# packages/contracts (openapi.yaml + codegen)
export CONTRACTS_DIR="${REPO_ROOT}/packages/contracts"
export OPENAPI_YAML="${CONTRACTS_DIR}/openapi.yaml"
# TS クライアント成果物
export API_CLIENT_TS_DIR="${REPO_ROOT}/packages/api-client-ts"
export API_CLIENT_TS_FILTER="@unframe/api-client-ts"
# Notion 同期 (scripts/docs/notion-sync)
export NOTION_SYNC_FILTER="unframe-notion-sync"

log() { printf '\033[1;34m[unframe]\033[0m %s\n' "$*"; }
