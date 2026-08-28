#!/usr/bin/env bash
# 共有パス定数。リポジトリの目標構成をスクリプトから参照する。
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
export REPO_ROOT

# app/server/control-plane (Cloudflare Workers / Hono)
export CONTROL_PLANE_DIR="${REPO_ROOT}/app/server/control-plane"
export CONTROL_PLANE_FILTER="@unframe/control-plane"
# app/server/realtime (Go gRPC backend)
export REALTIME_SERVER_DIR="${REPO_ROOT}/app/server/realtime"
# app/web (React 編集エディタ)
export WEB_DIR="${REPO_ROOT}/app/web"
export WEB_FILTER="@unframe/web"
# lp (SvelteKit SSG)
export LP_DIR="${REPO_ROOT}/lp"
export LP_FILTER="@unframe/site"
# packages/contracts (future API / protocol boundaries)
export CONTRACTS_DIR="${REPO_ROOT}/packages/contracts"
# packages/config (shared TypeScript and repository tooling configuration)
export CONFIG_FILTER="@unframe/config"
# packages/presentation-authoring (public SDK name: @unframe/presentation)
export PRESENTATION_AUTHORING_FILTER="@unframe/presentation"
# packages/presentation-* (Presentation build pipeline packages)
export PRESENTATION_PACKAGES_FILTER="@unframe/presentation-*"
# Notion 同期 (scripts/docs/notion-sync)
export NOTION_SYNC_FILTER="unframe-notion-sync"
# 共有 git hooks (packages/config/githooks)。core.hooksPath はリポジトリ相対で設定する。
export GITHOOKS_REL="packages/config/githooks"
export GITHOOKS_DIR="${REPO_ROOT}/${GITHOOKS_REL}"

log() { printf '\033[1;34m[unframe]\033[0m %s\n' "$*"; }
