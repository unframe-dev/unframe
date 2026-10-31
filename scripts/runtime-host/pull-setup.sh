#!/usr/bin/env bash
set -euo pipefail
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
exec go -C "$root/app/server/realtime" run ./cmd/runtime-host-admin setup-updater "$@"
