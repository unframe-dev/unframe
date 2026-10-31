#!/usr/bin/env bash
# Presentation Fixed Browser の明示的なローカル provision。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

export PLAYWRIGHT_BROWSERS_PATH="${REPO_ROOT}/.cache/playwright"
mkdir -p "${PLAYWRIGHT_BROWSERS_PATH}"
pnpm --dir "${REPO_ROOT}" --filter @unframe/core exec playwright-core install chromium --only-shell
