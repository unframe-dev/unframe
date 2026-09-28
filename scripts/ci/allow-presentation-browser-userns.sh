#!/usr/bin/env bash
set -euo pipefail

browser_root="${GITHUB_WORKSPACE}/.cache/playwright"
mapfile -d '' -t browser_paths < <(
  find "${browser_root}" -type f -name chrome-headless-shell -perm -111 -print0
)
if [ "${#browser_paths[@]}" -ne 1 ]; then
  echo "Expected exactly one installed Fixed Browser executable." >&2
  exit 1
fi

browser_path="$(realpath "${browser_paths[0]}")"
sudo tee /etc/apparmor.d/unframe-presentation-browser >/dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>

profile unframe-presentation-browser "${browser_path}" flags=(unconfined) {
  userns,
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/unframe-presentation-browser
