#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
export PLAYWRIGHT_BROWSERS_PATH="${repo_root}/.cache/playwright"
# shellcheck source=../lib/native-host.sh
source "${repo_root}/scripts/lib/native-host.sh"
host="$(native_host)"
suite="${1:-all}"
if [ "$#" -gt 1 ]; then
  echo "usage: $0 [all|renderer|cli-project|cli-author|cli-styles|macos]" >&2
  exit 2
fi
case "$host/$suite" in
  linux/all | linux/renderer | linux/cli-project | linux/cli-author | linux/cli-styles | darwin/all | darwin/macos) ;;
  *)
    echo "Unsupported Opaque capture suite for $host: $suite" >&2
    exit 2
    ;;
esac

if [ "$host" = linux ]; then
  if [ ! -f /sys/fs/cgroup/cgroup.controllers ]; then
    echo "Opaque capture CI requires cgroup v2." >&2
    exit 1
  fi
  if ! grep -qw memory /sys/fs/cgroup/cgroup.controllers ||
    ! grep -qw pids /sys/fs/cgroup/cgroup.controllers; then
    echo "Opaque capture CI requires memory and pids cgroup controllers." >&2
    exit 1
  fi
  if ! systemctl --user show-environment >/dev/null; then
    echo "Opaque capture CI requires an active systemd user manager." >&2
    exit 1
  fi
fi
if ! find "${PLAYWRIGHT_BROWSERS_PATH}" -type f -name chrome-headless-shell -perm -111 -print -quit | grep -q .; then
  echo "Pinned Playwright Chromium is unavailable." >&2
  exit 1
fi

if [ "$host" = linux ] && [ -z "${UNFRAME_OPAQUE_CGROUP_ROOT:-}" ]; then
  exec "${repo_root}/scripts/dev/opaque-capture-scope.sh" "${repo_root}/scripts/ci/opaque-capture.sh" "$suite"
fi

run_tests() {
  local module="$1"
  shift
  pnpm --config.verify-deps-before-run=false --dir "${repo_root}" --filter "@unframe/$module" exec vp test run --maxWorkers=1 --testTimeout=60000 "$@"
}

renderer() {
  local isolation="test/opaque-isolation.integration.test.ts"
  if [ "$host" = darwin ]; then
    isolation="test/opaque-isolation-darwin.integration.test.ts"
  fi
  node --test "${repo_root}"/packages/unframe/worker-host/src/native/test_*.ts
  run_tests render-browser \
    "$isolation" test/opaque-capture.integration.test.ts \
    test/opaque-fonts.integration.test.ts test/opaque-runtime-lifecycle.integration.test.ts \
    test/playwright-fixed-browser.integration.test.ts
}

cli_project() {
  run_tests cli test/opaque-project.integration.test.ts test/media-project.integration.test.ts
  run_tests media-node test/video-validator.integration.test.ts
}

cli_author() {
  run_tests cli \
    test/author-capture.integration.test.ts test/author-source-diagnostics.integration.test.ts
}

cli_styles() {
  pnpm --config.verify-deps-before-run=false --dir "${repo_root}" --filter @unframe/styles-node run build
  run_tests styles-node test/styles-worker.integration.test.ts
  run_tests cli test/tailwind-project.integration.test.ts
}

selected_tests() {
  local file="$1" pattern
  shift
  pattern="$(
    node --input-type=module - "$@" <<'NODE'
const names = process.argv.slice(2);
process.stdout.write(`(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
NODE
  )"
  run_tests render-browser "$file" --testNamePattern "$pattern" \
    --reporter=default --reporter=json --outputFile="${reports}/selected.json"
  node --input-type=module - "${reports}/selected.json" "$@" <<'NODE'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const [path, ...names] = process.argv.slice(2);
const report = JSON.parse(readFileSync(path, 'utf8'));
const passed = report.testResults.flatMap(result => result.assertionResults)
  .filter(result => result.status === 'passed').map(result => result.title);
assert.deepEqual(passed.sort(), names.sort(), 'The native Browser smoke selection must run every expected test.');
NODE
}

macos() {
  local reports
  reports="$(mktemp -d)"
  # Capture the path before set -e unwinds the function's local scope.
  # shellcheck disable=SC2064
  trap "$(printf 'rm -rf -- %q' "$reports")" EXIT
  bash "${repo_root}/scripts/build-cli-filesystem.sh"
  go -C "${repo_root}/packages/unframe/workspace-node/native" test -vet=off ./...
  node --test "${repo_root}/packages/unframe/worker-host/src/native/test_native_launcher.ts"
  node --test --test-reporter=tap \
    --test-name-pattern='^native profiles compile and deny host files$' \
    "${repo_root}/packages/unframe/worker-host/src/native/test_compile_policy.ts" | tee "${reports}/policy.tap"
  grep -qx '# pass 1' "${reports}/policy.tap"
  run_tests render-browser test/opaque-isolation-darwin.integration.test.ts
  pnpm --config.verify-deps-before-run=false --dir "${repo_root}" --filter @unframe/styles-node run build
  run_tests styles-node test/styles-worker.integration.test.ts
  selected_tests test/playwright-fixed-browser.integration.test.ts \
    'provision済みmanaged ChromiumでFrame/Text相当のdocumentをPNG captureする'
  selected_tests test/opaque-capture.integration.test.ts \
    'captures identical RGBA in two isolated executions' \
    'rejects external network attempts'
  selected_tests test/opaque-fonts.integration.test.ts \
    'captures text using an explicit locked font and preserves transparent pixels' \
    'rejects a visible OS fallback font'
  trap - EXIT
  rm -rf -- "$reports"
}

case "$suite" in
  renderer) renderer ;;
  cli-project | cli-author | cli-styles)
    bash "${repo_root}/scripts/build-cli-filesystem.sh"
    case "$suite" in
      cli-project) cli_project ;;
      cli-author) cli_author ;;
      cli-styles) cli_styles ;;
    esac
    ;;
  macos) macos ;;
  all)
    bash "${repo_root}/scripts/build-cli-filesystem.sh"
    renderer
    cli_project
    cli_author
    cli_styles
    ;;
esac
