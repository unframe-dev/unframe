#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
export PLAYWRIGHT_BROWSERS_PATH="${repo_root}/.cache/playwright"
# shellcheck source=../lib/native-host.sh
source "${repo_root}/scripts/lib/native-host.sh"
host="$(native_host)"

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
  exec "${repo_root}/scripts/dev/opaque-capture-scope.sh" "${repo_root}/scripts/ci/opaque-capture.sh"
fi

bash "${repo_root}/scripts/build-cli-filesystem.sh"

pnpm --dir "${repo_root}" --filter @unframe/unframe-tailwind run build

pnpm --dir "${repo_root}" --filter @unframe/unframe-renderer-web run typecheck
node --test "${repo_root}"/packages/unframe-worker-host/src/native/test_*.ts

pnpm --dir "${repo_root}" --filter @unframe/unframe-renderer-web exec vp test run --maxWorkers=1 --testTimeout=60000 \
  test/opaque-isolation.integration.test.ts test/opaque-isolation-darwin.integration.test.ts \
  test/opaque-capture.integration.test.ts \
  test/opaque-fonts.integration.test.ts test/opaque-runtime-lifecycle.integration.test.ts \
  test/playwright-fixed-browser.integration.test.ts
pnpm --dir "${repo_root}" --filter @unframe/unframe-cli exec vp test run --maxWorkers=1 --testTimeout=60000 \
  test/opaque-project.integration.test.ts test/author-capture.integration.test.ts \
  test/author-source-diagnostics.integration.test.ts \
  test/styles-worker.integration.test.ts test/tailwind-project.integration.test.ts
