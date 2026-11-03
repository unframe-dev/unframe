#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
fixture="${root}/packages/unframe/cli/test/fixtures/reference-project"
pnpm --config.verify-deps-before-run=false --dir "${root}" --filter @unframe-dev/package-checks exec tsx ../../packages/unframe/cli/test/regenerate-reference-lock.ts
pnpm --config.verify-deps-before-run=false --dir "${root}" --filter @unframe-dev/cli run presentation lock refresh "${fixture}"
