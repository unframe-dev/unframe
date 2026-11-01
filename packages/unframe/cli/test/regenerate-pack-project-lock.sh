#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
project="$(mktemp -d)"
trap 'rm -rf -- "$project"' EXIT
cp -R "${root}/packages/unframe/cli/test/fixtures/pack-project/." "$project/"
printf "{}\n" > "$project/unframe.lock"
mkdir "$project/vendor"
for package in packages/unframe/authoring packages/unframe/presentation packages/contracts; do
  pnpm --config.verify-deps-before-run=false --dir "${root}/${package}" pack --pack-destination "$project/vendor"
done
pnpm --config.verify-deps-before-run=false --dir "$project" install --no-frozen-lockfile --ignore-scripts
pnpm --config.verify-deps-before-run=false --dir "$root" --filter @unframe/cli run presentation lock update "$project" --recreate
gzip -n -9 -c "$project/unframe.lock" > "${root}/packages/unframe/cli/test/fixtures/pack-project.lock.gz"
