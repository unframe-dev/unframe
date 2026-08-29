#!/usr/bin/env bash
# Provision済みの Fixed Browser を使う明示的 integration test。通常 check には含めない。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

export PLAYWRIGHT_BROWSERS_PATH="${REPO_ROOT}/.cache/playwright"
if [ ! -d "${PLAYWRIGHT_BROWSERS_PATH}" ]; then
  log "Fixed Browser が未provisionです。${DIR}/install-presentation-browser.sh を先に実行してください。"
  exit 1
fi

pnpm --dir "${REPO_ROOT}" --filter @unframe/presentation-renderer-web exec vp test run \
  test/playwright-fixed-browser.integration.test.ts
