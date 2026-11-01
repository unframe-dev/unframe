#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
template="${root}/packages/unframe/cli/template"
project="$(mktemp -d)"
trap 'rm -rf -- "${project}"' EXIT
cp -R "${template}/." "${project}/"
printf '{}\n' > "${project}/unframe.lock"
for package in packages/unframe/authoring packages/unframe/presentation packages/contracts; do
  pnpm --config.verify-deps-before-run=false --dir "${root}/${package}" pack --pack-destination "${project}/vendor"
done
pnpm --config.verify-deps-before-run=false --dir "${project}" install --no-frozen-lockfile --ignore-scripts
pnpm --config.verify-deps-before-run=false --dir "${root}" --filter @unframe/cli run presentation lock update "${project}" --recreate
gzip -n -9 -c "${project}/unframe.lock" > "${template}/unframe.lock.gz"
cp "${project}"/vendor/*.tgz "${template}/vendor/"
cp "${project}/pnpm-lock.yaml" "${template}/pnpm-lock.yaml"
