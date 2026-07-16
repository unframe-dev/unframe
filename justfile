# Unframe コマンドランナー
# 使い方: `just` でレシピ一覧。`just <recipe>` で実行。

set shell := ["bash", "-euo", "pipefail", "-c"]
set windows-shell := ["pwsh.exe", "-NoLogo", "-NoProfile", "-Command"]

default:
    @just --list

# === setup ===

bootstrap:
    mise install
    vp env off
    vp install

install:
    vp install

# === development ===

dev:
    just --parallel be-dev site-dev

dev-backend: be-dev

be-dev:
    cd apps/backend && go run ./cmd/server

site-dev:
    vp dev apps/site

# === generation ===

gen: gen-contracts gen-sqlc

gen-contracts:
    cd apps/backend && go run ./cmd/openapi > ../../packages/contracts/openapi.yaml
    pnpm --config.verify-deps-before-run=false --filter @unframe/contracts run gen

gen-sqlc:
    cd apps/backend && go tool sqlc generate

db-generate: gen-sqlc

# 生成済み OpenAPI / TypeScript / sqlc コードの差分を検査
check-drift: gen
    git diff --exit-code -- packages/contracts/openapi.yaml packages/contracts/src/generated apps/backend/internal/db/sqlcgen

# === backend ===

be-fmt:
    cd apps/backend && test -z "$(gofmt -l .)"

be-lint: be-fmt
    cd apps/backend && go vet ./...
    cd apps/backend && golangci-lint run

be-test:
    cd apps/backend && go test ./...

be-build:
    cd apps/backend && go build ./...

# === contracts ===

contracts-fmt:
    pnpm --config.verify-deps-before-run=false exec vp fmt --check packages/contracts

contracts-typecheck:
    pnpm --config.verify-deps-before-run=false --filter @unframe/contracts run typecheck

contracts-test:
    pnpm --config.verify-deps-before-run=false --filter @unframe/contracts run test

contracts-check: contracts-fmt contracts-typecheck contracts-test

# === database ===

migrate:
    cd apps/backend && go run ./cmd/migrate

db-migrate: migrate

# === CI ===

check: check-drift be-lint be-test be-build contracts-check

ci: check

# === MR / Unity static CI ===

cs-fmt:
    dotnet format whitespace --folder apps/mr/Assets --verify-no-changes

# === notion sync ===

notion-sync:
    pnpm notion:sync

# === housekeeping ===

clean:
    pnpm -r exec rm -rf node_modules dist .turbo .vite
    rm -rf node_modules
