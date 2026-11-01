#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
project="$(mktemp -d)"
trap 'rm -rf -- "$project"' EXIT
fixture="${root}/packages/unframe/cli/test/fixtures/tailwind-project"
cd "$root"
mkdir -p "$project/package" "$fixture/vendor" "$project/vendor"
bun -e 'import { sdkFixtureSource } from "./packages/unframe/cli/test/authoring-sdk-fixture.ts"; await Bun.write(process.argv[1], sdkFixtureSource);' "$project/package/index.ts"
cat > "$project/package/package.json" <<'JSON'
{"name":"@unframe/authoring","version":"1.0.0","type":"module","exports":{".":{"types":"./index.ts","import":"./index.ts"}}}
JSON
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - -C "$project" package | gzip -n > "$fixture/vendor/authoring.tgz"
cp "$fixture/package.json" "$fixture/pnpm-workspace.yaml" "$project/"
cp "$fixture/vendor/authoring.tgz" "$project/vendor/"
pnpm --config.verify-deps-before-run=false --dir "$project" install --lockfile-only --ignore-scripts --ignore-pnpmfile
cp "$project/pnpm-lock.yaml" "$fixture/pnpm-lock.yaml"
