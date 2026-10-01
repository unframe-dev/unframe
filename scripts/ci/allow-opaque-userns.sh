#!/usr/bin/env bash
set -euo pipefail

if [ "${RUNNER_OS:-}" != "Linux" ]; then
  echo "Opaque capture CI requires a Linux runner." >&2
  exit 1
fi
if [ -z "${UNFRAME_BWRAP_PATH:-}" ] || [ ! -x "${UNFRAME_BWRAP_PATH}" ]; then
  echo "Pinned bubblewrap is unavailable; run this setup inside nix develop." >&2
  exit 1
fi

bwrap_path="$(realpath "${UNFRAME_BWRAP_PATH}")"
sudo tee /etc/apparmor.d/unframe-opaque-capture >/dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>

profile unframe-opaque-bwrap "${bwrap_path}" flags=(unconfined) {
  userns,
}

profile unframe-opaque-browser-host "/tmp/unframe-opaque-worker-*/browser/chrome-headless-shell" flags=(unconfined) {
  userns,
}

profile unframe-opaque-browser-sandbox "/browser/chrome-headless-shell" flags=(unconfined) {
  userns,
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/unframe-opaque-capture
