#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-generate}"
if [[ "${mode}" != "generate" && "${mode}" != "check" ]]; then
  echo "usage: generate-valid-delivery.sh [generate|check]" >&2
  exit 2
fi

export PLAYWRIGHT_BROWSERS_PATH="${REPO_ROOT}/.cache/playwright"
if ! find "${PLAYWRIGHT_BROWSERS_PATH}" -type f -name chrome-headless-shell -perm -111 -print -quit | grep -q .; then
  echo "Fixed Browser is not provisioned; run scripts/dev/install-presentation-browser.sh first." >&2
  exit 1
fi

temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
cp -R "${REPO_ROOT}/examples/presentation/." "${temp}/"
pnpm --dir "${REPO_ROOT}" --filter @unframe/unframe-cli run presentation build "${temp}"
bun "${DIR}/generate-valid-delivery.ts" "${mode}" "${temp}/dist"
