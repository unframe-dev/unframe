#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"
bash "${REPO_ROOT}/scripts/build-cli-filesystem.sh"
export PLAYWRIGHT_BROWSERS_PATH="${REPO_ROOT}/.cache/playwright"
exec pnpm --dir "${REPO_ROOT}" --filter @unframe/contracts exec tsx ../../scripts/unity/generate-quest-demo.mts
