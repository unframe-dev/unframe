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

pnpm --dir "${REPO_ROOT}" --config.verify-deps-before-run=false \
  --filter @unframe/contract-fixtures run "${mode}"
