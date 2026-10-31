#!/usr/bin/env bash
set -euo pipefail
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
exec node "$root/scripts/runtime-host/pull-setup.mjs" "$@"
