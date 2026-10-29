#!/usr/bin/env bash
set -euo pipefail
set +x
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
exec node "$root/scripts/runtime-host/funnel-launchd-prepare.mjs" "$@"
