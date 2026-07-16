#!/usr/bin/env bash
# app/server (Go backend) の品質ゲート: fmt / vet / lint / test / build。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

log "server: fmt / vet / lint"
(cd "${SERVER_DIR}" && test -z "$(gofmt -l .)")
(cd "${SERVER_DIR}" && go vet ./...)
(cd "${SERVER_DIR}" && golangci-lint run)

log "server: test / build"
(cd "${SERVER_DIR}" && go test ./...)
(cd "${SERVER_DIR}" && go build ./...)
